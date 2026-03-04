/**
 * MysqlProvider — ConnectionProvider for MySQL databases.
 *
 * Uses the `mysql2/promise` package (createConnection, connect-per-query).
 */

import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";

interface MysqlProviderConnection extends ProviderConnection {
  connection: {
    execute(opts: { sql: string; timeout: number }): Promise<[unknown[], unknown[]]>;
    end(): Promise<void>;
  };
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

    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: creds.password,
      connectTimeout: CONNECTION_TIMEOUT,
    });

    return {
      connection: conn as unknown as MysqlProviderConnection["connection"],
      close: async () => {
        await conn.end();
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    let conn: MysqlProviderConnection | null = null;
    try {
      conn = await this.connect(connection);
      await conn.connection.execute({ sql: "SELECT 1", timeout: QUERY_TIMEOUT });
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
    const result = await this.query(conn, config.query);
    yield result.rows.length > 0 ? result.rows : [];
  }
}
