/**
 * PostgresProvider — ConnectionProvider for PostgreSQL databases.
 *
 * Uses the `pg` package with connection pooling via PoolManager.
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

type PgPool = InstanceType<typeof import("pg").Pool>;

interface PgProviderConnection extends ProviderConnection {
  client: InstanceType<typeof import("pg").PoolClient>;
}

// Shared pool manager — lives for the process lifetime
const poolManager = new PoolManager<PgPool>(async (pool) => {
  await pool.end();
});

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

    const pool = await poolManager.getOrCreate(key, async () => {
      const { default: pg } = await import("pg");
      return new pg.Pool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
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

      const { default: pg } = await import("pg");
      const client = new pg.Client({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.username,
        password: creds.password,
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
    } catch {
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
}
