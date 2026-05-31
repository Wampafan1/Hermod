/**
 * Dialect-aware ALTER TABLE statement generator for schema drift resolution.
 *
 * Reuses the SqlDialect type and quoting conventions from the alfheim DDL generator.
 * NEVER generates DROP COLUMN statements.
 */

import type { SchemaDiff } from "./schema-diff";
import type { SqlDialect } from "@/lib/alfheim/types";
import { toHermodType } from "@/lib/duckdb/type-mapper";
import { fullSqlTableRef, quoteSqlIdentifier } from "./sql-identifiers";

// ─── Types ──────────────────────────────────────────

export interface AlterStatement {
  sql: string;
  description: string;
  isComment: boolean; // true for informational-only lines (not executable)
  warning?: string;
  sourceColumn?: string;
  destinationColumn?: string;
}

export interface GateColumnMapping {
  sourceColumn: string;
  destinationColumn: string;
  sourceType?: string;
  destType?: string | null;
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
  return quoteSqlIdentifier(name, dialect);
}

function fullTableRef(schema: string, table: string, dialect: SqlDialect): string {
  return fullSqlTableRef(schema, table, dialect);
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

export function normalizeDestinationColumnName(sourceColumn: string): string {
  return sourceColumn.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function findMappedDestinationColumn(
  sourceColumn: string,
  columnMapping: GateColumnMapping[]
): string | null {
  const mapped = columnMapping.find(
    (m) => m.sourceColumn.toLowerCase() === sourceColumn.toLowerCase()
  );
  return mapped?.destinationColumn ?? null;
}

function prefersNormalizedDestinationNames(columnMapping: GateColumnMapping[]): boolean {
  let normalizedMatches = 0;
  let rawMatches = 0;

  for (const mapping of columnMapping) {
    if (mapping.destinationColumn === normalizeDestinationColumnName(mapping.sourceColumn)) {
      normalizedMatches++;
    }
    if (mapping.destinationColumn === mapping.sourceColumn) {
      rawMatches++;
    }
  }

  return normalizedMatches >= rawMatches;
}

export function inferDestinationColumnName(
  sourceColumn: string,
  columnMapping: GateColumnMapping[],
  usedDestinationColumns: Set<string> = new Set(
    columnMapping.map((m) => m.destinationColumn.toLowerCase())
  )
): string {
  const existing = findMappedDestinationColumn(sourceColumn, columnMapping);
  if (existing) return existing;

  const base = prefersNormalizedDestinationNames(columnMapping)
    ? normalizeDestinationColumnName(sourceColumn)
    : sourceColumn;
  let candidate = base || "column";
  let suffix = 2;

  while (usedDestinationColumns.has(candidate.toLowerCase())) {
    candidate = `${base || "column"}_${suffix}`;
    suffix++;
  }

  usedDestinationColumns.add(candidate.toLowerCase());
  return candidate;
}

export function mapSchemaDiffToDestination(
  diff: SchemaDiff,
  columnMapping: GateColumnMapping[]
): SchemaDiff {
  const usedDestinationColumns = new Set(
    columnMapping.map((m) => m.destinationColumn.toLowerCase())
  );

  return {
    added: diff.added.map((col) => ({
      ...col,
      name: inferDestinationColumnName(col.name, columnMapping, usedDestinationColumns),
    })),
    removed: diff.removed.map((col) => ({
      ...col,
      name: findMappedDestinationColumn(col.name, columnMapping) ?? col.name,
    })),
    typeChanged: diff.typeChanged.map((col) => ({
      ...col,
      name: findMappedDestinationColumn(col.name, columnMapping) ?? col.name,
    })),
  };
}

// ─── Generator ──────────────────────────────────────

export function generateAlterStatements(
  connectionType: string,
  schema: string,
  table: string,
  diff: SchemaDiff,
  sourceDiff?: SchemaDiff
): AlterStatement[] {
  const dialect = connectionTypeToDialect(connectionType);
  const tableRef = fullTableRef(schema, table, dialect);
  const statements: AlterStatement[] = [];

  // Added columns → ADD COLUMN
  for (let idx = 0; idx < diff.added.length; idx++) {
    const col = diff.added[idx];
    const sourceCol = sourceDiff?.added[idx];
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
      description: sourceCol && sourceCol.name !== col.name
        ? `Add column: ${sourceCol.name} -> ${col.name} (${destType})`
        : `Add column: ${col.name} (${destType})`,
      isComment: false,
      sourceColumn: sourceCol?.name ?? col.name,
      destinationColumn: col.name,
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
        // Postgres requires a USING clause to recast existing data when there is
        // no implicit cast (e.g. text→numeric, text→timestamp). MySQL/SQL Server
        // convert in place and have no USING syntax.
        sql = `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} TYPE ${newDestType} USING (${colRef}::${newDestType});`;
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
