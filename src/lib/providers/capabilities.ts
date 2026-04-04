import type { ConnectionType, ProviderCapabilities } from "./types";

export type { ConnectionType } from "./types";

export const PROVIDER_CAPABILITIES: Record<ConnectionType, ProviderCapabilities> = {
  POSTGRES:  { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MSSQL:     { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MYSQL:     { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  BIGQUERY:  { canBeSource: true,  canBeDestination: true,  canQuery: true,  canStream: true,  canBulkLoad: true,  canListTables: true  },
  NETSUITE:  { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  SFTP:      { canBeSource: true,  canBeDestination: true,  canQuery: false, canStream: true,  canBulkLoad: true,  canListTables: false, fileFormats: ["CSV", "TSV", "XLSX"] },
  REST_API:      { canBeSource: true,  canBeDestination: false, canQuery: false, canStream: true,  canBulkLoad: false, canListTables: false },
  CSV_FILE:      { canBeSource: true,  canBeDestination: false, canQuery: false, canStream: false, canBulkLoad: false, canListTables: false, fileFormats: ["CSV", "TSV"] },
  EXCEL_FILE:    { canBeSource: true,  canBeDestination: false, canQuery: false, canStream: false, canBulkLoad: false, canListTables: false, fileFormats: ["XLSX", "XLS"] },
  GOOGLE_SHEETS: { canBeSource: true,  canBeDestination: false, canQuery: false, canStream: false, canBulkLoad: false, canListTables: false },
};

export function getCapabilities(type: ConnectionType): ProviderCapabilities {
  const caps = PROVIDER_CAPABILITIES[type];
  if (!caps) throw new Error(`Unknown connection type: ${type}`);
  return caps;
}

export function canBeSource(type: ConnectionType): boolean {
  return getCapabilities(type).canBeSource;
}

export function canBeDestination(type: ConnectionType): boolean {
  return getCapabilities(type).canBeDestination;
}

export function canQuery(type: ConnectionType): boolean {
  return getCapabilities(type).canQuery;
}
