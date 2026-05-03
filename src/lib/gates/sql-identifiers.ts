export type GateSqlDialect = "postgres" | "mssql" | "mysql" | "bigquery";

export function quoteSqlIdentifier(name: string, dialect: GateSqlDialect): string {
  if (name.length === 0) {
    throw new Error("SQL identifier cannot be empty");
  }

  switch (dialect) {
    case "mssql":
      return `[${name.replace(/]/g, "]]")}]`;
    case "mysql":
    case "bigquery":
      return `\`${name.replace(/`/g, "``")}\``;
    case "postgres":
    default:
      return `"${name.replace(/"/g, "\"\"")}"`;
  }
}

export function fullSqlTableRef(
  schema: string | null | undefined,
  table: string,
  dialect: GateSqlDialect
): string {
  const tableRef = quoteSqlIdentifier(table, dialect);
  return schema
    ? `${quoteSqlIdentifier(schema, dialect)}.${tableRef}`
    : tableRef;
}
