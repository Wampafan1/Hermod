/**
 * PostgresProvider — ConnectionProvider for PostgreSQL databases.
 *
 * Uses the `pg` package (Client, connect-per-query).
 */

import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";

interface PgProviderConnection extends ProviderConnection {
  client: InstanceType<typeof import("pg").Client>;
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

    return {
      client,
      close: async () => {
        await client.end();
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    let conn: PgProviderConnection | null = null;
    try {
      conn = await this.connect(connection);
      await conn.client.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      if (conn) {
        await conn.close();
      }
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
    const result = await this.query(conn, config.query);
    yield result.rows.length > 0 ? result.rows : [];
  }
}
