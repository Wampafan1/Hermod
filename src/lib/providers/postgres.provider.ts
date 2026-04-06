/**
 * PostgresProvider — ConnectionProvider for PostgreSQL databases.
 *
 * Uses the `pg` package with connection pooling via PoolManager.
 * Pools are keyed by host+port+db+user and reused across requests.
 */

import { lookup } from "dns/promises";
import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig, DestConfig, LoadResult, SchemaDefinition } from "@/lib/bifrost/types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";
import { PoolManager, POOL_MAX_CONNECTIONS } from "./pool-manager";

type PgPool = InstanceType<typeof import("pg").Pool>;

interface PgProviderConnection extends ProviderConnection {
  client: InstanceType<typeof import("pg").PoolClient>;
}

// Shared pool manager — lives for the process lifetime
const poolManager = new PoolManager<PgPool>(async (pool) => {
  await pool.end();
});

/**
 * Resolve a hostname, preferring IPv4. Falls back to IPv6, then the raw host.
 * Prevents ENOTFOUND on hosts that only publish AAAA records when the
 * local network doesn't route IPv6 properly.
 */
async function resolveHost(host: string): Promise<string> {
  try {
    const result = await lookup(host, { family: 4 });
    return result.address;
  } catch {
    try {
      const result = await lookup(host, { family: 6 });
      return result.address;
    } catch {
      return host;
    }
  }
}

export class PostgresProvider implements ConnectionProvider {
  readonly type = "POSTGRES";

  async connect(connection: ConnectionLike): Promise<PgProviderConnection> {
    const cfg = connection.config as {
      host: string;
      port: number;
      database: string;
      username: string;
      ssl?: boolean;
    };
    const creds = connection.credentials as { password: string };

    const key = PoolManager.buildKey({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: creds.password,
    });

    const resolvedHost = await resolveHost(cfg.host);
    const pool = await poolManager.getOrCreate(key, async () => {
      const { default: pg } = await import("pg");
      return new pg.Pool({
        host: resolvedHost,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        ssl: cfg.ssl !== false ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: CONNECTION_TIMEOUT,
        statement_timeout: QUERY_TIMEOUT,
        max: POOL_MAX_CONNECTIONS,
        idleTimeoutMillis: 60_000,
      });
    });

    const client = await pool.connect();

    return {
      client,
      close: async () => {
        // Return to pool instead of destroying
        client.release();
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    // Test connections bypass the pool — use a direct client to avoid
    // caching pools with potentially bad credentials.
    try {
      const cfg = connection.config as {
        host: string;
        port: number;
        database: string;
        username: string;
        ssl?: boolean;
      };
      const creds = connection.credentials as { password: string };

      const resolvedHost = await resolveHost(cfg.host);
      const { default: pg } = await import("pg");
      const client = new pg.Client({
        host: resolvedHost,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        ssl: cfg.ssl !== false ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: CONNECTION_TIMEOUT,
        statement_timeout: QUERY_TIMEOUT,
      });
      await client.connect();
      try {
        await client.query("SELECT 1");
        return true;
      } finally {
        await client.end();
      }
    } catch (err) {
      console.error("[PG testConnection]", err instanceof Error ? err.message : err);
      return false;
    }
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const pgConn = conn as PgProviderConnection;
    const result = await pgConn.client.query(sql);
    const columns = result.fields.map((f: { name: string }) => f.name);
    return { columns, rows: result.rows };
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const { resolveQueryParams } = await import("./helpers");
    const sql = resolveQueryParams(config);
    const result = await this.query(conn, sql);
    yield result.rows.length > 0 ? result.rows : [];
  }

  // ─── Destination methods ────────────────────────────

  async getSchema(
    conn: ProviderConnection,
    schema: string,
    table: string
  ): Promise<SchemaDefinition | null> {
    const pgConn = conn as PgProviderConnection;
    const result = await pgConn.client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema || "public", table]
    );

    if (result.rows.length === 0) return null;

    return {
      fields: result.rows.map((r: Record<string, unknown>) => ({
        name: r.column_name as string,
        type: pgTypeToBifrost(r.data_type as string),
        mode: r.is_nullable === "NO" ? "REQUIRED" : "NULLABLE",
      })),
    };
  }

  async createTable(
    conn: ProviderConnection,
    schema: string,
    table: string,
    schemaDef: SchemaDefinition
  ): Promise<void> {
    const pgConn = conn as PgProviderConnection;
    const schemaName = schema || "public";

    // Ensure schema exists
    await pgConn.client.query(
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`
    );

    const colDefs = schemaDef.fields
      .map((f) => {
        const sqlType = bifrostTypeToPg(f.type);
        const nullable = f.mode === "REQUIRED" ? " NOT NULL" : "";
        return `${quoteIdent(f.name)} ${sqlType}${nullable}`;
      })
      .join(", ");

    await pgConn.client.query(
      `CREATE TABLE ${quoteIdent(schemaName)}.${quoteIdent(table)} (${colDefs})`
    );
  }

  async load(
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    config: DestConfig
  ): Promise<LoadResult> {
    if (rows.length === 0) return { rowsLoaded: 0, errors: [] };

    const pgConn = conn as PgProviderConnection;
    const schemaName = config.dataset || "public";
    const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(config.table)}`;

    // Handle write disposition
    if (config.writeDisposition === "WRITE_TRUNCATE") {
      await pgConn.client.query(`TRUNCATE TABLE ${fullTable}`);
    }

    const columns = Object.keys(rows[0]);
    const colList = columns.map(quoteIdent).join(", ");

    // Batch insert using multi-row VALUES with parameterized queries.
    // Process in chunks of 500 rows to stay within Postgres param limits.
    const BATCH_SIZE = 500;
    let totalLoaded = 0;
    const errors: Array<{ message: string; location?: string }> = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const valueClauses: string[] = [];

      for (const row of batch) {
        const placeholders = columns.map((_, ci) => {
          values.push(row[columns[ci]] ?? null);
          return `$${values.length}`;
        });
        valueClauses.push(`(${placeholders.join(", ")})`);
      }

      try {
        await pgConn.client.query(
          `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}`,
          values
        );
        totalLoaded += batch.length;
      } catch (err) {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          location: `rows ${i}-${i + batch.length - 1}`,
        });
      }
    }

    return { rowsLoaded: totalLoaded, errors };
  }
}

// ─── Helpers ──────────────────────────────────────────

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function pgTypeToBifrost(pgType: string): string {
  switch (pgType.toLowerCase()) {
    case "integer":
    case "smallint":
    case "bigint":
      return "INTEGER";
    case "real":
    case "double precision":
    case "numeric":
    case "decimal":
      return "FLOAT";
    case "boolean":
      return "BOOLEAN";
    case "timestamp without time zone":
    case "timestamp with time zone":
      return "TIMESTAMP";
    case "date":
      return "DATE";
    case "json":
    case "jsonb":
      return "RECORD";
    default:
      return "STRING";
  }
}

function bifrostTypeToPg(bifrostType: string): string {
  switch (bifrostType.toUpperCase()) {
    case "INTEGER":
      return "BIGINT";
    case "FLOAT":
      return "DOUBLE PRECISION";
    case "BOOLEAN":
      return "BOOLEAN";
    case "TIMESTAMP":
      return "TIMESTAMPTZ";
    case "DATE":
      return "DATE";
    case "RECORD":
      return "JSONB";
    default:
      return "TEXT";
  }
}
