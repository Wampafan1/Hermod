/**
 * Bifrost — Core type definitions for the routing engine.
 */

// ─── Source / Destination Config ─────────────────────

export interface SourceConfig {
  query: string;
  dataset?: string;
  incrementalKey?: string;
  chunkSize?: number; // default 10_000
  params?: Record<string, unknown>; // BigQuery @param values

  // NetSuite structured config (used by UI to reconstruct picker state)
  recordType?: string;
  fields?: string[];
  referenceFields?: string[]; // fields requiring BUILTIN.DF() wrapping in SuiteQL
  filter?: string | null;

  // REST API extraction config (populated from ApiCatalogObject)
  objectSlug?: string;       // which catalog object to extract (e.g. "v1-orders")
  endpoint?: string;         // path appended to connection baseUrl
  responseRoot?: string;     // JSON path to data array in response (e.g. "data.items")
  schema?: import("@/lib/alfheim/types").SchemaMapping;
}

export interface DestConfig {
  dataset: string;
  table: string;
  writeDisposition: "WRITE_APPEND" | "WRITE_TRUNCATE" | "WRITE_EMPTY";
  autoCreateTable: boolean;
  schema?: SchemaDefinition | null;
  chunkSize?: number; // rows per load job batch (default DEFAULT_CHUNK_SIZE = 10,000)
}

// ─── Schema ──────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: string; // "STRING", "INTEGER", "FLOAT", "TIMESTAMP", "BOOLEAN", "RECORD", etc.
  mode: string; // "NULLABLE", "REQUIRED", "REPEATED"
  description?: string;
  fields?: SchemaField[]; // nested for RECORD type
}

export interface SchemaDefinition {
  fields: SchemaField[];
}

// ─── Load Result ─────────────────────────────────────

export interface LoadResult {
  rowsLoaded: number;
  errors: Array<{ message: string; location?: string }>;
}

// ─── Engine ──────────────────────────────────────────

export interface RouteJobResult {
  routeLogId: string;
  status: "completed" | "partial" | "failed" | "skipped";
  totalExtracted: number;
  totalLoaded: number;
  errorCount: number;
  duration: number; // milliseconds
}

export interface RouteJobPayload {
  routeId: string;
  triggeredBy: "schedule" | "manual" | "webhook";
}

// ─── Helheim ─────────────────────────────────────────

export type HelheimErrorType =
  | "load_failure"
  | "transform_failure"
  | "auth_failure"
  | "timeout";

export type HelheimStatus = "pending" | "retrying" | "recovered" | "dead";

// ─── Forge Validation ────────────────────────────────

export interface ForgeStreamingValidation {
  valid: boolean;
  statefulSteps: string[];
  suggestion: string | null;
}

// ─── Constants ───────────────────────────────────────

export const DEFAULT_CHUNK_SIZE = 10_000;
export const DEFAULT_MAX_RETRIES = 3;
export const RETRY_DELAYS_SEC = [5 * 60, 30 * 60, 2 * 60 * 60]; // 5min, 30min, 2hr
