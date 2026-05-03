import { spawn } from "child_process";
import { mkdtemp, mkdir, readdir, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { Prisma, BackupPolicyStatus, BackupRunStatus, BackupRunType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import type { ConnectionLike } from "@/lib/providers/types";
import { connectionForDatabase } from "@/lib/providers/postgres.provider";
import { getBackupStorageProvider } from "@/lib/backups/storage";
import type { BackupStorageProviderClient } from "@/lib/backups/storage/types";
import {
  buildFullBackupObjectKey,
  buildWalObjectKey,
  calculateFileSha256,
  combineChecksums,
  timestampForObjectKey,
} from "./artifacts";
import { runPostgresBackupPreflight, verifyBackupBinary } from "./preflight";
import {
  postgresConnectionScope,
  resolvePolicyDatabases,
} from "./database-selection";

export interface BackupProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

interface BackupProcessOptions {
  timeoutMs: number;
  timeoutIsSuccess?: boolean;
  timeoutSignal?: NodeJS.Signals;
}

export type BackupProcessRunner = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: BackupProcessOptions
) => Promise<BackupProcessResult>;

export interface BackupEngineDependencies {
  processRunner?: BackupProcessRunner;
  storageResolver?: (target: LoadedBackupPolicy["storageTarget"]) => BackupStorageProviderClient;
}

export interface PostgresBackupJobResult {
  runId: string;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  objectKeys: Array<Record<string, unknown>>;
  bytesWritten: number;
  checksumSha256: string | null;
  durationMs: number;
}

type LoadedBackupPolicy = NonNullable<Awaited<ReturnType<typeof loadPolicy>>>;

const FULL_BACKUP_TIMEOUT_MS = 60 * 60_000;
const WAL_BACKUP_TIMEOUT_MS = 15 * 60_000;

export async function runBackupProcess(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: BackupProcessOptions
): Promise<BackupProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(options.timeoutSignal ?? "SIGTERM");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const result = { stdout, stderr, exitCode, timedOut };
      if (exitCode === 0 || (timedOut && options.timeoutIsSuccess)) {
        resolve(result);
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `${binary} exited with code ${exitCode}`;
      reject(new Error(detail));
    });
  });
}

async function loadPolicy(policyId: string) {
  return prisma.postgresBackupPolicy.findUnique({
    where: { id: policyId },
    include: {
      sourceConnection: {
        select: { id: true, type: true, config: true, credentials: true },
      },
      storageTarget: {
        select: { id: true, provider: true, accessMode: true, config: true, credentials: true },
      },
    },
  });
}

function redact(message: string, secrets: Array<string | undefined | null>): string {
  let safe = message;
  for (const secret of secrets) {
    if (!secret) continue;
    safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

function postgresEnv(connection: ConnectionLike): NodeJS.ProcessEnv {
  const config = connection.config as {
    host: string;
    port?: number;
    database?: string;
    maintenanceDatabase?: string;
    scope?: string;
    username: string;
    ssl?: boolean;
  };
  const credentials = connection.credentials as { password?: string };
  const database = config.scope === "SERVER"
    ? config.maintenanceDatabase ?? "postgres"
    : config.database ?? "postgres";

  return {
    ...process.env,
    PGHOST: config.host,
    PGPORT: String(config.port ?? 5432),
    PGDATABASE: database,
    PGUSER: config.username,
    PGPASSWORD: credentials.password ?? "",
    PGSSLMODE: config.ssl ? "require" : "disable",
  };
}

function postgresArgs(connection: ConnectionLike): string[] {
  const config = connection.config as {
    host: string;
    port?: number;
    database?: string;
    maintenanceDatabase?: string;
    scope?: string;
    username: string;
  };
  const database = config.scope === "SERVER"
    ? config.maintenanceDatabase ?? "postgres"
    : config.database ?? "postgres";
  return [
    "--host",
    config.host,
    "--port",
    String(config.port ?? 5432),
    "--username",
    config.username,
    "--dbname",
    database,
  ];
}

function databaseName(connection: ConnectionLike): string {
  const config = connection.config as { database?: string; maintenanceDatabase?: string; scope?: string };
  return config.scope === "SERVER"
    ? config.maintenanceDatabase ?? "postgres"
    : config.database ?? "postgres";
}

function fileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "postgres";
}

async function ensureRun(input: {
  runId?: string;
  policy: LoadedBackupPolicy;
  type: BackupRunType;
  triggeredBy: string;
}) {
  if (input.runId) {
    return prisma.postgresBackupRun.update({
      where: { id: input.runId },
      data: {
        type: input.type,
        status: BackupRunStatus.RUNNING,
        error: null,
        startedAt: new Date(),
        completedAt: null,
      },
      select: { id: true },
    });
  }

  return prisma.postgresBackupRun.create({
    data: {
      policyId: input.policy.id,
      type: input.type,
      status: BackupRunStatus.RUNNING,
      triggeredBy: input.triggeredBy,
      tenantId: input.policy.tenantId,
      userId: input.policy.userId,
    },
    select: { id: true },
  });
}

async function markRunFailed(input: {
  runId: string;
  durationMs: number;
  error: string;
  policyId: string;
  policyStatus: BackupPolicyStatus;
}) {
  await prisma.$transaction([
    prisma.postgresBackupRun.update({
      where: { id: input.runId },
      data: {
        status: BackupRunStatus.FAILED,
        error: input.error,
        durationMs: input.durationMs,
        completedAt: new Date(),
      },
    }),
    prisma.postgresBackupPolicy.update({
      where: { id: input.policyId },
      data: {
        status: input.policyStatus,
        lastError: input.error,
      },
    }),
  ]);
}

export class PostgresBackupEngine {
  private readonly processRunner: BackupProcessRunner;
  private readonly storageResolver: (target: LoadedBackupPolicy["storageTarget"]) => BackupStorageProviderClient;

  constructor(deps: BackupEngineDependencies = {}) {
    this.processRunner = deps.processRunner ?? runBackupProcess;
    this.storageResolver = deps.storageResolver ?? getBackupStorageProvider;
  }

  async runFullBackup(input: {
    policyId: string;
    triggeredBy: string;
    runId?: string;
    timeoutMs?: number;
  }): Promise<PostgresBackupJobResult> {
    const start = Date.now();
    const policy = await loadPolicy(input.policyId);
    if (!policy) throw new Error("Backup policy not found");
    if (policy.sourceConnection.type !== "POSTGRES") {
      throw new Error("Niflheim backups currently support PostgreSQL source connections only");
    }

    const run = await ensureRun({
      runId: input.runId,
      policy,
      type: BackupRunType.FULL_LOGICAL,
      triggeredBy: input.triggeredBy,
    });

    const connLike = toConnectionLike(policy.sourceConnection);
    const password = (connLike.credentials as { password?: string }).password;
    let tempDir: string | null = null;

    try {
      const binary = await verifyBackupBinary("pg_dump");
      if (!binary.ok) throw new Error(binary.message);

      const databases = await resolvePolicyDatabases(policy, connLike);
      tempDir = await mkdtemp(path.join(os.tmpdir(), "hermod-full-backup-"));
      const createdAt = new Date();
      const storage = this.storageResolver(policy.storageTarget);
      const objectKeys: Array<Record<string, unknown>> = [];
      const checksums: string[] = [];
      const databaseErrors: string[] = [];
      let totalBytes = 0;

      for (const database of databases) {
        const dbConnection = connectionForDatabase(connLike, database);
        const env = postgresEnv(dbConnection);
        const dumpPath = path.join(
          tempDir,
          `${fileNameSegment(database)}-${timestampForObjectKey(createdAt)}.dump`
        );

        try {
          await this.processRunner(
            "pg_dump",
            [
              "--format=custom",
              "--compress=9",
              "--no-owner",
              "--no-privileges",
              "--file",
              dumpPath,
              ...postgresArgs(dbConnection),
            ],
            env,
            { timeoutMs: input.timeoutMs ?? FULL_BACKUP_TIMEOUT_MS }
          );

          const checksumSha256 = await calculateFileSha256(dumpPath);
          const fileStat = await stat(dumpPath);
          const objectKey = buildFullBackupObjectKey({
            prefix: policy.storagePrefix,
            policyId: policy.id,
            database,
            at: createdAt,
          });
          const uploaded = await storage.uploadFile(dumpPath, objectKey, {
            policyId: policy.id,
            runId: run.id,
            type: BackupRunType.FULL_LOGICAL,
            sourceConnectionId: policy.sourceConnectionId,
            database,
            createdAt: createdAt.toISOString(),
            checksumSha256,
          });
          totalBytes += uploaded.bytes || fileStat.size;
          checksums.push(checksumSha256);
          objectKeys.push({
            key: uploaded.key,
            database,
            bytes: uploaded.bytes,
            etag: uploaded.etag,
            checksumSha256,
          });
        } catch (databaseError) {
          const message = redact(
            databaseError instanceof Error ? databaseError.message : String(databaseError),
            [env.PGPASSWORD]
          );
          databaseErrors.push(`${database}: ${message}`);
        }
      }

      if (objectKeys.length === 0) {
        throw new Error(`All selected databases failed to back up: ${databaseErrors.join("; ")}`);
      }

      const durationMs = Date.now() - start;
      const checksumSha256 = combineChecksums(checksums);
      const status = databaseErrors.length > 0
        ? BackupRunStatus.PARTIAL
        : BackupRunStatus.SUCCESS;
      const error = databaseErrors.length > 0
        ? `One or more databases failed to back up: ${databaseErrors.join("; ")}`
        : null;

      await prisma.$transaction([
        prisma.postgresBackupRun.update({
          where: { id: run.id },
          data: {
            status,
            objectKeys: objectKeys as Prisma.InputJsonValue,
            bytesWritten: BigInt(totalBytes),
            checksumSha256,
            durationMs,
            error,
            completedAt: new Date(),
          },
        }),
        prisma.postgresBackupPolicy.update({
          where: { id: policy.id },
          data: {
            lastSuccessfulFullAt: new Date(),
            status: status === BackupRunStatus.SUCCESS ? BackupPolicyStatus.ACTIVE : BackupPolicyStatus.DEGRADED,
            lastError: error,
          },
        }),
      ]);

      return {
        runId: run.id,
        status,
        objectKeys,
        bytesWritten: totalBytes,
        checksumSha256,
        durationMs,
      };
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), [password]);
      const durationMs = Date.now() - start;
      await markRunFailed({
        runId: run.id,
        durationMs,
        error: message,
        policyId: policy.id,
        policyStatus: BackupPolicyStatus.ERROR,
      });
      return {
        runId: run.id,
        status: "FAILED",
        objectKeys: [],
        bytesWritten: 0,
        checksumSha256: null,
        durationMs,
      };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  async runWalArchive(input: {
    policyId: string;
    triggeredBy: string;
    runId?: string;
    timeoutMs?: number;
  }): Promise<PostgresBackupJobResult> {
    const start = Date.now();
    const policy = await loadPolicy(input.policyId);
    if (!policy) throw new Error("Backup policy not found");
    if (policy.sourceConnection.type !== "POSTGRES") {
      throw new Error("Niflheim WAL archives currently support PostgreSQL source connections only");
    }

    const run = await ensureRun({
      runId: input.runId,
      policy,
      type: BackupRunType.WAL_ARCHIVE,
      triggeredBy: input.triggeredBy,
    });

    const connLike = toConnectionLike(policy.sourceConnection);
    const env = postgresEnv(connLike);
    let tempDir: string | null = null;

    try {
      if (postgresConnectionScope(policy.sourceConnection.config) !== "SERVER") {
        throw new Error("WAL/PITR coverage requires a SERVER-scoped PostgreSQL connection because WAL is cluster-level");
      }
      const preflight = await runPostgresBackupPreflight({
        walEnabled: policy.walEnabled,
        replicationSlot: policy.replicationSlot,
      });
      if (!policy.walEnabled) {
        throw new Error("WAL/PITR coverage is disabled for this backup policy");
      }
      if (!preflight.ok) {
        throw new Error(preflight.checks.filter((check) => !check.ok).map((check) => check.message).join("; "));
      }
      if (!policy.replicationSlot) {
        throw new Error("Replication slot is required for WAL/PITR coverage");
      }

      tempDir = await mkdtemp(path.join(os.tmpdir(), "hermod-wal-backup-"));
      const walDir = path.join(tempDir, "wal");
      await mkdir(walDir, { recursive: true });

      await this.processRunner(
        "pg_receivewal",
        [
          "--directory",
          walDir,
          "--slot",
          policy.replicationSlot,
          "--no-loop",
          ...postgresArgs(connLike),
        ],
        env,
        {
          timeoutMs: input.timeoutMs ?? WAL_BACKUP_TIMEOUT_MS,
          timeoutIsSuccess: true,
          timeoutSignal: "SIGINT",
        }
      );

      const storage = this.storageResolver(policy.storageTarget);
      const createdAt = new Date();
      const entries = await readdir(walDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith(".partial"))
        .map((entry) => entry.name)
        .sort();

      const objectKeys: Array<Record<string, unknown>> = [];
      const checksums: string[] = [];
      const uploadErrors: string[] = [];
      let totalBytes = 0;

      for (const fileName of files) {
        const filePath = path.join(walDir, fileName);
        const fileStat = await stat(filePath);
        if (fileStat.size === 0) continue;
        const checksumSha256 = await calculateFileSha256(filePath);
        const objectKey = buildWalObjectKey({
          prefix: policy.storagePrefix,
          policyId: policy.id,
          fileName,
          at: createdAt,
        });

        try {
          const uploaded = await storage.uploadFile(filePath, objectKey, {
            policyId: policy.id,
            runId: run.id,
            type: BackupRunType.WAL_ARCHIVE,
            sourceConnectionId: policy.sourceConnectionId,
            database: databaseName(connLike),
            createdAt: createdAt.toISOString(),
            checksumSha256,
          });
          totalBytes += uploaded.bytes;
          checksums.push(checksumSha256);
          objectKeys.push({
            key: uploaded.key,
            bytes: uploaded.bytes,
            etag: uploaded.etag,
            checksumSha256,
          });
        } catch (uploadError) {
          uploadErrors.push(uploadError instanceof Error ? uploadError.message : String(uploadError));
        }
      }

      const durationMs = Date.now() - start;
      const checksumSha256 = combineChecksums(checksums);
      const status =
        uploadErrors.length > 0
          ? objectKeys.length > 0
            ? BackupRunStatus.PARTIAL
            : BackupRunStatus.FAILED
          : BackupRunStatus.SUCCESS;
      const error = uploadErrors.length > 0
        ? `One or more WAL files failed to upload: ${uploadErrors.join("; ")}`
        : null;

      await prisma.$transaction([
        prisma.postgresBackupRun.update({
          where: { id: run.id },
          data: {
            status,
            objectKeys: objectKeys as Prisma.InputJsonValue,
            bytesWritten: BigInt(totalBytes),
            checksumSha256,
            durationMs,
            error,
            completedAt: new Date(),
          },
        }),
        prisma.postgresBackupPolicy.update({
          where: { id: policy.id },
          data: {
            lastSuccessfulWalAt: status === BackupRunStatus.FAILED ? policy.lastSuccessfulWalAt : new Date(),
            status: status === BackupRunStatus.SUCCESS ? BackupPolicyStatus.ACTIVE : BackupPolicyStatus.DEGRADED,
            lastError: error,
          },
        }),
      ]);

      return {
        runId: run.id,
        status,
        objectKeys,
        bytesWritten: totalBytes,
        checksumSha256,
        durationMs,
      };
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), [env.PGPASSWORD]);
      const durationMs = Date.now() - start;
      await markRunFailed({
        runId: run.id,
        durationMs,
        error: message,
        policyId: policy.id,
        policyStatus: policy.lastSuccessfulFullAt
          ? BackupPolicyStatus.DEGRADED
          : BackupPolicyStatus.ERROR,
      });
      return {
        runId: run.id,
        status: "FAILED",
        objectKeys: [],
        bytesWritten: 0,
        checksumSha256: null,
        durationMs,
      };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }
}
