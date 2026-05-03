/**
 * MssqlProvider — ConnectionProvider for SQL Server databases.
 *
 * Uses the `mssql` package with connection pooling via PoolManager.
 * Pools are keyed by host+port+db+user and reused across requests.
 */

import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig, DestConfig, LoadResult, SchemaDefinition } from "@/lib/bifrost/types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";
import { PoolManager, POOL_MAX_CONNECTIONS } from "./pool-manager";

// mssql pool type
type MssqlPool = {
  request(): { query(sql: string): Promise<unknown> };
  close(): Promise<void>;
  connected: boolean;
};

// Shared pool manager
const poolManager = new PoolManager<MssqlPool>(async (pool) => {
  if (pool.connected) {
    await pool.close();
  }
});

interface MssqlProviderConnection extends ProviderConnection {
  pool: MssqlPool;
}

interface MssqlConfig {
  host: string;
  port: number;
  database?: string;
  maintenanceDatabase?: string;
  username: string;
  scope?: "DATABASE" | "SERVER";
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  ssl?: boolean;
  requestTimeoutMs?: number;
}

export interface MssqlDatabaseInfo {
  name: string;
  databaseId?: number;
  state: string;
  recoveryModel: string;
  createDate?: Date | string;
  sizeBytes?: string;
  canConnect?: boolean;
}

export function effectiveMssqlDatabase(cfg: MssqlConfig): string {
  return cfg.scope === "SERVER"
    ? cfg.maintenanceDatabase || "master"
    : cfg.database || "master";
}

function poolConfig(connection: ConnectionLike, database?: string) {
  const cfg = connection.config as unknown as MssqlConfig;
  const creds = connection.credentials as { password: string };
  const db = database || effectiveMssqlDatabase(cfg);
  return {
    cfg,
    creds,
    database: db,
    options: {
      server: cfg.host,
      port: cfg.port,
      database: db,
      user: cfg.username,
      password: creds.password,
      options: {
        encrypt: cfg.encrypt ?? cfg.ssl ?? false,
        trustServerCertificate: cfg.trustServerCertificate ?? true,
      },
      connectionTimeout: CONNECTION_TIMEOUT,
      requestTimeout: cfg.requestTimeoutMs ?? QUERY_TIMEOUT,
    },
  };
}

export class MssqlProvider implements ConnectionProvider {
  readonly type = "MSSQL";

  async connect(connection: ConnectionLike): Promise<MssqlProviderConnection> {
    const { cfg, creds, database, options } = poolConfig(connection);

    const key = PoolManager.buildKey({
      host: cfg.host,
      port: cfg.port,
      database,
      user: cfg.username,
      password: creds.password,
      requestTimeout: cfg.requestTimeoutMs ?? QUERY_TIMEOUT,
    });

    const pool = await poolManager.getOrCreate(key, async () => {
      const mssql = await import("mssql");
      return (await mssql.default.connect({
        ...options,
        pool: {
          max: POOL_MAX_CONNECTIONS,
          min: 0,
          idleTimeoutMillis: 60_000,
        },
      })) as unknown as MssqlPool;
    });

    return {
      pool,
      close: async () => {
        // mssql pools are shared — don't close the pool on each "release".
        // The PoolManager reaper handles idle cleanup.
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    // Bypass pool for test — avoid caching bad credentials
    let pool: MssqlPool | null = null;
    try {
      const { options } = poolConfig(connection);

      const mssql = await import("mssql");
      pool = (await mssql.default.connect({
        ...options,
      })) as unknown as MssqlPool;
      await pool.request().query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      if (pool) await pool.close();
    }
  }

  async listDatabases(connection: ConnectionLike): Promise<MssqlDatabaseInfo[]> {
    const conn = await this.connect(connection);
    try {
      const result = await conn.pool.request().query(`
        SELECT
          d.name,
          d.database_id AS databaseId,
          d.state_desc AS state,
          d.recovery_model_desc AS recoveryModel,
          d.create_date AS createDate,
          CAST(COALESCE(SUM(mf.size), 0) * 8 * 1024 AS BIGINT) AS sizeBytes
        FROM sys.databases d
        LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id
        WHERE d.database_id > 4
          AND d.state_desc = 'ONLINE'
        GROUP BY d.name, d.database_id, d.state_desc, d.recovery_model_desc, d.create_date
        ORDER BY d.name;
      `) as { recordset: Array<Record<string, unknown>> };

      return result.recordset.map((row) => ({
        name: String(row.name),
        databaseId: row.databaseId == null ? undefined : Number(row.databaseId),
        state: String(row.state ?? "UNKNOWN"),
        recoveryModel: String(row.recoveryModel ?? "UNKNOWN"),
        createDate: row.createDate instanceof Date ? row.createDate : row.createDate ? String(row.createDate) : undefined,
        sizeBytes: row.sizeBytes == null ? undefined : String(row.sizeBytes),
        canConnect: true,
      }));
    } finally {
      await conn.close();
    }
  }

  async connectToDatabase(connection: ConnectionLike, databaseName: string): Promise<MssqlProviderConnection> {
    return this.connect({
      ...connection,
      config: {
        ...(connection.config as Record<string, unknown>),
        scope: "DATABASE",
        database: databaseName,
      },
    });
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const mssqlConn = conn as MssqlProviderConnection;
    const result = await mssqlConn.pool.request().query(sql) as {
      recordset: Record<string, unknown>[] & { columns?: Record<string, unknown> };
    };

    const columns = result.recordset.columns
      ? Object.keys(result.recordset.columns)
      : result.recordset.length > 0
        ? Object.keys(result.recordset[0])
        : [];

    // Return a clean copy of rows without mssql's extra properties (e.g. .columns)
    return { columns, rows: [...result.recordset] };
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
    const mssqlConn = conn as MssqlProviderConnection;
    const schemaName = schema || "dbo";
    const result = await mssqlConn.pool.request().query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${schemaName.replace(/'/g, "''")}'
         AND TABLE_NAME = '${table.replace(/'/g, "''")}'
       ORDER BY ORDINAL_POSITION`
    ) as { recordset: Record<string, unknown>[] };

    if (result.recordset.length === 0) return null;

    return {
      fields: result.recordset.map((r) => ({
        name: r.COLUMN_NAME as string,
        type: mssqlTypeToBifrost(r.DATA_TYPE as string),
        mode: r.IS_NULLABLE === "NO" ? "REQUIRED" : "NULLABLE",
      })),
    };
  }

  async createTable(
    conn: ProviderConnection,
    schema: string,
    table: string,
    schemaDef: SchemaDefinition
  ): Promise<void> {
    const mssqlConn = conn as MssqlProviderConnection;
    const schemaName = schema || "dbo";

    // Ensure schema exists
    await mssqlConn.pool.request().query(
      `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${schemaName.replace(/'/g, "''")}')
       EXEC('CREATE SCHEMA [${schemaName.replace(/\]/g, "]]")}]')`
    );

    const colDefs = schemaDef.fields
      .map((f) => {
        const sqlType = bifrostTypeToMssql(f.type);
        const nullable = f.mode === "REQUIRED" ? " NOT NULL" : "";
        return `[${f.name.replace(/\]/g, "]]")}] ${sqlType}${nullable}`;
      })
      .join(", ");

    await mssqlConn.pool.request().query(
      `CREATE TABLE [${schemaName.replace(/\]/g, "]]")}].[${table.replace(/\]/g, "]]")}] (${colDefs})`
    );
  }

  async load(
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    config: DestConfig
  ): Promise<LoadResult> {
    if (rows.length === 0) return { rowsLoaded: 0, errors: [] };

    const mssqlConn = conn as MssqlProviderConnection;
    const schemaName = config.dataset || "dbo";
    const fullTable = `[${schemaName.replace(/\]/g, "]]")}].[${config.table.replace(/\]/g, "]]")}]`;

    if (config.writeDisposition === "WRITE_TRUNCATE") {
      await mssqlConn.pool.request().query(`TRUNCATE TABLE ${fullTable}`);
    }

    const columns = Object.keys(rows[0]);
    const colList = columns.map((c) => `[${c.replace(/\]/g, "]]")}]`).join(", ");

    // MSSQL supports max 1000 rows per INSERT and 2100 params per batch
    const MAX_PARAMS = 2000;
    const batchSize = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
    let totalLoaded = 0;
    const errors: Array<{ message: string; location?: string }> = [];

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valueClauses: string[] = [];

      for (const row of batch) {
        const vals = columns.map((col) => {
          const v = row[col];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "1" : "0";
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        valueClauses.push(`(${vals.join(", ")})`);
      }

      try {
        await mssqlConn.pool.request().query(
          `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}`
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

function mssqlTypeToBifrost(mssqlType: string): string {
  switch (mssqlType.toLowerCase()) {
    case "int":
    case "smallint":
    case "tinyint":
    case "bigint":
      return "INTEGER";
    case "real":
    case "float":
    case "decimal":
    case "numeric":
    case "money":
    case "smallmoney":
      return "FLOAT";
    case "bit":
      return "BOOLEAN";
    case "datetime":
    case "datetime2":
    case "datetimeoffset":
    case "smalldatetime":
      return "TIMESTAMP";
    case "date":
      return "DATE";
    default:
      return "STRING";
  }
}

function bifrostTypeToMssql(bifrostType: string): string {
  switch (bifrostType.toUpperCase()) {
    case "INTEGER":
      return "BIGINT";
    case "FLOAT":
      return "FLOAT";
    case "BOOLEAN":
      return "BIT";
    case "TIMESTAMP":
      return "DATETIME2";
    case "DATE":
      return "DATE";
    case "RECORD":
      return "NVARCHAR(MAX)";
    default:
      return "NVARCHAR(MAX)";
  }
}
