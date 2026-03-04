/**
 * ConnectionProvider — Unified interface for all connection types.
 *
 * Replaces both DataSourceConnector (connectors.ts) and CloudProvider
 * (bifrost/types.ts) with a single capability-gated interface.
 */

import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";

import type {
  SourceConfig,
  DestConfig,
  LoadResult,
  SchemaDefinition,
} from "@/lib/bifrost/types";

export interface ConnectionProvider {
  readonly type: string;

  /** Open a persistent connection, returning a handle with close(). */
  connect(connection: ConnectionLike): Promise<ProviderConnection>;

  /** Quick connect + SELECT 1 + close. Returns true on success. */
  testConnection(connection: ConnectionLike): Promise<boolean>;

  // ─── Optional — gated by provider capabilities ────────

  /** Execute arbitrary SQL and return columns + rows. */
  query?(conn: ProviderConnection, sql: string): Promise<QueryResult>;

  /** Stream rows from a source in chunks (AsyncGenerator). */
  extract?(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]>;

  /** Bulk-load rows into a destination table. */
  load?(
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    config: DestConfig
  ): Promise<LoadResult>;

  /** Retrieve schema for a dataset.table. */
  getSchema?(
    conn: ProviderConnection,
    dataset: string,
    table: string
  ): Promise<SchemaDefinition | null>;

  /** Create a table from a schema definition. */
  createTable?(
    conn: ProviderConnection,
    dataset: string,
    table: string,
    schema: SchemaDefinition
  ): Promise<void>;
}

// ─── Shared Constants ─────────────────────────────────────

export const CONNECTION_TIMEOUT = 30_000;
export const QUERY_TIMEOUT = 120_000;
