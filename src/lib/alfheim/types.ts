// ---------------------------------------------------------------------------
// Alfheim API Connector — shared types
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  jsonPath: string; // "shipping_address.city"
  columnName: string; // "shipping_address_city"
  dataType: "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "TIMESTAMP" | "JSON";
  nullable: boolean;
}

export interface ChildTableMapping {
  jsonPath: string; // "line_items"
  tableName: string; // "orders_line_items"
  foreignKey: string; // "order_id"
  columns: ColumnMapping[];
}

export interface SchemaMapping {
  columns: ColumnMapping[];
  childTables?: ChildTableMapping[];
}

export type PaginationType =
  | "cursor"
  | "offset"
  | "link_header"
  | "page_number"
  | "none";

export interface PaginationConfig {
  type: PaginationType;
  pageParam?: string;
  limitParam?: string;
  defaultLimit?: number;
  cursorPath?: string;
  totalPath?: string;
  /** Use POST with JSON body instead of GET with query params (e.g. SkuVault). */
  requestMethod?: "GET" | "POST";
  /** Starting page index for page_number pagination (default 1). Set to 0 for 0-based APIs. */
  startPage?: number;
  /** JSON path to a boolean/count indicating more pages exist. */
  hasMorePath?: string;
}

export interface RateLimitConfig {
  requestsPerSecond?: number;
  burstLimit?: number;
  retryAfterHeader?: string;
}

export interface AuthField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required: boolean;
}

export interface AuthConfig {
  fields: AuthField[];
  headerName?: string;
  tokenPrefix?: string;
  urlPlaceholders?: string[];
  /** Inject credentials into POST body instead of headers (e.g. SkuVault). */
  bodyAuth?: boolean;
  /** Maps request body key → credential field name. E.g. { "TenantToken": "tenantToken" }. */
  bodyTokenMap?: Record<string, string>;
}

export type SqlDialect = "postgres" | "mssql" | "mysql" | "bigquery";
