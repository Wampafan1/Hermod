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
import type { SourceConfig } from "@/lib/bifrost/types";
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
}
