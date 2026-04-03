// ---------------------------------------------------------------------------
// Alfheim DDL Generator — creates CREATE TABLE statements from SchemaMapping
// ---------------------------------------------------------------------------

import type { ColumnMapping, ChildTableMapping, SchemaMapping, SqlDialect } from "./types";

// ---------------------------------------------------------------------------
// Type mapping per dialect
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<ColumnMapping["dataType"], Record<SqlDialect, string>> = {
  STRING:    { postgres: "TEXT",             mssql: "NVARCHAR(MAX)", mysql: "TEXT",       bigquery: "STRING" },
  INTEGER:   { postgres: "BIGINT",           mssql: "BIGINT",        mysql: "BIGINT",     bigquery: "INT64" },
  FLOAT:     { postgres: "DOUBLE PRECISION", mssql: "FLOAT",         mysql: "DOUBLE",     bigquery: "FLOAT64" },
  BOOLEAN:   { postgres: "BOOLEAN",          mssql: "BIT",           mysql: "TINYINT(1)", bigquery: "BOOL" },
  TIMESTAMP: { postgres: "TIMESTAMPTZ",      mssql: "DATETIME2",     mysql: "DATETIME",   bigquery: "TIMESTAMP" },
  JSON:      { postgres: "JSONB",            mssql: "NVARCHAR(MAX)", mysql: "JSON",       bigquery: "JSON" },
};

// ---------------------------------------------------------------------------
// Name quoting helpers
// ---------------------------------------------------------------------------

function quoteIdentifier(name: string, dialect: SqlDialect): string {
  switch (dialect) {
    case "mssql":
      return `[${name}]`;
    case "mysql":
    case "bigquery":
      return `\`${name}\``;
    case "postgres":
    default:
      return `"${name}"`;
  }
}

// ---------------------------------------------------------------------------
// Name sanitization
// ---------------------------------------------------------------------------

const MAX_IDENTIFIER_LENGTH = 128;

function sanitizeName(raw: string, warnings: string[]): string {
  // Replace anything that's not alphanumeric or underscore
  let name = raw.replace(/[^a-zA-Z0-9_]/g, "_");

  if (name.length > MAX_IDENTIFIER_LENGTH) {
    warnings.push(
      `Identifier "${raw}" truncated from ${name.length} to ${MAX_IDENTIFIER_LENGTH} characters.`
    );
    name = name.slice(0, MAX_IDENTIFIER_LENGTH);
  }

  return name;
}

// ---------------------------------------------------------------------------
// Column definition builder
// ---------------------------------------------------------------------------

function buildColumnDef(
  col: ColumnMapping,
  dialect: SqlDialect,
  warnings: string[]
): string {
  const colName = quoteIdentifier(sanitizeName(col.columnName, warnings), dialect);
  const sqlType = TYPE_MAP[col.dataType][dialect];
  const nullability = col.nullable ? "" : " NOT NULL";
  return `  ${colName} ${sqlType}${nullability}`;
}

// ---------------------------------------------------------------------------
// CREATE TABLE builder
// ---------------------------------------------------------------------------

function buildCreateTable(
  tableName: string,
  columns: ColumnMapping[],
  dialect: SqlDialect,
  warnings: string[],
  extraColumns?: ColumnMapping[]
): string {
  const safeName = quoteIdentifier(sanitizeName(tableName, warnings), dialect);
  const allCols = [...(extraColumns ?? []), ...columns];
  const colDefs = allCols.map((c) => buildColumnDef(c, dialect, warnings));
  return `CREATE TABLE ${safeName} (\n${colDefs.join(",\n")}\n);`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateDDL(
  tableName: string,
  schema: SchemaMapping,
  dialect: SqlDialect
): { statements: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const statements: string[] = [];

  // Main table
  statements.push(buildCreateTable(tableName, schema.columns, dialect, warnings));

  // Child tables
  if (schema.childTables) {
    for (const child of schema.childTables) {
      // Add foreign key column as the first column in child tables
      const fkColumn: ColumnMapping = {
        jsonPath: child.foreignKey,
        columnName: child.foreignKey,
        dataType: "STRING",
        nullable: false,
      };
      statements.push(
        buildCreateTable(child.tableName, child.columns, dialect, warnings, [fkColumn])
      );
    }
  }

  return { statements, warnings };
}
