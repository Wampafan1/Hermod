/**
 * Dialect-aware ALTER TABLE statement generator for schema drift resolution.
 *
 * Reuses the SqlDialect type and quoting conventions from the alfheim DDL generator.
 * NEVER generates DROP COLUMN statements.
 */

import type { SchemaDiff } from "./schema-diff";
import type { SqlDialect } from "@/lib/alfheim/types";
import { toHermodType } from "@/lib/duckdb/type-mapper";

// ─── Types ──────────────────────────────────────────

export interface AlterStatement {
  sql: string;
  description: string;
  isComment: boolean; // true for informational-only lines (not executable)
  warning?: string;
}

// ─── Dialect mapping (mirrors alfheim/ddl-generator TYPE_MAP) ───

const TYPE_MAP: Record<string, Record<SqlDialect, string>> = {
  STRING:    { postgres: "TEXT",             mssql: "NVARCHAR(MAX)", mysql: "TEXT",       bigquery: "STRING" },
  INTEGER:   { postgres: "BIGINT",           mssql: "BIGINT",        mysql: "BIGINT",     bigquery: "INT64" },
  FLOAT:     { postgres: "DOUBLE PRECISION", mssql: "FLOAT",         mysql: "DOUBLE",     bigquery: "FLOAT64" },
  BOOLEAN:   { postgres: "BOOLEAN",          mssql: "BIT",           mysql: "TINYINT(1)", bigquery: "BOOL" },
  TIMESTAMP: { postgres: "TIMESTAMPTZ",      mssql: "DATETIME2",     mysql: "DATETIME",   bigquery: "TIMESTAMP" },
  JSON:      { postgres: "JSONB",            mssql: "NVARCHAR(MAX)", mysql: "JSON",       bigquery: "JSON" },
};

// ─── Quoting (same logic as alfheim/ddl-generator) ──

function quoteIdent(name: string, dialect: SqlDialect): string {
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

function fullTableRef(schema: string, table: string, dialect: SqlDialect): string {
  return `${quoteIdent(schema, dialect)}.${quoteIdent(table, dialect)}`;
}

// ─── ConnectionType → SqlDialect mapping ────────────

export function connectionTypeToDialect(connectionType: string): SqlDialect {
  switch (connectionType) {
    case "MSSQL":
      return "mssql";
    case "MYSQL":
      return "mysql";
    case "BIGQUERY":
      return "bigquery";
    case "POSTGRES":
    default:
      return "postgres";
  }
}

// ─── Map DuckDB type → dialect DDL type ─────────────

function mapDuckdbTypeToDialect(duckdbType: string, dialect: SqlDialect): string {
  const hermod = toHermodType(duckdbType);
  return TYPE_MAP[hermod]?.[dialect] ?? TYPE_MAP["STRING"][dialect];
}

// ─── Generator ──────────────────────────────────────

export function generateAlterStatements(
  connectionType: string,
  schema: string,
  table: string,
  diff: SchemaDiff
): AlterStatement[] {
  const dialect = connectionTypeToDialect(connectionType);
  const tableRef = fullTableRef(schema, table, dialect);
  const statements: AlterStatement[] = [];

  // Added columns → ADD COLUMN
  for (const col of diff.added) {
    const destType = mapDuckdbTypeToDialect(col.type, dialect);
    const colRef = quoteIdent(col.name, dialect);

    let sql: string;
    switch (dialect) {
      case "mssql":
        sql = `ALTER TABLE ${tableRef} ADD ${colRef} ${destType} NULL;`;
        break;
      case "mysql":
        sql = `ALTER TABLE ${tableRef} ADD COLUMN ${colRef} ${destType} NULL;`;
        break;
      default: // postgres
        sql = `ALTER TABLE ${tableRef} ADD COLUMN ${colRef} ${destType};`;
        break;
    }

    statements.push({
      sql,
      description: `Add column: ${col.name} (${destType})`,
      isComment: false,
    });
  }

  // Removed columns → just a comment, NEVER DROP
  for (const col of diff.removed) {
    statements.push({
      sql: `-- Column '${col.name}' exists in destination but not in file. It will remain unchanged for existing rows and be NULL for new inserts.`,
      description: `Column '${col.name}' missing from file — will be NULL for new inserts`,
      isComment: true,
    });
  }

  // Type changed → ALTER COLUMN type
  for (const col of diff.typeChanged) {
    const newDestType = mapDuckdbTypeToDialect(col.newType, dialect);
    const colRef = quoteIdent(col.name, dialect);

    let sql: string;
    switch (dialect) {
      case "mssql":
        sql = `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} ${newDestType};`;
        break;
      case "mysql":
        sql = `ALTER TABLE ${tableRef} MODIFY COLUMN ${colRef} ${newDestType};`;
        break;
      default: // postgres
        sql = `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} TYPE ${newDestType};`;
        break;
    }

    const warning = isNarrowingChange(col.oldType, col.newType)
      ? `Changing ${col.name} from ${col.oldType} to ${col.newType} may lose precision or data.`
      : undefined;

    statements.push({ sql, description: `Change column type: ${col.name} → ${newDestType}`, isComment: false, warning });
  }

  return statements;
}

// ─── Helpers ────────────────────────────────────────

function isNarrowingChange(oldType: string, newType: string): boolean {
  const oldH = toHermodType(oldType);
  const newH = toHermodType(newType);

  // VARCHAR → INTEGER is narrowing
  if (oldH === "STRING" && (newH === "INTEGER" || newH === "FLOAT")) return true;
  // FLOAT → INTEGER is narrowing
  if (oldH === "FLOAT" && newH === "INTEGER") return true;

  return false;
}


// ─── CREATE TABLE Generator ────────────────────────

export interface CreateTableColumn {
  name: string;
  duckdbType: string;
  nullable: boolean;
}

/**
 * Generate a dialect-correct CREATE TABLE statement from profiled schema columns.
 * Used when creating a new destination table during Gate setup.
 */
export function generateCreateTableSql(
  connectionType: string,
  schema: string,
  table: string,
  columns: CreateTableColumn[],
  pkColumns?: string[]
): string {
  const dialect = connectionTypeToDialect(connectionType);
  const tableRef = fullTableRef(schema, table, dialect);

  const colDefs = columns.map((col) => {
    const colRef = quoteIdent(col.name, dialect);
    const destType = mapDuckdbTypeToDialect(col.duckdbType, dialect);
    const nullable = col.nullable ? "NULL" : "NOT NULL";
    return `  ${colRef} ${destType} ${nullable}`;
  });

  // Add composite primary key constraint if PK columns provided
  if (pkColumns && pkColumns.length > 0) {
    const pkRefs = pkColumns.map((c) => quoteIdent(c, dialect)).join(", ");
    colDefs.push(`  PRIMARY KEY (${pkRefs})`);
  }

  return `CREATE TABLE ${tableRef} (\n${colDefs.join(",\n")}\n);`;
}
