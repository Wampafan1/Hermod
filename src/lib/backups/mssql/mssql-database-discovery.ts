import type { ConnectionLike } from "@/lib/providers/types";
import { MssqlProvider, type MssqlDatabaseInfo } from "@/lib/providers/mssql.provider";

export const MSSQL_DATABASE_SELECTION_MODES = [
  "SINGLE",
  "MULTIPLE",
  "ALL_USER_DATABASES",
  "PATTERN",
] as const;

export type MssqlDatabaseSelectionMode = typeof MSSQL_DATABASE_SELECTION_MODES[number];

export interface MssqlDatabaseSelectionPolicy {
  databaseSelectionMode?: string | null;
  selectedDatabases?: string[] | null;
  excludedDatabases?: string[] | null;
  databasePattern?: string | null;
  sourceConnection: {
    config: unknown;
  };
}

export function mssqlConnectionScope(config: unknown): "DATABASE" | "SERVER" {
  if (config && typeof config === "object" && (config as { scope?: unknown }).scope === "SERVER") {
    return "SERVER";
  }
  return "DATABASE";
}

export function configuredMssqlDatabase(config: unknown): string {
  if (config && typeof config === "object") {
    const database = (config as { database?: unknown }).database;
    if (typeof database === "string" && database.trim()) return database.trim();
  }
  return "master";
}

export function maintenanceMssqlDatabase(config: unknown): string {
  if (config && typeof config === "object") {
    const database = (config as { maintenanceDatabase?: unknown }).maintenanceDatabase;
    if (typeof database === "string" && database.trim()) return database.trim();
  }
  return "master";
}

function cleanNames(values: string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

export function selectMssqlDatabases(input: {
  mode: MssqlDatabaseSelectionMode;
  discoveredDatabases: string[];
  selectedDatabases?: string[] | null;
  excludedDatabases?: string[] | null;
  databasePattern?: string | null;
}): string[] {
  const discovered = cleanNames(input.discoveredDatabases);
  const selected = cleanNames(input.selectedDatabases);
  const excluded = new Set(cleanNames(input.excludedDatabases));

  let candidates: string[];
  switch (input.mode) {
    case "SINGLE":
      if (selected.length !== 1) throw new Error("Select exactly one database for SINGLE backup mode");
      candidates = selected;
      break;
    case "MULTIPLE":
      if (selected.length === 0) throw new Error("Select at least one database for MULTIPLE backup mode");
      candidates = selected;
      break;
    case "ALL_USER_DATABASES":
      candidates = discovered;
      break;
    case "PATTERN": {
      if (!input.databasePattern?.trim()) throw new Error("Database pattern is required for PATTERN backup mode");
      let pattern: RegExp;
      try {
        pattern = new RegExp(input.databasePattern);
      } catch {
        throw new Error("Database pattern must be a valid regular expression");
      }
      candidates = discovered.filter((database) => pattern.test(database));
      break;
    }
    default:
      candidates = selected;
  }

  const notDiscovered = candidates.filter((database) => !discovered.includes(database));
  if (notDiscovered.length > 0) {
    throw new Error(`Selected database was not discovered on the SQL Server instance: ${notDiscovered.join(", ")}`);
  }

  const selectedSet = new Set(candidates);
  return discovered.filter((database) => selectedSet.has(database) && !excluded.has(database));
}

export async function resolveMssqlPolicyDatabases(
  policy: MssqlDatabaseSelectionPolicy,
  connection: ConnectionLike,
  provider = new MssqlProvider()
): Promise<MssqlDatabaseInfo[]> {
  if (mssqlConnectionScope(policy.sourceConnection.config) !== "SERVER") {
    return [{
      name: configuredMssqlDatabase(policy.sourceConnection.config),
      state: "ONLINE",
      recoveryModel: "UNKNOWN",
      canConnect: true,
    }];
  }

  const discovered = await provider.listDatabases(connection);
  const names = discovered.map((database) => database.name);
  const databases = selectMssqlDatabases({
    mode: (policy.databaseSelectionMode as MssqlDatabaseSelectionMode) ?? "SINGLE",
    discoveredDatabases: names,
    selectedDatabases: policy.selectedDatabases,
    excludedDatabases: policy.excludedDatabases,
    databasePattern: policy.databasePattern,
  });

  if (databases.length === 0) {
    throw new Error("No SQL Server databases matched this backup policy");
  }

  const selected = new Set(databases);
  return discovered.filter((database) => selected.has(database.name));
}
