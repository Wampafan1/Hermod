/**
 * Gate push execution engine.
 *
 * Reads profiled data from DuckDB, maps columns via the gate's columnMapping,
 * and pushes rows to the destination connection using the appropriate strategy.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { createAnalyticsSession } from "@/lib/duckdb/engine";
import type { DestConfig, LoadResult } from "@/lib/bifrost/types";
import type { ConnectionProvider } from "@/lib/providers/provider";
import type { ProviderConnection } from "@/lib/providers/types";
import { Prisma } from "@prisma/client";
import { normalizeDestinationColumnName } from "./alter-generator";
import { fullSqlTableRef, quoteSqlIdentifier } from "./sql-identifiers";
import {
  buildKeyDriftRecommendation,
  discoverUniqueColumnCombinations,
  type CandidateKey,
  type CandidateSearchLimits,
  type ColumnExclusion,
  type DiscriminatorColumnStats,
  type KeyDiscoveryMode,
  type KeyDiscoveryStats,
  type KeyRecommendation,
} from "./key-discovery";
import { recommendGateKey } from "./key-recommendation-ai";

// ─── Types ──────────────────────────────────────────

export interface ColumnMap {
  sourceColumn: string;
  destinationColumn: string;
  sourceType: string;
  destType: string | null;
}

export type GatePushExecutionStatus = "SUCCESS" | "FAILED" | "PARTIAL" | "KEY_DRIFT";

export interface IndexedMappedRow {
  row: Record<string, unknown>;
  rowIndex: number;
}

export interface KeyDriftDetails {
  oldKey: string[];
  duplicateExamples: Array<{
    keyValues: Record<string, string | number | boolean | null>;
    rowIndexes: number[];
  }>;
  nullKeyExamples: Array<{
    rowIndex: number;
    keyValues: Record<string, string | number | boolean | null>;
    missingColumns: string[];
  }>;
  reason: string;
  candidateKeys: CandidateKey[];
  recommendation: KeyRecommendation | null;
  validationStats: KeyDiscoveryStats | null;
  aiUsed?: boolean;
  aiExplanation?: string | null;
  noReliableKeyReason?: string | null;
  discoveryMode?: KeyDiscoveryMode;
  searchExhaustive?: boolean;
  columnsConsidered?: string[];
  columnsExcluded?: ColumnExclusion[];
  discriminatorColumns?: DiscriminatorColumnStats[];
  currentKeyDuplicateGroupCount?: number;
  candidateSearchLimits?: CandidateSearchLimits;
  selectedKey: string[] | null;
}

export interface PushResult {
  status: GatePushExecutionStatus;
  rowCount: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsErrored: number;
  blankRowsSkipped: number;
  keyDrift?: KeyDriftDetails;
  duration: number;
  errorMessage?: string;
}

export interface PreparedGateRows {
  mappedRows: Record<string, unknown>[];
  indexedMappedRows: IndexedMappedRow[];
  blankRowsSkipped: number;
  keyDrift?: KeyDriftDetails;
}

export interface GateKeyDriftPreflightResult {
  rowCount: number;
  blankRowsSkipped: number;
  keyDrift?: KeyDriftDetails;
}

// ─── Execute Push ───────────────────────────────────

export async function executePush(
  gateId: string,
  pushId: string,
  fileBuffer: Buffer,
  fileExtension: string
): Promise<PushResult> {
  const startTime = Date.now();

  // Load gate with connection
  const gate = await prisma.realmGate.findUniqueOrThrow({
    where: { id: gateId },
    include: { connection: true },
  });

  const columnMapping = gate.columnMapping as unknown as ColumnMap[];
  const mergeStrategy = gate.mergeStrategy;

  // Parse composite PK columns from Json field
  const primaryKeyColumns: string[] = Array.isArray(gate.primaryKeyColumns)
    ? (gate.primaryKeyColumns as string[])
    : [];

  const rows = await loadRowsFromGateFile(fileBuffer, fileExtension);

  if (rows.length === 0) {
    const result: PushResult = {
      status: "SUCCESS",
      rowCount: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 0,
      duration: Date.now() - startTime,
    };
    await persistPushResult(pushId, result);
    await markGateDelivered(gateId);
    return result;
  }

  // 2. Map columns: rename source → destination
  // 2. Connect to destination
  const conn = gate.connection;
  const provider = getProvider(conn.type);
  const credentials = conn.credentials ? JSON.parse(decrypt(conn.credentials)) : {};
  const providerConn = await provider.connect({
    type: conn.type,
    config: conn.config as Record<string, unknown>,
    credentials,
  });

  try {
    const effectiveColumnMapping = await resolveDestinationColumnMapping(
      provider,
      providerConn,
      gate,
      columnMapping
    );

    const prepared = await prepareMappedRowsForPushWithRecommendation({
      rows,
      columnMapping: effectiveColumnMapping,
      primaryKeyColumns,
      mergeStrategy,
    });

    if (prepared.keyDrift) {
      const result: PushResult = {
        status: "KEY_DRIFT",
        rowCount: rows.length,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsErrored: 0,
        blankRowsSkipped: prepared.blankRowsSkipped,
        keyDrift: prepared.keyDrift,
        duration: Date.now() - startTime,
      };
      await persistPushResult(pushId, result);
      return result;
    }

    let result: PushResult;

    if (mergeStrategy === "TRUNCATE_RELOAD") {
      result = await truncateAndLoad(provider, providerConn, gate, prepared.mappedRows);
    } else if (mergeStrategy === "UPSERT") {
      if (prepared.mappedRows.length === 0) {
        result = {
          status: "SUCCESS",
          rowCount: 0,
          rowsInserted: 0,
          rowsUpdated: 0,
          rowsErrored: 0,
          blankRowsSkipped: 0,
          duration: 0,
        };
      } else {
        result = await upsertRows(
          provider,
          providerConn,
          gate,
          resolvePrimaryKeyDestinationColumns(primaryKeyColumns, effectiveColumnMapping),
          prepared.mappedRows,
          effectiveColumnMapping
        );
      }
    } else {
      // APPEND
      result = await appendRows(provider, providerConn, gate, prepared.mappedRows);
    }

    result.duration = Date.now() - startTime;
    result.rowCount = rows.length;
    result.blankRowsSkipped = prepared.blankRowsSkipped;
    applyDefaultErrorMessage(result);

    await persistPushResult(pushId, result);

    if (result.status === "SUCCESS" || result.status === "PARTIAL") {
      await markGateDelivered(gateId);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    await prisma.gatePush.update({
      where: { id: pushId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        errorDetails: err instanceof Error && err.stack ? { stack: err.stack } : undefined,
        duration,
        completedAt: new Date(),
      },
    });
    throw err;
  } finally {
    await providerConn.close();
  }
}

// ─── Strategy Implementations ───────────────────────

export async function preflightGatePushKeyDrift(input: {
  fileBuffer: Buffer;
  fileExtension: string;
  columnMapping: ColumnMap[];
  primaryKeyColumns: string[];
  mergeStrategy: string;
}): Promise<GateKeyDriftPreflightResult> {
  const rows = await loadRowsFromGateFile(input.fileBuffer, input.fileExtension);
  const prepared = await prepareMappedRowsForPushWithRecommendation({
    rows,
    columnMapping: input.columnMapping,
    primaryKeyColumns: input.primaryKeyColumns,
    mergeStrategy: input.mergeStrategy,
  });

  return {
    rowCount: rows.length,
    blankRowsSkipped: prepared.blankRowsSkipped,
    keyDrift: prepared.keyDrift,
  };
}

export async function loadRowsFromGateFile(
  fileBuffer: Buffer,
  fileExtension: string
): Promise<Record<string, unknown>[]> {
  const session = await createAnalyticsSession();
  try {
    if (fileExtension === ".csv" || fileExtension === ".tsv") {
      await session.loadCSV(fileBuffer, "staging", {
        delimiter: fileExtension === ".tsv" ? "\t" : undefined,
      });
    } else {
      await session.loadExcel(fileBuffer, "staging");
    }

    return await session.query<Record<string, unknown>>("SELECT * FROM staging");
  } finally {
    await session.close();
  }
}

async function resolveDestinationColumnMapping(
  provider: ConnectionProvider,
  conn: ProviderConnection,
  gate: { targetSchema: string | null; targetTable: string },
  columnMapping: ColumnMap[]
): Promise<ColumnMap[]> {
  if (!provider.getSchema) return columnMapping;

  try {
    const schema = await provider.getSchema(
      conn,
      gate.targetSchema || "public",
      gate.targetTable
    );
    const destinationColumns = new Set(
      schema?.fields.map((field) => field.name.toLowerCase()) ?? []
    );
    if (destinationColumns.size === 0) return columnMapping;

    return columnMapping.map((mapping) => {
      if (destinationColumns.has(mapping.destinationColumn.toLowerCase())) {
        return mapping;
      }

      const normalized = normalizeDestinationColumnName(mapping.sourceColumn);
      if (destinationColumns.has(normalized.toLowerCase())) {
        return { ...mapping, destinationColumn: normalized };
      }

      return mapping;
    });
  } catch {
    return columnMapping;
  }
}

export function isBlankMappedValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function isFullyBlankMappedRow(row: Record<string, unknown>): boolean {
  const values = Object.values(row);
  return values.length > 0 && values.every(isBlankMappedValue);
}

export function resolvePrimaryKeyDestinationColumns(
  primaryKeyColumns: string[],
  columnMapping: ColumnMap[]
): string[] {
  return primaryKeyColumns.map((sourcePrimaryKey) => {
    const mapped = columnMapping.find(
      (mapping) => mapping.sourceColumn.toLowerCase() === sourcePrimaryKey.toLowerCase()
    );
    return mapped?.destinationColumn ?? sourcePrimaryKey;
  });
}

export function prepareMappedRowsForPush(input: {
  rows: Record<string, unknown>[];
  columnMapping: ColumnMap[];
  primaryKeyColumns: string[];
  mergeStrategy: string;
}): PreparedGateRows {
  const indexedMappedRows = input.rows.map((row, index) => {
    const mapped: Record<string, unknown> = {};
    for (const col of input.columnMapping) {
      mapped[col.destinationColumn] = row[col.sourceColumn] ?? null;
    }
    return { row: mapped, rowIndex: index + 1 };
  });

  const nonBlankRows = indexedMappedRows.filter(({ row }) => !isFullyBlankMappedRow(row));
  const prepared: PreparedGateRows = {
    mappedRows: nonBlankRows.map(({ row }) => row),
    indexedMappedRows: nonBlankRows,
    blankRowsSkipped: indexedMappedRows.length - nonBlankRows.length,
  };

  if (input.mergeStrategy === "UPSERT" && nonBlankRows.length > 0) {
    const keyColumns = resolvePrimaryKeyDestinationColumns(
      input.primaryKeyColumns,
      input.columnMapping
    );
    const preflight = preflightUpsertKey({
      primaryKeyColumns: keyColumns,
      rows: nonBlankRows,
    });
    if (!preflight.ok) {
      prepared.keyDrift = preflight.keyDrift;
    }
  }

  return prepared;
}

async function prepareMappedRowsForPushWithRecommendation(input: {
  rows: Record<string, unknown>[];
  columnMapping: ColumnMap[];
  primaryKeyColumns: string[];
  mergeStrategy: string;
}): Promise<PreparedGateRows> {
  const prepared = prepareMappedRowsForPush(input);
  if (!prepared.keyDrift) return prepared;

  prepared.keyDrift = await enrichKeyDriftRecommendation({
    keyDrift: prepared.keyDrift,
    mappedRows: prepared.mappedRows,
    columns: input.columnMapping.map((mapping) => mapping.destinationColumn),
  });
  return prepared;
}

export function derivePushStatus(input: {
  attemptedRows: number;
  rowsErrored: number;
}): Exclude<GatePushExecutionStatus, "KEY_DRIFT"> {
  if (input.rowsErrored <= 0) return "SUCCESS";
  if (input.attemptedRows <= 0 || input.rowsErrored >= input.attemptedRows) return "FAILED";
  return "PARTIAL";
}

export function preflightUpsertKey(input: {
  primaryKeyColumns: string[];
  rows: IndexedMappedRow[];
  maxExamples?: number;
}): { ok: true } | { ok: false; keyDrift: KeyDriftDetails } {
  const maxExamples = input.maxExamples ?? 5;
  if (input.primaryKeyColumns.length === 0) return { ok: true };

  const duplicateCandidates = new Map<
    string,
    { keyValues: Record<string, string | number | boolean | null>; rowIndexes: number[] }
  >();
  const nullKeyExamples: KeyDriftDetails["nullKeyExamples"] = [];

  for (const indexedRow of input.rows) {
    const keyValues = buildSafeKeyValues(indexedRow.row, input.primaryKeyColumns);
    const missingColumns = input.primaryKeyColumns.filter((column) =>
      isBlankMappedValue(indexedRow.row[column])
    );

    if (missingColumns.length > 0) {
      if (nullKeyExamples.length < maxExamples) {
        nullKeyExamples.push({
          rowIndex: indexedRow.rowIndex,
          keyValues,
          missingColumns,
        });
      }
      continue;
    }

    const signature = JSON.stringify(input.primaryKeyColumns.map((column) => keyValues[column]));
    const existing = duplicateCandidates.get(signature);
    if (existing) {
      existing.rowIndexes.push(indexedRow.rowIndex);
    } else {
      duplicateCandidates.set(signature, {
        keyValues,
        rowIndexes: [indexedRow.rowIndex],
      });
    }
  }

  const duplicateExamples = Array.from(duplicateCandidates.values())
    .filter((example) => example.rowIndexes.length > 1)
    .slice(0, maxExamples);

  if (duplicateExamples.length === 0 && nullKeyExamples.length === 0) {
    return { ok: true };
  }

  const hasDuplicates = duplicateExamples.length > 0;
  const hasNullKeys = nullKeyExamples.length > 0;
  const reason = hasDuplicates && hasNullKeys
    ? "Current UPSERT key has duplicate and blank values in this upload."
    : hasDuplicates
      ? "Current UPSERT key has duplicate values in this upload."
      : "Current UPSERT key has blank values in this upload.";

  return {
    ok: false,
    keyDrift: {
      oldKey: input.primaryKeyColumns,
      duplicateExamples,
      nullKeyExamples,
      reason,
      candidateKeys: [],
      recommendation: null,
      validationStats: null,
      aiUsed: false,
      aiExplanation: null,
      noReliableKeyReason: null,
      discoveryMode: undefined,
      searchExhaustive: undefined,
      columnsConsidered: undefined,
      columnsExcluded: undefined,
      discriminatorColumns: undefined,
      currentKeyDuplicateGroupCount: undefined,
      candidateSearchLimits: undefined,
      selectedKey: null,
    },
  };
}

async function enrichKeyDriftRecommendation(input: {
  keyDrift: KeyDriftDetails;
  mappedRows: Record<string, unknown>[];
  columns: string[];
}): Promise<KeyDriftDetails> {
  const discovery = discoverUniqueColumnCombinations(input.mappedRows, input.columns, {
    currentKeyColumns: input.keyDrift.oldKey,
  });
  const deterministic = buildKeyDriftRecommendation({
    candidateKeys: discovery.candidates,
    validationStats: discovery.stats,
    noReliableKeyReason: discovery.noReliableKeyReason,
  });
  const aiResult = await recommendGateKey({
    candidateKeys: deterministic.candidateKeys,
    validationStats: deterministic.validationStats,
    currentKeyFailure: {
      oldKey: input.keyDrift.oldKey,
      reason: input.keyDrift.reason,
      duplicateExampleCount: input.keyDrift.duplicateExamples.length,
      nullKeyExampleCount: input.keyDrift.nullKeyExamples.length,
    },
    useAi: shouldUseAiKeyRecommendation(),
  });

  return {
    ...input.keyDrift,
    candidateKeys: deterministic.candidateKeys,
    recommendation: aiResult.recommendation,
    validationStats: deterministic.validationStats,
    aiUsed: aiResult.aiUsed,
    aiExplanation: aiResult.aiExplanation,
    noReliableKeyReason: deterministic.noReliableKeyReason,
    discoveryMode: discovery.stats.discoveryMode,
    searchExhaustive: discovery.stats.searchExhaustive,
    columnsConsidered: discovery.stats.columnsConsidered,
    columnsExcluded: discovery.stats.columnsExcluded,
    discriminatorColumns: discovery.stats.discriminatorColumns,
    currentKeyDuplicateGroupCount: discovery.stats.currentKeyDuplicateGroupCount,
    candidateSearchLimits: discovery.stats.candidateSearchLimits,
    selectedKey: null,
  };
}

function shouldUseAiKeyRecommendation(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.GATE_KEY_RECOMMENDATION_AI ?? "").toLowerCase()
  );
}

function buildSafeKeyValues(
  row: Record<string, unknown>,
  keyColumns: string[]
): Record<string, string | number | boolean | null> {
  const values: Record<string, string | number | boolean | null> = {};
  for (const column of keyColumns) {
    values[column] = toSafeKeyValue(row[column]);
  }
  return values;
}

function toSafeKeyValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function persistPushResult(pushId: string, result: PushResult): Promise<void> {
  const hasRowErrors = result.rowsErrored > 0;

  await prisma.gatePush.update({
    where: { id: pushId },
    data: {
      status: result.status,
      rowCount: result.rowCount,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsErrored: result.rowsErrored,
      blankRowsSkipped: result.blankRowsSkipped,
      keyDrift: result.keyDrift
        ? (result.keyDrift as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      errorMessage: result.errorMessage ?? null,
      errorDetails: hasRowErrors
        ? ({
            status: result.status,
            rowsErrored: result.rowsErrored,
          } as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      duration: result.duration,
      completedAt: result.status === "KEY_DRIFT" ? null : new Date(),
    },
  });
}

function applyDefaultErrorMessage(result: PushResult): void {
  if (result.errorMessage) return;
  if (result.status === "FAILED") {
    result.errorMessage = "Gate push failed for all rows.";
  } else if (result.status === "PARTIAL") {
    result.errorMessage = "Gate push completed with row errors.";
  }
}

async function markGateDelivered(gateId: string): Promise<void> {
  await prisma.realmGate.update({
    where: { id: gateId },
    data: {
      lastPushAt: new Date(),
      pushCount: { increment: 1 },
    },
  });
}

async function truncateAndLoad(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  rows: Record<string, unknown>[]
): Promise<PushResult> {
  if (!provider.load) throw new Error(`Provider does not support load`);

  const destConfig: DestConfig = {
    dataset: gate.targetSchema || "public",
    table: gate.targetTable,
    writeDisposition: "WRITE_TRUNCATE",
    autoCreateTable: false,
  };

  const result: LoadResult = await provider.load(conn, rows, destConfig);
  const rowsErrored = loadErrorCount(result, rows.length);

  return {
    status: derivePushStatus({ attemptedRows: rows.length, rowsErrored }),
    rowCount: rows.length,
    rowsInserted: result.rowsLoaded,
    rowsUpdated: 0,
    rowsErrored,
    blankRowsSkipped: 0,
    duration: 0,
  };
}

async function appendRows(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  rows: Record<string, unknown>[]
): Promise<PushResult> {
  if (!provider.load) throw new Error(`Provider does not support load`);

  const destConfig: DestConfig = {
    dataset: gate.targetSchema || "public",
    table: gate.targetTable,
    writeDisposition: "WRITE_APPEND",
    autoCreateTable: false,
  };

  const result: LoadResult = await provider.load(conn, rows, destConfig);
  const rowsErrored = loadErrorCount(result, rows.length);

  return {
    status: derivePushStatus({ attemptedRows: rows.length, rowsErrored }),
    rowCount: rows.length,
    rowsInserted: result.rowsLoaded,
    rowsUpdated: 0,
    rowsErrored,
    blankRowsSkipped: 0,
    duration: 0,
  };
}

function loadErrorCount(result: LoadResult, attemptedRows: number): number {
  if (result.errors.length === 0) return 0;
  return Math.max(result.errors.length, attemptedRows - result.rowsLoaded);
}

async function upsertRows(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  primaryKeyColumns: string[],
  rows: Record<string, unknown>[],
  columnMapping: ColumnMap[]
): Promise<PushResult> {
  if (primaryKeyColumns.length === 0) {
    throw new Error("No primary key columns configured");
  }

  // Use provider.query to execute an UPSERT via SQL
  if (!provider.query) {
    throw new Error("Provider does not support query — cannot execute UPSERT");
  }

  const schema = gate.targetSchema || "public";
  const destColumns = columnMapping.map((m) => m.destinationColumn);
  const pkColumns = primaryKeyColumns;

  let inserted = 0;
  let updated = 0;
  let errored = 0;

  // Process in batches of 200 for UPSERT (smaller than append due to ON CONFLICT complexity)
  const BATCH_SIZE = 200;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    try {
      // Build the upsert SQL based on connection type
      const connType = (provider as { type?: string }).type ?? "POSTGRES";
      const sql = buildUpsertSql(connType, schema, gate.targetTable, destColumns, pkColumns, batch);

      await provider.query(conn, sql);

      // Without RETURNING counts, approximate: assume all succeeded
      // A real implementation would parse affected rows, but this works for V1
      inserted += batch.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Gate] Upsert batch ${i}-${i + batch.length} failed: ${message}`);
      errored += batch.length;
    }
  }

  return {
    status: derivePushStatus({ attemptedRows: rows.length, rowsErrored: errored }),
    rowCount: rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    rowsErrored: errored,
    blankRowsSkipped: 0,
    duration: 0,
  };
}

// ─── SQL Builders ───────────────────────────────────

function buildUpsertSql(
  connType: string,
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  switch (connType) {
    case "POSTGRES":
      return buildPostgresUpsert(schema, table, columns, pkColumns, rows);
    case "MSSQL":
      return buildMssqlMerge(schema, table, columns, pkColumns, rows);
    case "MYSQL":
      return buildMysqlUpsert(schema, table, columns, pkColumns, rows);
    default:
      return buildPostgresUpsert(schema, table, columns, pkColumns, rows);
  }
}

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPostgresUpsert(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = fullSqlTableRef(schema, table, "postgres");
  const colList = columns.map((c) => quoteSqlIdentifier(c, "postgres")).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `${quoteSqlIdentifier(c, "postgres")} = EXCLUDED.${quoteSqlIdentifier(c, "postgres")}`)
    .join(", ");
  const conflictCols = pkColumns.map((c) => quoteSqlIdentifier(c, "postgres")).join(", ");

  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  return `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}
    ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`;
}

function buildMssqlMerge(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = fullSqlTableRef(schema, table, "mssql");
  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  const colList = columns.map((c) => quoteSqlIdentifier(c, "mssql")).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `T.${quoteSqlIdentifier(c, "mssql")} = S.${quoteSqlIdentifier(c, "mssql")}`)
    .join(", ");
  const insertCols = columns.map((c) => quoteSqlIdentifier(c, "mssql")).join(", ");
  const insertVals = columns.map((c) => `S.${quoteSqlIdentifier(c, "mssql")}`).join(", ");
  const onClause = pkColumns.map((c) => `T.${quoteSqlIdentifier(c, "mssql")} = S.${quoteSqlIdentifier(c, "mssql")}`).join(" AND ");

  return `MERGE ${fullTable} AS T
    USING (VALUES ${valueClauses.join(", ")}) AS S (${colList})
    ON ${onClause}
    WHEN MATCHED THEN UPDATE SET ${updateCols}
    WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`;
}

function buildMysqlUpsert(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = fullSqlTableRef(schema, table, "mysql");
  const colList = columns.map((c) => quoteSqlIdentifier(c, "mysql")).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `${quoteSqlIdentifier(c, "mysql")} = VALUES(${quoteSqlIdentifier(c, "mysql")})`)
    .join(", ");

  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  return `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}
    ON DUPLICATE KEY UPDATE ${updateCols}`;
}
