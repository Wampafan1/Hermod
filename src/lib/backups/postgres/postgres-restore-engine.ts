import { spawn } from "child_process";
import { mkdtemp, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { Prisma, PostgresRestoreMode, PostgresRestoreStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import type { ConnectionLike } from "@/lib/providers/types";
import { connectionForDatabase } from "@/lib/providers/postgres.provider";
import { getBackupStorageProvider } from "@/lib/backups/storage";
import type { BackupStorageProviderClient } from "@/lib/backups/storage/types";
import { extractObjectKeys } from "@/lib/backups/api-helpers";
import { calculateFileSha256, normalizeStoragePrefix } from "./artifacts";
import { postgresConnectionScope } from "./database-selection";
import { verifyBackupBinary } from "./preflight";

export interface RestoreProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

interface RestoreProcessOptions {
  timeoutMs: number;
}

export type RestoreProcessRunner = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: RestoreProcessOptions
) => Promise<RestoreProcessResult>;

export interface RestoreEngineDependencies {
  processRunner?: RestoreProcessRunner;
  storageResolver?: (target: LoadedRestoreJob["policy"]["storageTarget"]) => BackupStorageProviderClient;
}

export interface RestoreJobResult {
  restoreJobId: string;
  status: PostgresRestoreStatus;
  checksumVerified: boolean;
  bytesDownloaded: number;
  durationMs: number;
}

type LoadedRestoreJob = NonNullable<Awaited<ReturnType<typeof loadRestoreJob>>>;

const RESTORE_TIMEOUT_MS = 60 * 60_000;
const ERROR_LIMIT = 4000;

export async function runRestoreProcess(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: RestoreProcessOptions
): Promise<RestoreProcessResult> {
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
      child.kill("SIGTERM");
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
      if (exitCode === 0) {
        resolve(result);
        return;
      }
      const detail = timedOut
        ? `${binary} timed out after ${options.timeoutMs / 1000}s`
        : stderr.trim() || stdout.trim() || `${binary} exited with code ${exitCode}`;
      reject(new Error(detail));
    });
  });
}

async function loadRestoreJob(restoreJobId: string) {
  return prisma.postgresRestoreJob.findUnique({
    where: { id: restoreJobId },
    include: {
      backupRun: true,
      targetConnection: {
        select: { id: true, name: true, type: true, config: true, credentials: true },
      },
      policy: {
        include: {
          sourceConnection: {
            select: { id: true, name: true, type: true, config: true },
          },
          storageTarget: {
            select: { id: true, provider: true, accessMode: true, config: true, credentials: true },
          },
        },
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
  return safe.length > ERROR_LIMIT ? `${safe.slice(0, ERROR_LIMIT)}...` : safe;
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

function databaseName(connection: ConnectionLike): string {
  const config = connection.config as { database?: string; maintenanceDatabase?: string; scope?: string };
  return config.scope === "SERVER"
    ? config.maintenanceDatabase ?? "postgres"
    : config.database ?? "postgres";
}

function restoreOptions(options: Prisma.JsonValue): {
  clean: boolean;
  ifExists: boolean;
  noOwner: boolean;
  noPrivileges: boolean;
  pointInTime?: string;
  targetDatabase?: string;
} {
  const record = options && typeof options === "object" && !Array.isArray(options)
    ? options as Record<string, unknown>
    : {};
  return {
    clean: record.clean !== false,
    ifExists: record.ifExists !== false,
    noOwner: record.noOwner !== false,
    noPrivileges: record.noPrivileges !== false,
    pointInTime: typeof record.pointInTime === "string" ? record.pointInTime : undefined,
    targetDatabase: typeof record.targetDatabase === "string" ? record.targetDatabase : undefined,
  };
}

function restoreTargetConnection(connection: ConnectionLike, options: ReturnType<typeof restoreOptions>): ConnectionLike {
  if (postgresConnectionScope(connection.config) !== "SERVER") {
    return connection;
  }
  if (!options.targetDatabase?.trim()) {
    throw new Error("Target database is required for SERVER-scoped restore targets");
  }
  return connectionForDatabase(connection, options.targetDatabase.trim());
}

function buildPgRestoreArgs(connection: ConnectionLike, dumpPath: string, options: ReturnType<typeof restoreOptions>): string[] {
  const args: string[] = [];
  if (options.clean) args.push("--clean");
  if (options.ifExists) args.push("--if-exists");
  if (options.noOwner) args.push("--no-owner");
  if (options.noPrivileges) args.push("--no-privileges");
  args.push("--dbname", databaseName(connection), dumpPath);
  return args;
}

async function markFailed(input: {
  restoreJobId: string;
  startedAtMs: number;
  error: string;
  bytesDownloaded?: number;
  checksumVerified?: boolean;
}) {
  await prisma.postgresRestoreJob.update({
    where: { id: input.restoreJobId },
    data: {
      status: PostgresRestoreStatus.FAILED,
      error: input.error,
      bytesDownloaded: input.bytesDownloaded == null ? undefined : BigInt(input.bytesDownloaded),
      checksumVerified: input.checksumVerified ?? false,
      durationMs: Date.now() - input.startedAtMs,
      completedAt: new Date(),
    },
  });
}

export class PostgresRestoreEngine {
  private readonly processRunner: RestoreProcessRunner;
  private readonly storageResolver: (target: LoadedRestoreJob["policy"]["storageTarget"]) => BackupStorageProviderClient;

  constructor(deps: RestoreEngineDependencies = {}) {
    this.processRunner = deps.processRunner ?? runRestoreProcess;
    this.storageResolver = deps.storageResolver ?? getBackupStorageProvider;
  }

  async runRestore(input: { restoreJobId: string; timeoutMs?: number }): Promise<RestoreJobResult> {
    const restoreJob = await loadRestoreJob(input.restoreJobId);
    if (!restoreJob) throw new Error("Restore job not found");

    if (restoreJob.mode === PostgresRestoreMode.PHYSICAL_PITR_PREPARE) {
      return this.preparePhysicalPitr({ restoreJob });
    }

    return this.runLogicalRestore({ restoreJob, timeoutMs: input.timeoutMs });
  }

  private async runLogicalRestore(input: {
    restoreJob: LoadedRestoreJob;
    timeoutMs?: number;
  }): Promise<RestoreJobResult> {
    const start = Date.now();
    const { restoreJob } = input;
    const options = restoreOptions(restoreJob.options);
    const baseConnLike = toConnectionLike(restoreJob.targetConnection);
    const password = (baseConnLike.credentials as { password?: string }).password;
    let env = postgresEnv(baseConnLike);
    let tempDir: string | null = null;
    let bytesDownloaded = 0;
    let checksumVerified = false;

    try {
      if (restoreJob.targetConnection.type !== "POSTGRES") {
        throw new Error("Restore target connection must be POSTGRES");
      }
      if (
        !restoreJob.backupRun ||
        restoreJob.backupRun.type !== "FULL_LOGICAL" ||
        !["SUCCESS", "PARTIAL"].includes(restoreJob.backupRun.status)
      ) {
        throw new Error("Logical restore requires a successful or partial FULL_LOGICAL backup run with artifacts");
      }
      const connLike = restoreTargetConnection(baseConnLike, options);
      env = postgresEnv(connLike);

      const binary = await verifyBackupBinary("pg_restore");
      if (!binary.ok) throw new Error(binary.message);

      tempDir = await mkdtemp(path.join(os.tmpdir(), "hermod-pg-restore-"));
      const dumpPath = path.join(tempDir, "restore.dump");
      const storage = this.storageResolver(restoreJob.policy.storageTarget);
      const downloaded = await storage.downloadFile(restoreJob.objectKey, dumpPath);
      bytesDownloaded = downloaded.bytes;

      const actualChecksum = await calculateFileSha256(dumpPath);
      const expectedChecksum = restoreJob.checksumSha256 ?? restoreJob.backupRun.checksumSha256;
      if (expectedChecksum && actualChecksum !== expectedChecksum) {
        throw new Error("Downloaded backup checksum did not match the recorded SHA-256 checksum");
      }
      checksumVerified = !!expectedChecksum;

      await this.processRunner(
        "pg_restore",
        buildPgRestoreArgs(connLike, dumpPath, options),
        env,
        { timeoutMs: input.timeoutMs ?? RESTORE_TIMEOUT_MS }
      );

      const durationMs = Date.now() - start;
      await prisma.postgresRestoreJob.update({
        where: { id: restoreJob.id },
        data: {
          status: PostgresRestoreStatus.SUCCESS,
          error: null,
          checksumVerified,
          bytesDownloaded: BigInt(bytesDownloaded),
          durationMs,
          completedAt: new Date(),
        },
      });

      return {
        restoreJobId: restoreJob.id,
        status: PostgresRestoreStatus.SUCCESS,
        checksumVerified,
        bytesDownloaded,
        durationMs,
      };
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), [env.PGPASSWORD, password]);
      await markFailed({
        restoreJobId: restoreJob.id,
        startedAtMs: start,
        error: message,
        bytesDownloaded,
        checksumVerified,
      });
      return {
        restoreJobId: restoreJob.id,
        status: PostgresRestoreStatus.FAILED,
        checksumVerified,
        bytesDownloaded,
        durationMs: Date.now() - start,
      };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  private async preparePhysicalPitr(input: { restoreJob: LoadedRestoreJob }): Promise<RestoreJobResult> {
    const start = Date.now();
    const { restoreJob } = input;
    let tempDir: string | null = null;

    try {
      if (!restoreJob.backupRun || restoreJob.backupRun.type !== "FULL_PHYSICAL_BASE" || restoreJob.backupRun.status !== "SUCCESS") {
        throw new Error("PITR preparation requires a successful FULL_PHYSICAL_BASE backup run");
      }

      const storage = this.storageResolver(restoreJob.policy.storageTarget);
      const prefix = `${normalizeStoragePrefix(restoreJob.policy.storagePrefix)}/${restoreJob.policy.id}`;
      const walPrefix = `${prefix}/wal/`;
      const walObjects = await storage.list(walPrefix);
      const objectKeys = extractObjectKeys(restoreJob.backupRun.objectKeys);
      const options = restoreOptions(restoreJob.options);
      const manifest = {
        mode: "PHYSICAL_PITR_PREPARE",
        restoreJobId: restoreJob.id,
        policyId: restoreJob.policyId,
        backupRunId: restoreJob.backupRunId,
        baseBackupObjectKeys: objectKeys,
        walPrefix,
        walObjectKeys: walObjects.map((object) => object.key),
        targetRecoveryTime: options.pointInTime ?? null,
        storageProvider: restoreJob.policy.storageTarget.provider,
        sourceConnection: {
          id: restoreJob.policy.sourceConnection.id,
          name: restoreJob.policy.sourceConnection.name,
          database: databaseName({ config: restoreJob.policy.sourceConnection.config, credentials: {}, type: "POSTGRES" } as ConnectionLike),
        },
        instructions: [
          "This manifest is for physical PostgreSQL PITR preparation only.",
          "Restore the base backup into a fresh PostgreSQL data directory or a managed-service PITR import flow.",
          "Do not apply WAL files to a logical pg_dump restore.",
          "Hermod did not stop/start PostgreSQL services for this job.",
        ],
        createdAt: new Date().toISOString(),
      };

      tempDir = await mkdtemp(path.join(os.tmpdir(), "hermod-pitr-manifest-"));
      const manifestPath = path.join(tempDir, "restore-manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const manifestStat = await stat(manifestPath);
      const manifestKey = `${prefix}/restore-manifests/${restoreJob.id}.json`;
      await storage.uploadFile(manifestPath, manifestKey, {
        policyId: restoreJob.policyId,
        runId: restoreJob.id,
        type: "PHYSICAL_PITR_PREPARE",
        sourceConnectionId: restoreJob.policy.sourceConnectionId,
        createdAt: new Date().toISOString(),
      });

      const durationMs = Date.now() - start;
      await prisma.postgresRestoreJob.update({
        where: { id: restoreJob.id },
        data: {
          status: PostgresRestoreStatus.SUCCESS,
          error: null,
          checksumVerified: false,
          bytesDownloaded: BigInt(0),
          durationMs,
          completedAt: new Date(),
          options: {
            ...(restoreOptions(restoreJob.options) as Record<string, unknown>),
            manifestObjectKey: manifestKey,
            manifestBytes: manifestStat.size,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        restoreJobId: restoreJob.id,
        status: PostgresRestoreStatus.SUCCESS,
        checksumVerified: false,
        bytesDownloaded: 0,
        durationMs,
      };
    } catch (error) {
      await markFailed({
        restoreJobId: restoreJob.id,
        startedAtMs: start,
        error: redact(error instanceof Error ? error.message : String(error), []),
      });
      return {
        restoreJobId: restoreJob.id,
        status: PostgresRestoreStatus.FAILED,
        checksumVerified: false,
        bytesDownloaded: 0,
        durationMs: Date.now() - start,
      };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }
}
