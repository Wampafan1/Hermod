import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { RestoreCreateInput } from "@/lib/validations/backups";
import {
  configuredDatabase,
  postgresConnectionScope,
  type DatabaseSelectionMode,
} from "@/lib/backups/postgres/database-selection";

export function userScopedWhere(ctx: AuthContext): { userId: string; tenantId: string } {
  return { userId: ctx.userId, tenantId: ctx.tenantId };
}

export async function validateBackupPolicyReferences(
  data: {
    sourceConnectionId: string;
    storageTargetId: string;
    walEnabled?: boolean;
    databaseSelectionMode?: string | null;
    selectedDatabases?: string[] | null;
    excludedDatabases?: string[] | null;
    databasePattern?: string | null;
  },
  ctx: AuthContext
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const source = await prisma.connection.findFirst({
    where: {
      id: data.sourceConnectionId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    },
    select: { id: true, type: true, config: true },
  });
  if (!source) {
    return { ok: false, status: 404, error: "PostgreSQL source connection not found" };
  }
  if (source.type !== "POSTGRES") {
    return { ok: false, status: 400, error: "Backup source connection must be POSTGRES" };
  }
  const sourceScope = postgresConnectionScope(source.config);
  if (data.walEnabled && sourceScope !== "SERVER") {
    return {
      ok: false,
      status: 400,
      error: "WAL/PITR coverage requires a SERVER-scoped PostgreSQL connection because WAL is cluster-level",
    };
  }
  if (sourceScope === "SERVER") {
    const mode = (data.databaseSelectionMode ?? "SINGLE") as DatabaseSelectionMode;
    const selectedCount = data.selectedDatabases?.length ?? 0;
    if (mode === "SINGLE" && selectedCount !== 1) {
      return { ok: false, status: 400, error: "Select exactly one database for SINGLE backup mode" };
    }
    if (mode === "MULTIPLE" && selectedCount === 0) {
      return { ok: false, status: 400, error: "Select at least one database for MULTIPLE backup mode" };
    }
    if (mode === "PATTERN" && !data.databasePattern) {
      return { ok: false, status: 400, error: "Database pattern is required for PATTERN backup mode" };
    }
  }

  const target = await prisma.backupStorageTarget.findFirst({
    where: {
      id: data.storageTargetId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    },
    select: { id: true },
  });
  if (!target) {
    return { ok: false, status: 404, error: "Storage target not found" };
  }

  return { ok: true };
}

export function validateWalConfiguration(
  data: { walEnabled?: boolean; replicationSlot?: string | null; sourceConfig?: unknown }
): { ok: true } | { ok: false; error: string } {
  if (data.walEnabled && !data.replicationSlot) {
    return {
      ok: false,
      error: "Replication slot is required when WAL/PITR coverage is enabled",
    };
  }
  if (data.walEnabled && data.sourceConfig && postgresConnectionScope(data.sourceConfig) !== "SERVER") {
    return {
      ok: false,
      error: "WAL/PITR coverage requires a SERVER-scoped PostgreSQL connection because WAL is cluster-level",
    };
  }
  return { ok: true };
}

export function normalizeBackupDatabaseSelection(
  data: {
    databaseSelectionMode?: string | null;
    selectedDatabases?: string[] | null;
    excludedDatabases?: string[] | null;
    databasePattern?: string | null;
  },
  sourceConfig: unknown
): {
  databaseSelectionMode: string;
  selectedDatabases: string[];
  excludedDatabases: string[];
  databasePattern: string | null;
} {
  if (postgresConnectionScope(sourceConfig) !== "SERVER") {
    return {
      databaseSelectionMode: "SINGLE",
      selectedDatabases: [configuredDatabase(sourceConfig)],
      excludedDatabases: [],
      databasePattern: null,
    };
  }

  return {
    databaseSelectionMode: data.databaseSelectionMode ?? "SINGLE",
    selectedDatabases: data.selectedDatabases ?? [],
    excludedDatabases: data.excludedDatabases ?? [],
    databasePattern: data.databasePattern ?? null,
  };
}

export function serializeBackupRun<T extends {
  bytesWritten: bigint | number | null;
  objectKeys?: Prisma.JsonValue | null;
}>(run: T): Omit<T, "bytesWritten"> & { bytesWritten: string | null } {
  return {
    ...run,
    bytesWritten: run.bytesWritten == null ? null : run.bytesWritten.toString(),
  };
}

export function serializeRestoreJob<T extends {
  bytesDownloaded: bigint | number | null;
}>(job: T): Omit<T, "bytesDownloaded"> & { bytesDownloaded: string | null } {
  return {
    ...job,
    bytesDownloaded: job.bytesDownloaded == null ? null : job.bytesDownloaded.toString(),
  };
}

export function serializeStorageTarget<T extends object>(target: T): Omit<T, "credentials"> {
  const { credentials: _credentials, ...safe } = target as T & { credentials?: unknown };
  return safe;
}

export function extractFirstObjectKey(value: Prisma.JsonValue | null | undefined): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "key" in item) {
        const key = (item as { key?: unknown }).key;
        if (typeof key === "string" && key.length > 0) return key;
      }
    }
  }
  if (typeof value === "string") return value;
  return null;
}

export function extractObjectKeys(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return typeof value === "string" ? [value] : [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "key" in item) {
      const key = (item as { key?: unknown }).key;
      return typeof key === "string" && key.length > 0 ? [key] : [];
    }
    return [];
  });
}

export function extractObjectArtifact(
  value: Prisma.JsonValue | null | undefined,
  requestedKey?: string | null
): { key: string; checksumSha256?: string | null; database?: string | null; bytes?: unknown } | null {
  const artifacts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  for (const item of artifacts) {
    if (typeof item === "string") {
      if (!requestedKey || item === requestedKey) return { key: item };
      continue;
    }
    if (!item || typeof item !== "object" || !("key" in item)) continue;
    const artifact = item as {
      key?: unknown;
      checksumSha256?: unknown;
      database?: unknown;
      bytes?: unknown;
    };
    if (typeof artifact.key !== "string" || artifact.key.length === 0) continue;
    if (requestedKey && artifact.key !== requestedKey) continue;
    return {
      key: artifact.key,
      checksumSha256: typeof artifact.checksumSha256 === "string" ? artifact.checksumSha256 : null,
      database: typeof artifact.database === "string" ? artifact.database : null,
      bytes: artifact.bytes,
    };
  }
  return null;
}

export function databaseNameFromConnectionConfig(config: unknown): string {
  return configuredDatabase(config);
}

export function expectedRestoreConfirmation(input: {
  mode: RestoreCreateInput["mode"];
  targetDatabase: string;
  sameSourceTarget: boolean;
}): string {
  if (input.mode === "PHYSICAL_PITR_PREPARE") {
    return `PREPARE PITR ${input.targetDatabase}`;
  }
  if (input.sameSourceTarget) {
    return `RESTORE SOURCE DATABASE ${input.targetDatabase}`;
  }
  return `RESTORE ${input.targetDatabase}`;
}

export async function validateRestoreReferences(
  data: RestoreCreateInput,
  ctx: AuthContext
): Promise<
  | {
      ok: true;
      policy: Prisma.PostgresBackupPolicyGetPayload<{
        include: {
          sourceConnection: { select: { id: true; name: true; type: true; config: true } };
          storageTarget: { select: { id: true; provider: true; config: true } };
        };
      }>;
      backupRun: NonNullable<Awaited<ReturnType<typeof prisma.postgresBackupRun.findFirst>>>;
      targetConnection: Prisma.ConnectionGetPayload<{
        select: { id: true; name: true; type: true; config: true };
      }>;
      objectKey: string;
      objectChecksumSha256: string | null;
      expectedConfirmation: string;
    }
  | { ok: false; status: number; error: string }
> {
  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id: data.policyId, userId: ctx.userId, tenantId: ctx.tenantId },
    include: {
      sourceConnection: { select: { id: true, name: true, type: true, config: true } },
      storageTarget: { select: { id: true, provider: true, config: true } },
    },
  });
  if (!policy) return { ok: false, status: 404, error: "Backup policy not found" };

  const backupRun = await prisma.postgresBackupRun.findFirst({
    where: { id: data.backupRunId, policyId: policy.id },
  });
  if (!backupRun) return { ok: false, status: 404, error: "Restore point not found" };
  if (backupRun.status !== "SUCCESS" && backupRun.status !== "PARTIAL") {
    return { ok: false, status: 400, error: "Restore point must be a successful or partial backup run with artifacts" };
  }
  if (data.mode === "LOGICAL_PG_RESTORE" && backupRun.type !== "FULL_LOGICAL") {
    return { ok: false, status: 400, error: "Logical restore requires a successful FULL_LOGICAL backup run" };
  }
  if (data.mode === "PHYSICAL_PITR_PREPARE" && backupRun.type !== "FULL_PHYSICAL_BASE") {
    return { ok: false, status: 400, error: "PITR preparation requires a successful FULL_PHYSICAL_BASE backup run" };
  }

  const targetConnection = await prisma.connection.findFirst({
    where: { id: data.targetConnectionId, userId: ctx.userId, tenantId: ctx.tenantId },
    select: { id: true, name: true, type: true, config: true },
  });
  if (!targetConnection) return { ok: false, status: 404, error: "Target PostgreSQL connection not found" };
  if (targetConnection.type !== "POSTGRES") {
    return { ok: false, status: 400, error: "Restore target connection must be POSTGRES" };
  }

  const artifact = extractObjectArtifact(backupRun.objectKeys, data.objectKey);
  if (!artifact) {
    return {
      ok: false,
      status: 400,
      error: data.objectKey
        ? "Selected backup artifact was not found on this restore point"
        : "Restore point does not have a storage object key",
    };
  }

  const sameSourceTarget = targetConnection.id === policy.sourceConnectionId;
  const targetScope = postgresConnectionScope(targetConnection.config);
  const requestedTargetDatabase = data.options.targetDatabase?.trim();
  if (targetScope === "SERVER" && !requestedTargetDatabase) {
    return {
      ok: false,
      status: 400,
      error: "Choose a target database when restoring through a SERVER-scoped PostgreSQL connection",
    };
  }
  const targetDatabase = targetScope === "SERVER"
    ? requestedTargetDatabase!
    : databaseNameFromConnectionConfig(targetConnection.config);
  const expectedConfirmation = expectedRestoreConfirmation({
    mode: data.mode,
    targetDatabase,
    sameSourceTarget,
  });
  if (sameSourceTarget && data.mode === "LOGICAL_PG_RESTORE" && !data.options.allowSameSourceRestore) {
    return {
      ok: false,
      status: 409,
      error: "Restoring into the source connection requires explicit same-source confirmation",
    };
  }
  if (data.options.confirmation !== expectedConfirmation) {
    return {
      ok: false,
      status: 400,
      error: `Confirmation phrase must exactly match: ${expectedConfirmation}`,
    };
  }

  return {
    ok: true,
    policy,
    backupRun,
    targetConnection,
    objectKey: artifact.key,
    objectChecksumSha256: artifact.checksumSha256 ?? null,
    expectedConfirmation,
  };
}
