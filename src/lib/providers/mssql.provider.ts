/**
 * MssqlProvider — ConnectionProvider for SQL Server databases.
 *
 * Uses the `mssql` package (ConnectionPool, connect-per-query).
 */

import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";

interface MssqlProviderConnection extends ProviderConnection {
  pool: { request(): { query(sql: string): Promise<unknown> }; close(): Promise<void> };
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

    const mssql = await import("mssql");
    const pool = await mssql.default.connect({
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
    });

    return {
      pool,
      close: async () => {
        await pool.close();
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    let conn: MssqlProviderConnection | null = null;
    try {
      conn = await this.connect(connection);
      await conn.pool.request().query("SELECT 1");
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
    const result = await this.query(conn, config.query);
    yield result.rows.length > 0 ? result.rows : [];
  }
}
