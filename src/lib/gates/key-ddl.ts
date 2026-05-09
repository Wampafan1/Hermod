import { createHash } from "crypto";
import type { ConnectionProvider } from "@/lib/providers/provider";
import type { ProviderConnection } from "@/lib/providers/types";
import { fullSqlTableRef, quoteSqlIdentifier, type GateSqlDialect } from "./sql-identifiers";

export type KeyDdlProviderType = "POSTGRES" | "MSSQL" | "MYSQL";

export interface ReplaceKeyConstraintInput {
  providerType: KeyDdlProviderType;
  schema: string;
  table: string;
  oldKey: string[];
  newKey: string[];
  existingConstraintName?: string | null;
  desiredConstraintName?: string | null;
  replacePrimaryKey?: boolean;
  matchedExistingConstraint?: KeyConstraintInfo | null;
  foreignKeyDependencyCount?: number;
}

export interface ReplaceKeyConstraintPlan {
  providerType: KeyDdlProviderType;
  oldKey: string[];
  newKey: string[];
  constraintName: string;
  ddl: string[];
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

export interface KeyConstraintInfo {
  name: string;
  type: "PRIMARY" | "UNIQUE";
  columns: string[];
  isHermodManaged: boolean;
}

export interface DestinationKeyValidation {
  ok: boolean;
  nullCount: number;
  duplicateCount: number;
  reason?: string;
}

export function buildReplaceKeyConstraintPlan(
  input: ReplaceKeyConstraintInput
): ReplaceKeyConstraintPlan {
  const constraintName =
    input.desiredConstraintName ??
    buildHermodConstraintName(input.table, input.newKey, input.replacePrimaryKey ? "pk" : "uk");
  const safety = validateKeyReplacementSafety(input);
  const base: ReplaceKeyConstraintPlan = {
    providerType: input.providerType,
    oldKey: input.oldKey,
    newKey: input.newKey,
    constraintName,
    ddl: [],
    warnings: safety.warnings,
    blocked: safety.blocked,
    blockReason: safety.blockReason,
  };

  if (safety.blocked) return base;

  switch (input.providerType) {
    case "MSSQL":
      return { ...base, ddl: buildMssqlReplaceKeySql({ ...input, constraintName }) };
    case "MYSQL":
      return { ...base, ddl: buildMysqlReplaceKeySql({ ...input, constraintName }) };
    case "POSTGRES":
    default:
      return { ...base, ddl: buildPostgresReplaceKeySql({ ...input, constraintName }) };
  }
}

export function buildPostgresReplaceKeySql(
  input: ReplaceKeyConstraintInput & { constraintName?: string }
): string[] {
  const tableRef = fullSqlTableRef(input.schema, input.table, "postgres");
  const columns = input.newKey.map((column) => quoteSqlIdentifier(column, "postgres")).join(", ");
  const ddl: string[] = [];
  if (input.existingConstraintName) {
    ddl.push(
      `ALTER TABLE ${tableRef} DROP CONSTRAINT ${quoteSqlIdentifier(input.existingConstraintName, "postgres")};`
    );
  }
  const constraintName =
    input.constraintName ??
    buildHermodConstraintName(input.table, input.newKey, input.replacePrimaryKey ? "pk" : "uk");
  const kind = input.replacePrimaryKey ? "PRIMARY KEY" : "UNIQUE";
  ddl.push(
    `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteSqlIdentifier(constraintName, "postgres")} ${kind} (${columns});`
  );
  return ddl;
}

export function buildMssqlReplaceKeySql(
  input: ReplaceKeyConstraintInput & { constraintName?: string }
): string[] {
  const tableRef = fullSqlTableRef(input.schema, input.table, "mssql");
  const columns = input.newKey.map((column) => quoteSqlIdentifier(column, "mssql")).join(", ");
  const ddl: string[] = [];
  if (input.existingConstraintName) {
    ddl.push(
      `ALTER TABLE ${tableRef} DROP CONSTRAINT ${quoteSqlIdentifier(input.existingConstraintName, "mssql")};`
    );
  }
  const constraintName =
    input.constraintName ??
    buildHermodConstraintName(input.table, input.newKey, input.replacePrimaryKey ? "pk" : "uk");
  const kind = input.replacePrimaryKey ? "PRIMARY KEY" : "UNIQUE";
  ddl.push(
    `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteSqlIdentifier(constraintName, "mssql")} ${kind} (${columns});`
  );
  return ddl;
}

export function buildMysqlReplaceKeySql(
  input: ReplaceKeyConstraintInput & { constraintName?: string }
): string[] {
  const tableRef = fullSqlTableRef(input.schema, input.table, "mysql");
  const columns = input.newKey.map((column) => quoteSqlIdentifier(column, "mysql")).join(", ");
  const ddl: string[] = [];
  if (input.replacePrimaryKey) {
    if (input.existingConstraintName) {
      ddl.push(`ALTER TABLE ${tableRef} DROP PRIMARY KEY;`);
    }
    ddl.push(`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${columns});`);
    return ddl;
  }

  if (input.existingConstraintName) {
    ddl.push(`DROP INDEX ${quoteSqlIdentifier(input.existingConstraintName, "mysql")} ON ${tableRef};`);
  }
  const constraintName = input.constraintName ?? buildHermodConstraintName(input.table, input.newKey, "uk");
  ddl.push(`CREATE UNIQUE INDEX ${quoteSqlIdentifier(constraintName, "mysql")} ON ${tableRef} (${columns});`);
  return ddl;
}

export function validateKeyReplacementSafety(input: ReplaceKeyConstraintInput): {
  blocked: boolean;
  warnings: string[];
  blockReason?: string;
} {
  const warnings = [
    "Review generated DDL before applying. Hermod will revalidate the selected key immediately before execution.",
  ];
  if (input.newKey.length === 0) {
    return { blocked: true, warnings, blockReason: "A replacement key must include at least one column." };
  }
  if ([...input.oldKey, ...input.newKey].some((column) => column.trim().length === 0)) {
    return { blocked: true, warnings, blockReason: "Key columns must not be blank." };
  }
  if (new Set(input.newKey.map((column) => column.toLowerCase())).size !== input.newKey.length) {
    return { blocked: true, warnings, blockReason: "Replacement key columns must be unique." };
  }
  if (input.replacePrimaryKey && (input.foreignKeyDependencyCount ?? 0) > 0) {
    return {
      blocked: true,
      warnings,
      blockReason: "The current primary key has foreign key dependencies and cannot be replaced automatically.",
    };
  }
  if (input.existingConstraintName) {
    const isManaged = isHermodManagedConstraintName(input.existingConstraintName);
    const exactMatch = input.matchedExistingConstraint
      ? sameColumns(input.matchedExistingConstraint.columns, input.oldKey)
      : false;
    if (!isManaged && !exactMatch) {
      return {
        blocked: true,
        warnings,
        blockReason: "Refusing to drop an unmanaged destination key constraint without an exact key match.",
      };
    }
  }
  return { blocked: false, warnings };
}

export async function getExistingKeyConstraints(input: {
  provider: ConnectionProvider;
  conn: ProviderConnection;
  providerType: KeyDdlProviderType;
  schema: string;
  table: string;
}): Promise<KeyConstraintInfo[]> {
  if (!input.provider.query) {
    throw new Error("Provider does not support metadata queries.");
  }
  const sql = buildKeyConstraintQuery(input.providerType, input.schema, input.table);
  const result = await input.provider.query(input.conn, sql);
  return groupConstraintRows(result.rows);
}

export function findHermodManagedKeyConstraint(input: {
  constraints: KeyConstraintInfo[];
  oldKey: string[];
  storedConstraintName?: string | null;
}): KeyConstraintInfo | null {
  if (input.storedConstraintName) {
    const stored = input.constraints.find(
      (constraint) => constraint.name.toLowerCase() === input.storedConstraintName!.toLowerCase()
    );
    if (stored) return stored;
  }

  const managed = input.constraints.find(
    (constraint) => constraint.isHermodManaged && sameColumns(constraint.columns, input.oldKey)
  );
  if (managed) return managed;

  return input.constraints.find((constraint) => sameColumns(constraint.columns, input.oldKey)) ?? null;
}

export async function detectForeignKeyDependencies(input: {
  provider: ConnectionProvider;
  conn: ProviderConnection;
  providerType: KeyDdlProviderType;
  schema: string;
  table: string;
}): Promise<{ count: number; blocked: boolean; reason?: string }> {
  if (!input.provider.query) {
    return { count: 0, blocked: true, reason: "Provider does not support foreign key dependency checks." };
  }
  const sql = buildForeignKeyDependencyQuery(input.providerType, input.schema, input.table);
  const result = await input.provider.query(input.conn, sql);
  const count = readCount(result.rows);
  return {
    count,
    blocked: count > 0,
    reason: count > 0
      ? "The current primary key has foreign key dependencies and cannot be replaced automatically."
      : undefined,
  };
}

export async function validateCandidateKeyInDestination(input: {
  provider: ConnectionProvider;
  conn: ProviderConnection;
  providerType: KeyDdlProviderType;
  schema: string;
  table: string;
  keyColumns: string[];
}): Promise<DestinationKeyValidation> {
  if (!input.provider.query) {
    return {
      ok: false,
      nullCount: 0,
      duplicateCount: 0,
      reason: "Provider does not support destination key validation.",
    };
  }
  const dialect = providerToDialect(input.providerType);
  const tableRef = fullSqlTableRef(input.schema, input.table, dialect);
  const nullWhere = input.keyColumns
    .map((column) => `${quoteSqlIdentifier(column, dialect)} IS NULL`)
    .join(" OR ");
  const groupColumns = input.keyColumns.map((column) => quoteSqlIdentifier(column, dialect)).join(", ");
  const nullSql = `SELECT COUNT(*) AS count FROM ${tableRef} WHERE ${nullWhere}`;
  const duplicateSql = `SELECT COUNT(*) AS count FROM (SELECT ${groupColumns}, COUNT(*) AS key_count FROM ${tableRef} GROUP BY ${groupColumns} HAVING COUNT(*) > 1) hermod_key_dupes`;
  const [nullResult, duplicateResult] = await Promise.all([
    input.provider.query(input.conn, nullSql),
    input.provider.query(input.conn, duplicateSql),
  ]);
  const nullCount = readCount(nullResult.rows);
  const duplicateCount = readCount(duplicateResult.rows);

  if (nullCount > 0) {
    return {
      ok: false,
      nullCount,
      duplicateCount,
      reason: "Selected key has blank values in the existing destination table.",
    };
  }
  if (duplicateCount > 0) {
    return {
      ok: false,
      nullCount,
      duplicateCount,
      reason: "Selected key has duplicate combinations in the existing destination table.",
    };
  }
  return { ok: true, nullCount, duplicateCount };
}

export function buildHermodConstraintName(table: string, columns: string[], kind: "pk" | "uk"): string {
  const rawBase = `hermod_${table}_${columns.join("_")}_${kind}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const hash = createHash("sha256")
    .update(`${table}|${columns.join("|")}|${kind}`)
    .digest("hex")
    .slice(0, 8);
  const trimmed = rawBase.slice(0, Math.max(1, 54 - hash.length)).replace(/_+$/g, "");
  return `${trimmed}_${hash}`;
}

function buildKeyConstraintQuery(providerType: KeyDdlProviderType, schema: string, table: string): string {
  const schemaLiteral = sqlStringLiteral(schema);
  const tableLiteral = sqlStringLiteral(table);
  switch (providerType) {
    case "MSSQL":
      return `
SELECT kc.name AS name,
       CASE WHEN kc.type = 'PK' THEN 'PRIMARY' ELSE 'UNIQUE' END AS type,
       c.name AS column_name,
       ic.key_ordinal AS ordinal_position
FROM sys.key_constraints kc
JOIN sys.tables t ON t.object_id = kc.parent_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
WHERE s.name = ${schemaLiteral}
  AND t.name = ${tableLiteral}
  AND kc.type IN ('PK', 'UQ')
ORDER BY kc.name, ic.key_ordinal`;
    case "MYSQL":
      return `
SELECT INDEX_NAME AS name,
       CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'PRIMARY' ELSE 'UNIQUE' END AS type,
       COLUMN_NAME AS column_name,
       SEQ_IN_INDEX AS ordinal_position
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = ${schemaLiteral}
  AND TABLE_NAME = ${tableLiteral}
  AND NON_UNIQUE = 0
ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
    case "POSTGRES":
    default:
      return `
SELECT con.conname AS name,
       CASE con.contype WHEN 'p' THEN 'PRIMARY' ELSE 'UNIQUE' END AS type,
       att.attname AS column_name,
       ord.ordinality AS ordinal_position
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON TRUE
JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ord.attnum
WHERE nsp.nspname = ${schemaLiteral}
  AND rel.relname = ${tableLiteral}
  AND con.contype IN ('p', 'u')
ORDER BY con.conname, ord.ordinality`;
  }
}

function buildForeignKeyDependencyQuery(
  providerType: KeyDdlProviderType,
  schema: string,
  table: string
): string {
  const schemaLiteral = sqlStringLiteral(schema);
  const tableLiteral = sqlStringLiteral(table);
  switch (providerType) {
    case "MSSQL":
      return `
SELECT COUNT(*) AS count
FROM sys.foreign_keys fk
JOIN sys.tables t ON t.object_id = fk.referenced_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = ${schemaLiteral}
  AND t.name = ${tableLiteral}`;
    case "MYSQL":
      return `
SELECT COUNT(*) AS count
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_SCHEMA = ${schemaLiteral}
  AND REFERENCED_TABLE_NAME = ${tableLiteral}`;
    case "POSTGRES":
    default:
      return `
SELECT COUNT(*) AS count
FROM pg_constraint fk
JOIN pg_class rel ON rel.oid = fk.confrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE fk.contype = 'f'
  AND nsp.nspname = ${schemaLiteral}
  AND rel.relname = ${tableLiteral}`;
  }
}

function groupConstraintRows(rows: Record<string, unknown>[]): KeyConstraintInfo[] {
  const grouped = new Map<string, KeyConstraintInfo>();
  const sorted = [...rows].sort(
    (a, b) => Number(a.ordinal_position ?? a.ORDINAL_POSITION ?? 0) - Number(b.ordinal_position ?? b.ORDINAL_POSITION ?? 0)
  );

  for (const row of sorted) {
    const name = String(row.name ?? row.NAME ?? "");
    const column = String(row.column_name ?? row.COLUMN_NAME ?? "");
    if (!name || !column) continue;
    const rawType = String(row.type ?? row.TYPE ?? "UNIQUE").toUpperCase();
    const type = rawType === "PRIMARY" || rawType === "PK" ? "PRIMARY" : "UNIQUE";
    const existing = grouped.get(name) ?? {
      name,
      type,
      columns: [],
      isHermodManaged: isHermodManagedConstraintName(name),
    };
    existing.columns.push(column);
    grouped.set(name, existing);
  }

  return [...grouped.values()];
}

function providerToDialect(providerType: KeyDdlProviderType): GateSqlDialect {
  if (providerType === "MSSQL") return "mssql";
  if (providerType === "MYSQL") return "mysql";
  return "postgres";
}

function readCount(rows: Record<string, unknown>[]): number {
  const row = rows[0];
  if (!row) return 0;
  const value = row.count ?? row.COUNT ?? row.Count ?? Object.values(row)[0];
  return Number(value ?? 0);
}

function sameColumns(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((column, index) => column.toLowerCase() === right[index]?.toLowerCase());
}

function isHermodManagedConstraintName(name: string): boolean {
  return /^hermod_/i.test(name);
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
