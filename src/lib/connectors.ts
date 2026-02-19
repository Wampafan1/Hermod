import { DataSourceType } from "@prisma/client";
import { decrypt } from "@/lib/crypto";

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DataSourceConnector {
  query(sql: string): Promise<QueryResult>;
  testConnection(): Promise<boolean>;
  disconnect(): Promise<void>;
}

interface ConnectionConfig {
  type: DataSourceType;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  extras?: unknown;
}

const CONNECTION_TIMEOUT = 30_000;
const QUERY_TIMEOUT = 120_000;

// ─── PostgreSQL ─────────────────────────────────────

class PostgresConnector implements DataSourceConnector {
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async query(sql: string): Promise<QueryResult> {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      host: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      connectionTimeoutMillis: CONNECTION_TIMEOUT,
      statement_timeout: QUERY_TIMEOUT,
    });
    try {
      await client.connect();
      const result = await client.query(sql);
      const columns = result.fields.map((f) => f.name);
      return { columns, rows: result.rows };
    } finally {
      await client.end();
    }
  }

  async testConnection(): Promise<boolean> {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      host: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      connectionTimeoutMillis: CONNECTION_TIMEOUT,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return true;
    } finally {
      await client.end();
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close
  }
}

// ─── SQL Server ─────────────────────────────────────

class MSSQLConnector implements DataSourceConnector {
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async query(sql: string): Promise<QueryResult> {
    const mssql = await import("mssql");
    const pool = await mssql.default.connect({
      server: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      options: { encrypt: false, trustServerCertificate: true },
      connectionTimeout: CONNECTION_TIMEOUT,
      requestTimeout: QUERY_TIMEOUT,
    });
    try {
      const result = await pool.request().query(sql);
      const columns = result.recordset.columns
        ? Object.keys(result.recordset.columns)
        : result.recordset.length > 0
          ? Object.keys(result.recordset[0])
          : [];
      return { columns, rows: result.recordset };
    } finally {
      await pool.close();
    }
  }

  async testConnection(): Promise<boolean> {
    const mssql = await import("mssql");
    const pool = await mssql.default.connect({
      server: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      options: { encrypt: false, trustServerCertificate: true },
      connectionTimeout: CONNECTION_TIMEOUT,
    });
    try {
      await pool.request().query("SELECT 1");
      return true;
    } finally {
      await pool.close();
    }
  }

  async disconnect(): Promise<void> {}
}

// ─── MySQL ──────────────────────────────────────────

class MySQLConnector implements DataSourceConnector {
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async query(sql: string): Promise<QueryResult> {
    const mysql = await import("mysql2/promise");
    const connection = await mysql.createConnection({
      host: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      connectTimeout: CONNECTION_TIMEOUT,
    });
    try {
      const [rows, fields] = await connection.execute({ sql, timeout: QUERY_TIMEOUT });
      const columns = (fields as Array<{ name: string }>)?.map((f) => f.name) ?? [];
      return { columns, rows: rows as Record<string, unknown>[] };
    } finally {
      await connection.end();
    }
  }

  async testConnection(): Promise<boolean> {
    const mysql = await import("mysql2/promise");
    const connection = await mysql.createConnection({
      host: this.config.host!,
      port: this.config.port!,
      database: this.config.database!,
      user: this.config.username!,
      password: this.config.password!,
      connectTimeout: CONNECTION_TIMEOUT,
    });
    try {
      await connection.execute("SELECT 1");
      return true;
    } finally {
      await connection.end();
    }
  }

  async disconnect(): Promise<void> {}
}

// ─── BigQuery ───────────────────────────────────────

class BigQueryConnector implements DataSourceConnector {
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async query(sql: string): Promise<QueryResult> {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const credentials = this.config.extras as Record<string, unknown>;
    const client = new BigQuery({
      projectId: credentials.project_id as string,
      credentials,
    });
    const [rows] = await client.query({
      query: sql,
      useLegacySql: false,
      maximumBytesBilled: undefined,
    });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }

  async testConnection(): Promise<boolean> {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const credentials = this.config.extras as Record<string, unknown>;
    const client = new BigQuery({
      projectId: credentials.project_id as string,
      credentials,
    });
    const [rows] = await client.query("SELECT 1 as test");
    return rows.length > 0;
  }

  async disconnect(): Promise<void> {}
}

// ─── Factory ────────────────────────────────────────

export function getConnector(config: ConnectionConfig): DataSourceConnector {
  // Decrypt password if present
  const decryptedConfig = { ...config };
  if (decryptedConfig.password) {
    try {
      decryptedConfig.password = decrypt(decryptedConfig.password);
    } catch {
      // Password may not be encrypted (e.g., during test connection before save)
    }
  }

  switch (config.type) {
    case "POSTGRES":
      return new PostgresConnector(decryptedConfig);
    case "MSSQL":
      return new MSSQLConnector(decryptedConfig);
    case "MYSQL":
      return new MySQLConnector(decryptedConfig);
    case "BIGQUERY":
      return new BigQueryConnector(decryptedConfig);
    default:
      throw new Error(`Unsupported data source type: ${config.type}`);
  }
}

/**
 * Create a connector from raw (unencrypted) config, used for test connections
 * before saving to DB.
 */
export function getConnectorRaw(config: ConnectionConfig): DataSourceConnector {
  switch (config.type) {
    case "POSTGRES":
      return new PostgresConnector(config);
    case "MSSQL":
      return new MSSQLConnector(config);
    case "MYSQL":
      return new MySQLConnector(config);
    case "BIGQUERY":
      return new BigQueryConnector(config);
    default:
      throw new Error(`Unsupported data source type: ${config.type}`);
  }
}
