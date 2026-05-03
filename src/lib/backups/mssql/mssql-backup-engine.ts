import { createHash } from "crypto";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import {
  MssqlBackupRunStatus,
  MssqlBackupType,
  Prisma,
  type MssqlBackupDestinationMode,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import { MssqlProvider, type MssqlDatabaseInfo } from "@/lib/providers/mssql.provider";
import { getBackupStorageProvider } from "@/lib/backups/storage";
import { normalizeStoragePrefix } from "@/lib/backups/postgres/artifacts";
import {
  buildMssqlArtifactKey,
  buildMssqlBackupFileName,
  buildMssqlBackupSql,
  buildMssqlVerifySql,
} from "./mssql-backup-sql";
import { resolveMssqlPolicyDatabases } from "./mssql-database-discovery";

const SAFE_ERROR_LIMIT = 3000;

type BackupRunResult = {
  type: MssqlBackupType;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  runIds: string[];
  succeeded: number;
  failed: number;
  bytesWritten: number;
};

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/password\s*=\s*[^;\s]+/gi, "password=<redacted>").slice(0, SAFE_ERROR_LIMIT);
}

function pathSeparator(base: string): "\\" | "/" {
  return base.includes("\\") || /^[a-zA-Z]:/.test(base) ? "\\" : "/";
}

function joinBackupPath(base: string, fileName: string): string {
  const sep = pathSeparator(base);
  if (sep === "\\") return path.win32.join(base, fileName);
  return path.posix.join(base, fileName);
}

function joinUrl(base: string, fileName: string): string {
  return `${base.replace(/\/+$/g, "")}/${encodeURIComponent(fileName)}`;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function storagePrefixFromTarget(target: { config: unknown } | null | undefined): string {
  if (!target?.config || typeof target.config !== "object") return "niflheim";
  const prefix = (target.config as { prefix?: unknown }).prefix;
  return normalizeStoragePrefix(typeof prefix === "string" ? prefix : "niflheim");
}

function lastSuccessfulField(type: MssqlBackupType) {
  if (type === "DIFFERENTIAL") return "lastSuccessfulDiffAt" as const;
  if (type === "LOG") return "lastSuccessfulLogAt" as const;
  return "lastSuccessfulFullAt" as const;
}

function isLogUnsupported(database: MssqlDatabaseInfo): boolean {
  return database.recoveryModel === "SIMPLE";
}

export class MssqlBackupEngine {
  async runBackup(input: {
    policyId: string;
    type: MssqlBackupType;
    triggeredBy: "manual" | "schedule";
    timeoutMs: number;
  }): Promise<BackupRunResult> {
    const started = Date.now();
    const policy = await prisma.mssqlBackupPolicy.findUnique({
      where: { id: input.policyId },
      include: {
        sourceConnection: true,
        storageTarget: true,
      },
    });
    if (!policy) throw new Error("SQL Server backup policy not found");
    if (!policy.enabled) throw new Error("SQL Server backup policy is disabled");

    const provider = new MssqlProvider();
    const connection = toConnectionLike({
      ...policy.sourceConnection,
      config: {
        ...(policy.sourceConnection.config as Record<string, unknown>),
        requestTimeoutMs: input.timeoutMs,
      },
    });
    const databases = await resolveMssqlPolicyDatabases(policy, connection, provider);
    const runIds: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let bytesWritten = 0;

    for (const database of databases) {
      const run = await prisma.mssqlBackupRun.create({
        data: {
          policyId: policy.id,
          type: input.type,
          status: MssqlBackupRunStatus.RUNNING,
          triggeredBy: input.triggeredBy,
          databaseName: database.name,
          tenantId: policy.tenantId,
          userId: policy.userId,
        },
        select: { id: true, startedAt: true },
      });
      runIds.push(run.id);

      try {
        if (input.type === "LOG" && isLogUnsupported(database)) {
          throw new Error(`Database ${database.name} uses SIMPLE recovery model and cannot run transaction log backups`);
        }
        const artifact = await this.runDatabaseBackup({
          policy,
          database: database.name,
          type: input.type,
          runId: run.id,
          runStartedAt: run.startedAt,
          timeoutMs: input.timeoutMs,
          provider,
          connection,
        });
        bytesWritten += artifact.bytesWritten ?? 0;
        succeeded += 1;
        await prisma.mssqlBackupRun.update({
          where: { id: run.id },
          data: {
            status: MssqlBackupRunStatus.SUCCESS,
            artifactMetadata: artifact.metadata,
            bytesWritten: artifact.bytesWritten == null ? null : BigInt(artifact.bytesWritten),
            checksumSha256: artifact.checksumSha256 ?? null,
            durationMs: Date.now() - run.startedAt.getTime(),
            completedAt: new Date(),
          },
        });
      } catch (error) {
        failed += 1;
        await prisma.mssqlBackupRun.update({
          where: { id: run.id },
          data: {
            status: MssqlBackupRunStatus.FAILED,
            error: safeError(error),
            durationMs: Date.now() - run.startedAt.getTime(),
            completedAt: new Date(),
          },
        });
      }
    }

    const status = failed === 0 ? "SUCCESS" : succeeded > 0 ? "PARTIAL" : "FAILED";
    const policyUpdate: Record<string, unknown> = {
      lastError: status === "FAILED" ? `All selected SQL Server databases failed to back up` : null,
    };
    if (succeeded > 0) {
      policyUpdate[lastSuccessfulField(input.type)] = new Date();
    }
    await prisma.mssqlBackupPolicy.update({
      where: { id: policy.id },
      data: policyUpdate,
    });

    return {
      type: input.type,
      status,
      runIds,
      succeeded,
      failed,
      bytesWritten,
    };
  }

  private async runDatabaseBackup(input: {
    policy: any;
    database: string;
    type: MssqlBackupType;
    runId: string;
    runStartedAt: Date;
    timeoutMs: number;
    provider: MssqlProvider;
    connection: ReturnType<typeof toConnectionLike>;
  }): Promise<{ metadata: Prisma.InputJsonObject; bytesWritten?: number; checksumSha256?: string }> {
    const fileName = buildMssqlBackupFileName({
      database: input.database,
      type: input.type,
      at: input.runStartedAt,
    });
    const destination = this.resolveDestination(input.policy, fileName);
    const sql = buildMssqlBackupSql({
      database: input.database,
      type: input.type,
      destinationMode: input.policy.destinationMode,
      target: destination.sqlTarget,
      credentialName: input.policy.urlCredentialName,
      compressionEnabled: input.policy.compressionEnabled,
      checksumEnabled: input.policy.checksumEnabled,
      copyOnly: input.policy.copyOnly,
    });

    const conn = await input.provider.connect(input.connection);
    try {
      await conn.pool.request().query(sql);
      if (input.policy.verifyAfterBackup) {
        await conn.pool.request().query(buildMssqlVerifySql({
          destinationMode: input.policy.destinationMode,
          target: destination.sqlTarget,
          checksumEnabled: input.policy.checksumEnabled,
        }));
      }
    } finally {
      await conn.close();
    }

    const metadata: Prisma.InputJsonObject = {
      database: input.database,
      type: input.type,
      destinationMode: input.policy.destinationMode,
      sqlTarget: destination.sqlTarget,
      createdAt: input.runStartedAt.toISOString(),
      uploaded: false,
    };

    if (input.policy.destinationMode === "BACKUP_TO_DISK_SHARED_PATH" && destination.hermodPath && input.policy.storageTarget) {
      const checksumSha256 = await sha256File(destination.hermodPath);
      const storage = getBackupStorageProvider(input.policy.storageTarget);
      const objectKey = buildMssqlArtifactKey({
        prefix: storagePrefixFromTarget(input.policy.storageTarget),
        policyId: input.policy.id,
        database: input.database,
        type: input.type,
        at: input.runStartedAt,
      });
      const uploaded = await storage.uploadFile(destination.hermodPath, objectKey, {
        policyId: input.policy.id,
        runId: input.runId,
        type: `MSSQL_${input.type}`,
        sourceConnectionId: input.policy.sourceConnectionId,
        database: input.database,
        createdAt: input.runStartedAt.toISOString(),
        checksumSha256,
      });
      return {
        metadata: {
          ...metadata,
          hermodPath: destination.hermodPath,
          objectKey: uploaded.key,
          etag: uploaded.etag,
          uploaded: true,
          bytes: uploaded.bytes,
          checksumSha256,
        },
        bytesWritten: uploaded.bytes,
        checksumSha256,
      };
    }

    if (input.policy.destinationMode === "BACKUP_TO_DISK_SHARED_PATH" && destination.hermodPath) {
      const fileStat = await stat(destination.hermodPath);
      const checksumSha256 = await sha256File(destination.hermodPath);
      return {
        metadata: {
          ...metadata,
          hermodPath: destination.hermodPath,
          bytes: fileStat.size,
          checksumSha256,
          uploadSkipped: "No storage target configured",
        },
        bytesWritten: fileStat.size,
        checksumSha256,
      };
    }

    return {
      metadata: {
        ...metadata,
        hermodReadable: input.policy.destinationMode !== "BACKUP_TO_DISK_SERVER_ONLY",
        warning: input.policy.destinationMode === "BACKUP_TO_DISK_SERVER_ONLY"
          ? "SQL Server wrote this file on the SQL Server host. Hermod did not read or upload it."
          : undefined,
      },
    };
  }

  private resolveDestination(policy: {
    destinationMode: MssqlBackupDestinationMode;
    backupPath: string | null;
    hermodReadablePath?: string | null;
    urlBase: string | null;
  }, fileName: string): { sqlTarget: string; hermodPath?: string } {
    if (policy.destinationMode === "BACKUP_TO_URL") {
      if (!policy.urlBase) throw new Error("BACKUP TO URL requires a URL base");
      return { sqlTarget: joinUrl(policy.urlBase, fileName) };
    }
    if (!policy.backupPath) {
      throw new Error("SQL Server backup path is required for disk backup modes");
    }
    return {
      sqlTarget: joinBackupPath(policy.backupPath, fileName),
      hermodPath: policy.destinationMode === "BACKUP_TO_DISK_SHARED_PATH"
        ? joinBackupPath(policy.hermodReadablePath || policy.backupPath, fileName)
        : undefined,
    };
  }
}
