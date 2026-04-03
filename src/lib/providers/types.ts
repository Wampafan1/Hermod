export type ConnectionType =
  | "POSTGRES"
  | "MSSQL"
  | "MYSQL"
  | "BIGQUERY"
  | "NETSUITE"
  | "SFTP"
  | "REST_API"
  | "CSV_FILE"
  | "EXCEL_FILE"
  | "GOOGLE_SHEETS";

export type ConnectionStatus = "ACTIVE" | "ERROR" | "DISABLED";

export interface ProviderCapabilities {
  canBeSource: boolean;
  canBeDestination: boolean;
  canQuery: boolean;
  canStream: boolean;
  canBulkLoad: boolean;
  canListTables: boolean;
  fileFormats?: string[];
}

/** Minimal shape for provider operations -- DB row or test payload */
export interface ConnectionLike {
  type: ConnectionType;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface ProviderConnection {
  close(): Promise<void>;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}
