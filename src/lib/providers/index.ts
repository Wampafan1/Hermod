import type { ConnectionProvider } from "./provider";
import { PostgresProvider } from "./postgres.provider";
import { MssqlProvider } from "./mssql.provider";
import { MysqlProvider } from "./mysql.provider";
import { BigQueryProvider } from "./bigquery.provider";
import { NetSuiteProvider } from "./netsuite.provider";

const providers: Record<string, ConnectionProvider> = {
  POSTGRES: new PostgresProvider(),
  MSSQL: new MssqlProvider(),
  MYSQL: new MysqlProvider(),
  BIGQUERY: new BigQueryProvider(),
  NETSUITE: new NetSuiteProvider(),
};

export function getProvider(type: string): ConnectionProvider {
  const provider = providers[type];
  if (!provider) {
    throw new Error(
      `No provider for type: "${type}". Available: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

// Re-exports for convenience
export type { ConnectionProvider } from "./provider";
export { toConnectionLike } from "./helpers";
export * from "./capabilities";
export * from "./types";
