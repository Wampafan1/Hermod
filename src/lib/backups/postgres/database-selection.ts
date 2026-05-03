import type { ConnectionLike } from "@/lib/providers/types";
import { PostgresProvider, type PostgresDatabaseInfo } from "@/lib/providers/postgres.provider";

export const DATABASE_SELECTION_MODES = [
  "SINGLE",
  "MULTIPLE",
  "ALL_NON_TEMPLATE",
  "PATTERN",
] as const;

export type DatabaseSelectionMode = typeof DATABASE_SELECTION_MODES[number];

export interface BackupDatabaseSelectionPolicy {
  databaseSelectionMode?: string | null;
  selectedDatabases?: string[] | null;
  excludedDatabases?: string[] | null;
  databasePattern?: string | null;
  sourceConnection: {
    config: unknown;
  };
}

export function postgresConnectionScope(config: unknown): "DATABASE" | "SERVER" {
  if (config && typeof config === "object" && (config as { scope?: unknown }).scope === "SERVER") {
    return "SERVER";
  }
  return "DATABASE";
}

export function configuredDatabase(config: unknown): string {
  if (config && typeof config === "object") {
    const database = (config as { database?: unknown }).database;
    if (typeof database === "string" && database.trim()) return database.trim();
  }
  return "postgres";
}

export function maintenanceDatabase(config: unknown): string {
  if (config && typeof config === "object") {
    const database = (config as { maintenanceDatabase?: unknown }).maintenanceDatabase;
    if (typeof database === "string" && database.trim()) return database.trim();
  }
  return "postgres";
}

function cleanNames(values: string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

export function selectDatabases(input: {
  mode: DatabaseSelectionMode;
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
      if (selected.length !== 1) {
        throw new Error("Select exactly one database for SINGLE backup mode");
      }
      candidates = selected;
      break;
    case "MULTIPLE":
      if (selected.length === 0) {
        throw new Error("Select at least one database for MULTIPLE backup mode");
      }
      candidates = selected;
      break;
    case "ALL_NON_TEMPLATE":
      candidates = discovered;
      break;
    case "PATTERN": {
      if (!input.databasePattern?.trim()) {
        throw new Error("Database pattern is required for PATTERN backup mode");
      }
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

  const selectedSet = new Set(candidates);
  const notDiscovered = candidates.filter((database) => !discovered.includes(database));
  if (notDiscovered.length > 0) {
    throw new Error(`Selected database was not discovered on the PostgreSQL server: ${notDiscovered.join(", ")}`);
  }

  return discovered.filter((database) => selectedSet.has(database) && !excluded.has(database));
}

export async function resolvePolicyDatabases(
  policy: BackupDatabaseSelectionPolicy,
  connection: ConnectionLike,
  provider = new PostgresProvider()
): Promise<string[]> {
  if (postgresConnectionScope(policy.sourceConnection.config) !== "SERVER") {
    return [configuredDatabase(policy.sourceConnection.config)];
  }

  const discovered = await provider.listDatabases(connection);
  const names = discovered.map((database: PostgresDatabaseInfo) => database.name);
  const databases = selectDatabases({
    mode: (policy.databaseSelectionMode as DatabaseSelectionMode) ?? "SINGLE",
    discoveredDatabases: names,
    selectedDatabases: policy.selectedDatabases,
    excludedDatabases: policy.excludedDatabases,
    databasePattern: policy.databasePattern,
  });

  if (databases.length === 0) {
    throw new Error("No PostgreSQL databases matched this backup policy");
  }
  return databases;
}
