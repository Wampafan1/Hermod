import type { AuthContext } from "@/lib/api";
import { prisma } from "@/lib/db";
import type { CreateMssqlBackupPolicyInput, UpdateMssqlBackupPolicyInput } from "@/lib/validations/mssql-backups";
import {
  configuredMssqlDatabase,
  mssqlConnectionScope,
  type MssqlDatabaseSelectionMode,
} from "./mssql-database-discovery";

export async function validateMssqlBackupPolicyReferences(
  data: Pick<CreateMssqlBackupPolicyInput, "sourceConnectionId" | "storageTargetId" | "databaseSelectionMode" | "selectedDatabases" | "databasePattern">,
  ctx: AuthContext
): Promise<{ ok: true; sourceConfig: unknown } | { ok: false; status: number; error: string }> {
  const source = await prisma.connection.findFirst({
    where: { id: data.sourceConnectionId, userId: ctx.userId },
    select: { id: true, type: true, config: true },
  });
  if (!source) return { ok: false, status: 404, error: "SQL Server source connection not found" };
  if (source.type !== "MSSQL") return { ok: false, status: 400, error: "Backup source connection must be MSSQL" };

  const sourceScope = mssqlConnectionScope(source.config);
  if (sourceScope === "SERVER") {
    const mode = (data.databaseSelectionMode ?? "SINGLE") as MssqlDatabaseSelectionMode;
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

  if (data.storageTargetId) {
    const target = await prisma.backupStorageTarget.findFirst({
      where: {
        id: data.storageTargetId,
        OR: [{ tenantId: ctx.tenantId }, { userId: ctx.userId }],
      },
      select: { id: true },
    });
    if (!target) return { ok: false, status: 404, error: "Storage target not found" };
  }

  return { ok: true, sourceConfig: source.config };
}

export function normalizeMssqlDatabaseSelection(
  data: Pick<CreateMssqlBackupPolicyInput | UpdateMssqlBackupPolicyInput, "databaseSelectionMode" | "selectedDatabases" | "excludedDatabases" | "databasePattern">,
  sourceConfig: unknown
): {
  databaseSelectionMode: "SINGLE" | "MULTIPLE" | "ALL_USER_DATABASES" | "PATTERN";
  selectedDatabases: string[];
  excludedDatabases: string[];
  databasePattern: string | null;
} {
  if (mssqlConnectionScope(sourceConfig) !== "SERVER") {
    return {
      databaseSelectionMode: "SINGLE",
      selectedDatabases: [configuredMssqlDatabase(sourceConfig)],
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

export function serializeMssqlRun<T extends { bytesWritten: bigint | number | null }>(
  run: T
): Omit<T, "bytesWritten"> & { bytesWritten: string | null } {
  return {
    ...run,
    bytesWritten: run.bytesWritten == null ? null : run.bytesWritten.toString(),
  };
}
