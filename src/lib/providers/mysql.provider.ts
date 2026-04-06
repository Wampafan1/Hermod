/**
 * MysqlProvider — ConnectionProvider for MySQL databases.
 *
 * Uses the `mysql2/promise` package with connection pooling via PoolManager.
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

// mysql2 pool type — avoids importing the module at module level
type MysqlPool = {
  getConnection(): Promise<MysqlPoolConnection>;
  end(): Promise<void>;
};
type MysqlPoolConnection = {
  execute(opts: { sql: string; timeout: number }): Promise<[unknown[], unknown[]]>;
  release(): void;
};

// Shared pool manager
const poolManager = new PoolManager<MysqlPool>(async (pool) => {
  await pool.end();
});

interface MysqlProviderConnection extends ProviderConnection {
  connection: MysqlPoolConnection;
}

export class MysqlProvider implements ConnectionProvider {
  readonly type = "MYSQL";

  async connect(connection: ConnectionLike): Promise<MysqlProviderConnection> {
    const cfg = connection.config as {
      host: string;
      port: number;
      database: string;
      username: string;
    };
    const creds = connection.credentials as { password: string };

    const key = PoolManager.buildKey({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: creds.password,
    });

    const pool = await poolManager.getOrCreate(key, async () => {
      const mysql = await import("mysql2/promise");
      return mysql.createPool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        connectTimeout: CONNECTION_TIMEOUT,
        connectionLimit: POOL_MAX_CONNECTIONS,
        idleTimeout: 60_000,
      }) as unknown as MysqlPool;
    });

    const conn = await pool.getConnection();

    return {
      connection: conn,
      close: async () => {
        // Return to pool
        conn.release();
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    // Bypass pool for test — avoid caching bad credentials
    try {
      const cfg = connection.config as {
        host: string;
        port: number;
        database: string;
        username: string;
      };
      const creds = connection.credentials as { password: string };

      const mysql = await import("mysql2/promise");
      const conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        connectTimeout: CONNECTION_TIMEOUT,
      });
      try {
        await (conn as any).execute({ sql: "SELECT 1", timeout: QUERY_TIMEOUT });
        return true;
      } finally {
        await conn.end();
      }
    } catch {
      return false;
    }
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const mysqlConn = conn as MysqlProviderConnection;
    const [rows, fields] = await mysqlConn.connection.execute({
      sql,
      timeout: QUERY_TIMEOUT,
    });
    const columns =
      (fields as Array<{ name: string }>)?.map((f) => f.name) ?? [];
    return { columns, rows: rows as Record<string, unknown>[] };
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
    database: string,
    table: string
  ): Promise<SchemaDefinition | null> {
    const mysqlConn = conn as MysqlProviderConnection;
    const dbName = database || (conn as any)._database || "information_schema";
    const [rows] = await mysqlConn.connection.execute({
      sql: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}'
              AND TABLE_NAME = '${table.replace(/'/g, "''")}'
            ORDER BY ORDINAL_POSITION`,
      timeout: QUERY_TIMEOUT,
    });

    const resultRows = rows as Record<string, unknown>[];
    if (resultRows.length === 0) return null;

    return {
      fields: resultRows.map((r) => ({
        name: r.COLUMN_NAME as string,
        type: mysqlTypeToBifrost(r.DATA_TYPE as string),
        mode: r.IS_NULLABLE === "NO" ? "REQUIRED" : "NULLABLE",
      })),
    };
  }

  async createTable(
    conn: ProviderConnection,
    database: string,
    table: string,
    schemaDef: SchemaDefinition
  ): Promise<void> {
    const mysqlConn = conn as MysqlProviderConnection;
    const dbName = database || (conn as any)._database;

    if (dbName) {
      await mysqlConn.connection.execute({
        sql: `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, "``")}\``,
        timeout: QUERY_TIMEOUT,
      });
    }

    const colDefs = schemaDef.fields
      .map((f) => {
        const sqlType = bifrostTypeToMysql(f.type);
        const nullable = f.mode === "REQUIRED" ? " NOT NULL" : "";
        return `\`${f.name.replace(/`/g, "``")}\` ${sqlType}${nullable}`;
      })
      .join(", ");

    const prefix = dbName ? `\`${dbName.replace(/`/g, "``")}\`.` : "";
    await mysqlConn.connection.execute({
      sql: `CREATE TABLE ${prefix}\`${table.replace(/`/g, "``")}\` (${colDefs})`,
      timeout: QUERY_TIMEOUT,
    });
  }

  async load(
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    config: DestConfig
  ): Promise<LoadResult> {
    if (rows.length === 0) return { rowsLoaded: 0, errors: [] };

    const mysqlConn = conn as MysqlProviderConnection;
    const dbName = config.dataset;
    const prefix = dbName ? `\`${dbName.replace(/`/g, "``")}\`.` : "";
    const fullTable = `${prefix}\`${config.table.replace(/`/g, "``")}\``;

    if (config.writeDisposition === "WRITE_TRUNCATE") {
      await mysqlConn.connection.execute({
        sql: `TRUNCATE TABLE ${fullTable}`,
        timeout: QUERY_TIMEOUT,
      });
    }

    const columns = Object.keys(rows[0]);
    const colList = columns.map((c) => `\`${c.replace(/`/g, "``")}\``).join(", ");
    const placeholders = columns.map(() => "?").join(", ");

    // MySQL allows bulk inserts with multi-row VALUES
    const BATCH_SIZE = 500;
    let totalLoaded = 0;
    const errors: Array<{ message: string; location?: string }> = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];

      for (const row of batch) {
        for (const col of columns) {
          values.push(row[col] ?? null);
        }
        rowPlaceholders.push(`(${placeholders})`);
      }

      try {
        await mysqlConn.connection.execute({
          sql: `INSERT INTO ${fullTable} (${colList}) VALUES ${rowPlaceholders.join(", ")}`,
          timeout: QUERY_TIMEOUT,
        });
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

function mysqlTypeToBifrost(mysqlType: string): string {
  switch (mysqlType.toLowerCase()) {
    case "int":
    case "smallint":
    case "tinyint":
    case "mediumint":
    case "bigint":
      return "INTEGER";
    case "float":
    case "double":
    case "decimal":
      return "FLOAT";
    case "tinyint(1)":
    case "bit":
      return "BOOLEAN";
    case "datetime":
    case "timestamp":
      return "TIMESTAMP";
    case "date":
      return "DATE";
    case "json":
      return "RECORD";
    default:
      return "STRING";
  }
}

function bifrostTypeToMysql(bifrostType: string): string {
  switch (bifrostType.toUpperCase()) {
    case "INTEGER":
      return "BIGINT";
    case "FLOAT":
      return "DOUBLE";
    case "BOOLEAN":
      return "TINYINT(1)";
    case "TIMESTAMP":
      return "DATETIME";
    case "DATE":
      return "DATE";
    case "RECORD":
      return "JSON";
    default:
      return "TEXT";
  }
}
