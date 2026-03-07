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
import type { SourceConfig } from "@/lib/bifrost/types";
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

export class MssqlProvider implements ConnectionProvider {
  readonly type = "MSSQL";

  async connect(connection: ConnectionLike): Promise<MssqlProviderConnection> {
    const cfg = connection.config as {
      host: string;
      port: number;
      database: string;
      username: string;
      encrypt?: boolean;
      trustServerCertificate?: boolean;
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
      const mssql = await import("mssql");
      return (await mssql.default.connect({
        server: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        options: {
          encrypt: cfg.encrypt ?? false,
          trustServerCertificate: cfg.trustServerCertificate ?? true,
        },
        connectionTimeout: CONNECTION_TIMEOUT,
        requestTimeout: QUERY_TIMEOUT,
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
      const cfg = connection.config as {
        host: string;
        port: number;
        database: string;
        username: string;
        encrypt?: boolean;
        trustServerCertificate?: boolean;
      };
      const creds = connection.credentials as { password: string };

      const mssql = await import("mssql");
      pool = (await mssql.default.connect({
        server: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
        options: {
          encrypt: cfg.encrypt ?? false,
          trustServerCertificate: cfg.trustServerCertificate ?? true,
        },
        connectionTimeout: CONNECTION_TIMEOUT,
        requestTimeout: QUERY_TIMEOUT,
      })) as unknown as MssqlPool;
      await pool.request().query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      if (pool) await pool.close();
    }
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
}
