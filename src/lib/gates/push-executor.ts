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
import { isDateLikeColumnName } from "@/lib/duckdb/schema-diff";
import { fullSqlTableRef, quoteSqlIdentifier } from "./sql-identifiers";
import {
  type CandidateKey,
  type CandidateSearchLimits,
  type ColumnExclusion,
  type DiscriminatorColumnStats,
  type KeyDiscoveryMode,
  type KeyDiscoveryStats,
  type KeyRecommendation,
} from "./key-discovery";
import { discoverGateKeyCandidates } from "./gate-ucc-discovery";
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

export interface KeyDriftMappedColumn {
  name: string;
  sourceColumn: string;
  destinationColumn: string;
  nonBlankCount: number;
  nullCount: number;
  distinctCount: number;
  isCurrentKey: boolean;
  isDiscriminator: boolean;
}

export interface KeyDriftDetails {
  oldKey: string[];
  driftType?: "DUPLICATE_KEY" | "BLANK_KEY" | "DUPLICATE_AND_BLANK_KEY";
  currentKeyStillUniqueForBusinessRows?: boolean;
  requiresIncompleteRowApproval?: boolean;
  incompleteRowsHeld?: number;
  incompleteRowExamples?: Array<{
    rowIndex: number;
    keyValues: Record<string, string | number | boolean | null>;
    missingColumns: string[];
  }>;
  recommendedAction?: "REVIEW_INCOMPLETE_ROWS" | "HARDEN_KEY";
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
  mappedColumns?: KeyDriftMappedColumn[];
  manualSelection?: boolean;
  manualValidation?: unknown;
  appliedDdl?: string[];
  incompleteRowAction?: "EXCLUDE_REVIEWED_ROWS";
  incompleteRowsExcluded?: number;
  excludedRowIndexes?: number[];
  selectedKey: string[] | null;
}

export interface PushResult {
  status: GatePushExecutionStatus;
  rowCount: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsErrored: number;
  rowErrors?: GateRowTypeError[];
  blankRowsSkipped: number;
  keyDrift?: KeyDriftDetails;
  duration: number;
  errorMessage?: string;
}

export interface ExecutePushOptions {
  excludeRowIndexesForKeyReview?: number[];
  keyDriftReviewMetadata?: KeyDriftDetails;
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

export interface UpsertBatchSql {
  countExistingSql: string;
  updateExistingSql: string | null;
  insertMissingSql: string;
}

export interface GateValueCoercionError {
  column: string;
  destType: string | null;
  valuePreview: string;
  reason: string;
  rowIndex?: number;
}

export type GateValueCoercionResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      error: GateValueCoercionError;
    };

export type GateRowTypeError = GateValueCoercionError & {
  rowIndex: number;
};

// ─── Execute Push ───────────────────────────────────

export async function executePush(
  gateId: string,
  pushId: string,
  fileBuffer: Buffer,
  fileExtension: string,
  options: ExecutePushOptions = {}
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
      keyDrift: options.keyDriftReviewMetadata,
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
      excludeRowIndexesForKeyReview: options.excludeRowIndexesForKeyReview,
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
          prepared.indexedMappedRows,
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
    if (options.keyDriftReviewMetadata) {
      result.keyDrift = options.keyDriftReviewMetadata;
    }
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
    const destinationFields = new Map(
      schema?.fields.map((field) => [field.name.toLowerCase(), field]) ?? []
    );
    if (destinationFields.size === 0) return columnMapping;

    return columnMapping.map((mapping) => {
      const directField = destinationFields.get(mapping.destinationColumn.toLowerCase());
      if (directField) {
        return {
          ...mapping,
          destinationColumn: directField.name,
          destType: directField.type ?? mapping.destType,
        };
      }

      const normalized = normalizeDestinationColumnName(mapping.sourceColumn);
      const normalizedField = destinationFields.get(normalized.toLowerCase());
      if (normalizedField) {
        return {
          ...mapping,
          destinationColumn: normalizedField.name,
          destType: normalizedField.type ?? mapping.destType,
        };
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
  excludeRowIndexesForKeyReview?: number[];
}): PreparedGateRows {
  const excludedRowIndexes = new Set(input.excludeRowIndexesForKeyReview ?? []);
  const indexedMappedRows = input.rows.map((row, index) => {
    const mapped: Record<string, unknown> = {};
    for (const col of input.columnMapping) {
      mapped[col.destinationColumn] = row[col.sourceColumn] ?? null;
    }
    return { row: mapped, rowIndex: index + 1 };
  });

  const nonBlankRowsBeforeReviewExclusion = indexedMappedRows
    .filter(({ row }) => !isFullyBlankMappedRow(row));
  const nonBlankRows = nonBlankRowsBeforeReviewExclusion
    .filter(({ rowIndex }) => !excludedRowIndexes.has(rowIndex));
  const prepared: PreparedGateRows = {
    mappedRows: nonBlankRows.map(({ row }) => row),
    indexedMappedRows: nonBlankRows,
    blankRowsSkipped: indexedMappedRows.length - nonBlankRowsBeforeReviewExclusion.length,
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
  excludeRowIndexesForKeyReview?: number[];
}): Promise<PreparedGateRows> {
  const prepared = prepareMappedRowsForPush(input);
  if (!prepared.keyDrift) return prepared;

  prepared.keyDrift = await enrichKeyDriftRecommendation({
    keyDrift: prepared.keyDrift,
    mappedRows: prepared.mappedRows,
    columnMapping: input.columnMapping,
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

type DestinationTypeKind = "integer" | "numeric" | "boolean" | "date" | "timestamp" | "text";

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;
const NUMERIC_STRING_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

function normalizeDestinationType(destType: string | null | undefined): string {
  return (destType ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function destinationTypeBase(destType: string | null | undefined): string {
  return normalizeDestinationType(destType).replace(/\([^)]*\)/g, "").trim();
}

function destinationTypeKind(destType: string | null | undefined): DestinationTypeKind {
  const normalized = normalizeDestinationType(destType);
  const base = destinationTypeBase(destType);

  if (
    [
      "smallint",
      "int2",
      "integer",
      "int",
      "int4",
      "bigint",
      "int8",
      "int64",
      "serial",
      "smallserial",
      "bigserial",
    ].includes(base)
  ) {
    return "integer";
  }

  if (
    [
      "float",
      "float4",
      "float8",
      "float64",
      "real",
      "double",
      "double precision",
      "numeric",
      "decimal",
      "number",
      "money",
    ].includes(base)
  ) {
    return "numeric";
  }

  if (["boolean", "bool"].includes(base) || normalized === "tinyint(1)") {
    return "boolean";
  }

  if (base === "date") {
    return "date";
  }

  if (
    base === "timestamp" ||
    base === "timestamptz" ||
    base === "datetime" ||
    base === "datetime2" ||
    base === "timestamp without time zone" ||
    base === "timestamp with time zone"
  ) {
    return "timestamp";
  }

  return "text";
}

function isBlankCoercionInput(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function safeValuePreview(value: unknown, maxLength = 48): string {
  let preview: string;
  if (value instanceof Date) {
    preview = Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  } else if (typeof value === "string") {
    preview = value;
  } else if (value === null) {
    preview = "null";
  } else if (value === undefined) {
    preview = "undefined";
  } else if (typeof value === "object") {
    try {
      preview = JSON.stringify(value);
    } catch {
      preview = "[object]";
    }
  } else {
    preview = String(value);
  }

  preview = preview
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/\b(password|pwd|pass|secret|token)=([^&\s]+)/gi, "$1=[redacted]");

  return preview.length > maxLength ? `${preview.slice(0, maxLength)}...` : preview;
}

function invalidCoercionResult(input: {
  column: string;
  destType: string | null;
  value: unknown;
  reason: string;
  rowIndex?: number;
}): GateValueCoercionResult {
  return {
    ok: false,
    error: {
      column: input.column,
      destType: input.destType,
      valuePreview: safeValuePreview(input.value),
      reason: input.reason,
      rowIndex: input.rowIndex,
    },
  };
}

function normalizeNumericString(value: string): string {
  return value.trim();
}

function coerceDateLikeValue(input: {
  value: unknown;
  destType: string | null;
  column: string;
  rowIndex?: number;
  kind: "date" | "timestamp";
}): GateValueCoercionResult {
  if (isBlankCoercionInput(input.value)) {
    return { ok: true, value: null };
  }

  const parsed =
    input.value instanceof Date
      ? input.value
      : typeof input.value === "string" || typeof input.value === "number"
        ? new Date(input.value)
        : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return invalidCoercionResult({
      column: input.column,
      destType: input.destType,
      value: input.value,
      reason: input.kind === "date" ? "Expected date-compatible value" : "Expected timestamp-compatible value",
      rowIndex: input.rowIndex,
    });
  }

  return {
    ok: true,
    value: input.kind === "date" ? parsed.toISOString().slice(0, 10) : parsed.toISOString(),
  };
}

// Excel 1900 date system: serial day 0 = 1899-12-30 (the convention the
// downstream normalization view uses when converting etd back to a date).
const EXCEL_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeTwoDigitYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function parseCalendarDateParts(
  value: unknown
): { year: number; month: number; day: number } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };

  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return { year: normalizeTwoDigitYear(+m[3]), month: +m[1], day: +m[2] };

  m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const month = MONTH_ABBREVIATIONS[m[2].toLowerCase()];
    if (!month) return null;
    return { year: normalizeTwoDigitYear(+m[3]), month, day: +m[1] };
  }
  return null;
}

/**
 * Convert a date value into an Excel serial day number, but only for columns
 * whose name looks like a date — matching the same heuristic the schema-drift
 * detector (`isExcelSerialDateCompatibility`) uses to treat an integer column
 * and incoming dates as compatible. These columns store the raw, as-delivered
 * Excel serial; when the source switches to real dates we convert so rows land
 * consistently with existing data and the downstream view, instead of failing.
 * Returns null when the column is not date-named or the value is not a valid
 * calendar date.
 */
function coerceDateToExcelSerial(value: unknown, column: string): number | null {
  if (!isDateLikeColumnName(column)) return null;
  const parts = parseCalendarDateParts(value);
  if (!parts) return null;

  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  if (Number.isNaN(utc)) return null;
  // Reject impossible calendar dates (e.g., 2024-13-40) — Date.UTC rolls them over.
  const roundTrip = new Date(utc);
  if (
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return Math.round((utc - EXCEL_DATE_EPOCH_UTC) / MS_PER_DAY);
}

export function coerceGateValueForDestination(input: {
  value: unknown;
  destType: string | null;
  column: string;
  rowIndex?: number;
}): GateValueCoercionResult {
  const kind = destinationTypeKind(input.destType);

  if (kind === "text") {
    return { ok: true, value: input.value };
  }

  if (isBlankCoercionInput(input.value)) {
    return { ok: true, value: null };
  }

  if (kind === "integer") {
    if (typeof input.value === "bigint") {
      return { ok: true, value: input.value.toString() };
    }

    if (
      typeof input.value === "number" &&
      Number.isFinite(input.value) &&
      Number.isInteger(input.value)
    ) {
      return { ok: true, value: input.value };
    }

    if (typeof input.value === "string") {
      const normalized = normalizeNumericString(input.value);
      if (INTEGER_STRING_PATTERN.test(normalized)) {
        return { ok: true, value: normalized };
      }
    }

    // Date-named integer columns store Excel serial day numbers. When the source
    // sends a real date instead of the legacy serial, convert it so the row lands
    // consistently with existing data and the downstream view, rather than failing.
    const serial = coerceDateToExcelSerial(input.value, input.column);
    if (serial !== null) {
      return { ok: true, value: serial };
    }

    return invalidCoercionResult({
      column: input.column,
      destType: input.destType,
      value: input.value,
      reason: "Expected integer-compatible value",
      rowIndex: input.rowIndex,
    });
  }

  if (kind === "numeric") {
    if (typeof input.value === "bigint") {
      return { ok: true, value: input.value.toString() };
    }

    if (typeof input.value === "number") {
      return Number.isFinite(input.value)
        ? { ok: true, value: input.value }
        : invalidCoercionResult({
            column: input.column,
            destType: input.destType,
            value: input.value,
            reason: "Expected numeric-compatible value",
            rowIndex: input.rowIndex,
          });
    }

    if (typeof input.value === "string") {
      const normalized = normalizeNumericString(input.value);
      return NUMERIC_STRING_PATTERN.test(normalized)
        ? { ok: true, value: normalized }
        : invalidCoercionResult({
            column: input.column,
            destType: input.destType,
            value: input.value,
            reason: "Expected numeric-compatible value",
            rowIndex: input.rowIndex,
          });
    }

    return invalidCoercionResult({
      column: input.column,
      destType: input.destType,
      value: input.value,
      reason: "Expected numeric-compatible value",
      rowIndex: input.rowIndex,
    });
  }

  if (kind === "boolean") {
    if (typeof input.value === "boolean") {
      return { ok: true, value: input.value };
    }

    if (typeof input.value === "number") {
      if (input.value === 1) return { ok: true, value: true };
      if (input.value === 0) return { ok: true, value: false };
    }

    if (typeof input.value === "string") {
      const normalized = input.value.trim().toLowerCase();
      if (["true", "t", "1", "yes", "y"].includes(normalized)) {
        return { ok: true, value: true };
      }
      if (["false", "f", "0", "no", "n"].includes(normalized)) {
        return { ok: true, value: false };
      }
    }

    return invalidCoercionResult({
      column: input.column,
      destType: input.destType,
      value: input.value,
      reason: "Expected boolean-compatible value",
      rowIndex: input.rowIndex,
    });
  }

  return coerceDateLikeValue({
    value: input.value,
    destType: input.destType,
    column: input.column,
    rowIndex: input.rowIndex,
    kind,
  });
}

export function coerceGateRowsForDestination(input: {
  rows: IndexedMappedRow[];
  columnMapping: ColumnMap[];
}): { rows: IndexedMappedRow[]; errors: GateRowTypeError[] } {
  const coercedRows: IndexedMappedRow[] = [];
  const errors: GateRowTypeError[] = [];

  for (const indexedRow of input.rows) {
    const coercedRow: Record<string, unknown> = { ...indexedRow.row };
    const rowErrors: GateRowTypeError[] = [];

    for (const mapping of input.columnMapping) {
      const column = mapping.destinationColumn;
      const result = coerceGateValueForDestination({
        value: indexedRow.row[column],
        destType: mapping.destType,
        column,
        rowIndex: indexedRow.rowIndex,
      });

      if (result.ok) {
        coercedRow[column] = result.value;
      } else {
        rowErrors.push({
          ...result.error,
          rowIndex: indexedRow.rowIndex,
        });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      coercedRows.push({
        rowIndex: indexedRow.rowIndex,
        row: coercedRow,
      });
    }
  }

  return { rows: coercedRows, errors };
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
  let nullKeyCount = 0;

  for (const indexedRow of input.rows) {
    const keyValues = buildSafeKeyValues(indexedRow.row, input.primaryKeyColumns);
    const missingColumns = input.primaryKeyColumns.filter((column) =>
      isBlankMappedValue(indexedRow.row[column])
    );

    if (missingColumns.length > 0) {
      nullKeyCount++;
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
  const hasNullKeys = nullKeyCount > 0;
  const driftType = hasDuplicates && hasNullKeys
    ? "DUPLICATE_AND_BLANK_KEY"
    : hasDuplicates
      ? "DUPLICATE_KEY"
      : "BLANK_KEY";
  const reason = hasDuplicates && hasNullKeys
    ? "Current UPSERT key has duplicate and blank values in this upload."
    : hasDuplicates
      ? "Current UPSERT key has duplicate values in this upload."
      : "Current UPSERT key has blank values in this upload.";

  return {
    ok: false,
    keyDrift: {
      oldKey: input.primaryKeyColumns,
      driftType,
      currentKeyStillUniqueForBusinessRows: !hasDuplicates,
      requiresIncompleteRowApproval: !hasDuplicates && hasNullKeys,
      incompleteRowsHeld: nullKeyCount,
      incompleteRowExamples: nullKeyExamples,
      recommendedAction: !hasDuplicates && hasNullKeys
        ? "REVIEW_INCOMPLETE_ROWS"
        : "HARDEN_KEY",
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
  columnMapping: ColumnMap[];
  columns: string[];
}): Promise<KeyDriftDetails> {
  if (
    input.keyDrift.driftType === "BLANK_KEY" &&
    input.keyDrift.duplicateExamples.length === 0
  ) {
    return {
      ...input.keyDrift,
      mappedColumns: buildMappedColumnMetadata({
        mappedRows: input.mappedRows,
        columnMapping: input.columnMapping,
        currentKeyColumns: input.keyDrift.oldKey,
        discriminatorColumns: [],
      }),
      selectedKey: null,
    };
  }

  const discovery = await discoverGateKeyCandidates({
    mappedRows: input.mappedRows,
    mappedColumns: input.columns,
    currentKeyColumns: input.keyDrift.oldKey,
    thorough: true,
  });
  const aiResult = await recommendGateKey({
    candidateKeys: discovery.candidateKeys,
    validationStats: discovery.validationStats,
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
    candidateKeys: discovery.candidateKeys,
    recommendation: aiResult.aiUsed ? aiResult.recommendation : discovery.recommendation,
    validationStats: discovery.validationStats,
    aiUsed: aiResult.aiUsed,
    aiExplanation: aiResult.aiExplanation,
    noReliableKeyReason: discovery.noReliableKeyReason,
    discoveryMode: discovery.validationStats.discoveryMode,
    searchExhaustive: discovery.validationStats.searchExhaustive,
    columnsConsidered: discovery.validationStats.columnsConsidered,
    columnsExcluded: discovery.validationStats.columnsExcluded,
    discriminatorColumns: discovery.validationStats.discriminatorColumns,
    currentKeyDuplicateGroupCount: discovery.validationStats.currentKeyDuplicateGroupCount,
    candidateSearchLimits: discovery.validationStats.candidateSearchLimits,
    mappedColumns: buildMappedColumnMetadata({
      mappedRows: input.mappedRows,
      columnMapping: input.columnMapping,
      currentKeyColumns: input.keyDrift.oldKey,
      discriminatorColumns: discovery.validationStats.discriminatorColumns.map((column) => column.column),
    }),
    selectedKey: null,
  };
}

function buildMappedColumnMetadata(input: {
  mappedRows: Record<string, unknown>[];
  columnMapping: ColumnMap[];
  currentKeyColumns: string[];
  discriminatorColumns: string[];
}): KeyDriftMappedColumn[] {
  const currentKeySet = new Set(input.currentKeyColumns.map((column) => column.toLowerCase()));
  const discriminatorSet = new Set(input.discriminatorColumns.map((column) => column.toLowerCase()));
  const byDestination = new Map<string, ColumnMap>();

  for (const mapping of input.columnMapping) {
    const key = mapping.destinationColumn.toLowerCase();
    if (!byDestination.has(key)) byDestination.set(key, mapping);
  }

  return [...byDestination.values()].map((mapping) => {
    let nonBlankCount = 0;
    let nullCount = 0;
    const distinct = new Set<string>();

    for (const row of input.mappedRows) {
      const value = row[mapping.destinationColumn];
      if (isBlankMappedValue(value)) {
        nullCount++;
        continue;
      }

      nonBlankCount++;
      distinct.add(JSON.stringify(normalizeColumnValueForStats(value)));
    }

    return {
      name: mapping.destinationColumn,
      sourceColumn: mapping.sourceColumn,
      destinationColumn: mapping.destinationColumn,
      nonBlankCount,
      nullCount,
      distinctCount: distinct.size,
      isCurrentKey: currentKeySet.has(mapping.destinationColumn.toLowerCase()),
      isDiscriminator: discriminatorSet.has(mapping.destinationColumn.toLowerCase()),
    };
  });
}

function normalizeColumnValueForStats(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
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
  const rowErrors = result.rowErrors ?? [];
  const safeRowErrors = rowErrors.slice(0, 50).map((error) => ({
    rowIndex: error.rowIndex,
    column: error.column,
    destType: error.destType,
    valuePreview: error.valuePreview,
    reason: error.reason,
  }));

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
            rowErrors: safeRowErrors,
            rowErrorsTruncated: rowErrors.length > 50,
          } as unknown as Prisma.InputJsonValue)
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

function buildDestinationColumnTypeMap(columnMapping: ColumnMap[]): Record<string, string | null> {
  const columnTypes: Record<string, string | null> = {};
  for (const mapping of columnMapping) {
    columnTypes[mapping.destinationColumn] = mapping.destType;
  }
  return columnTypes;
}

function safeDatabaseErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/'[^']*'/g, "'[redacted]'")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 240);
}

async function upsertRows(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  primaryKeyColumns: string[],
  rows: IndexedMappedRow[],
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
  const columnTypes = buildDestinationColumnTypeMap(columnMapping);

  let inserted = 0;
  let updated = 0;
  let errored = 0;
  const rowErrors: GateRowTypeError[] = [];

  // Process in batches of 200 for UPSERT. Each batch updates matched keys first,
  // then inserts keys that are still missing, so existing-table Gates do not need
  // a physical UNIQUE/PRIMARY KEY constraint for repeat-file upserts to behave.
  const BATCH_SIZE = 200;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const coercedBatch = coerceGateRowsForDestination({
      rows: batch,
      columnMapping,
    });
    const invalidRows = new Set(coercedBatch.errors.map((error) => error.rowIndex));
    errored += invalidRows.size;
    rowErrors.push(...coercedBatch.errors);

    if (coercedBatch.rows.length === 0) {
      continue;
    }

    const batchRows = coercedBatch.rows.map((indexedRow) => indexedRow.row);

    try {
      const connType = (provider as { type?: string }).type ?? "POSTGRES";
      const sql = buildUpsertBatchSql(
        connType,
        schema,
        gate.targetTable,
        destColumns,
        pkColumns,
        batchRows,
        columnTypes
      );
      const existingKeyCount = Math.min(
        batchRows.length,
        Math.max(0, await countExistingBatchKeys(provider, conn, sql.countExistingSql))
      );

      if (sql.updateExistingSql) {
        await provider.query(conn, sql.updateExistingSql);
      }
      await provider.query(conn, sql.insertMissingSql);

      updated += existingKeyCount;
      inserted += batchRows.length - existingKeyCount;
    } catch (err) {
      console.error(
        `[Gate] Upsert batch ${i}-${i + batchRows.length} failed: ${safeDatabaseErrorMessage(err)}`
      );
      errored += batchRows.length;
      rowErrors.push({
        rowIndex: coercedBatch.rows[0]?.rowIndex ?? i,
        column: "__batch",
        destType: null,
        valuePreview: `${batchRows.length} rows`,
        reason: "UPSERT batch failed",
      });
    }
  }

  return {
    status: derivePushStatus({ attemptedRows: rows.length, rowsErrored: errored }),
    rowCount: rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    rowsErrored: errored,
    rowErrors,
    blankRowsSkipped: 0,
    duration: 0,
  };
}

// ─── SQL Builders ───────────────────────────────────

async function countExistingBatchKeys(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  sql: string
): Promise<number> {
  if (!provider.query) throw new Error("Provider does not support query");

  const result = await provider.query(conn, sql);
  const row = result.rows[0] ?? {};
  const value = row.existing_count ?? row.EXISTING_COUNT ?? row.existingCount ?? Object.values(row)[0];
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export function buildUpsertBatchSql(
  connType: string,
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string | null | undefined> = {}
): UpsertBatchSql {
  switch (connType) {
    case "POSTGRES":
      return buildPostgresUpsertBatch(schema, table, columns, pkColumns, rows, columnTypes);
    case "MSSQL":
      return buildMssqlUpsertBatch(schema, table, columns, pkColumns, rows, columnTypes);
    case "MYSQL":
      return buildMysqlUpsertBatch(schema, table, columns, pkColumns, rows);
    default:
      throw new Error(`UPSERT is not implemented for connection type ${connType}`);
  }
}

function postgresCastForDestinationType(destType: string | null | undefined): string | null {
  const kind = destinationTypeKind(destType);
  const normalized = normalizeDestinationType(destType);
  const base = destinationTypeBase(destType);

  if (kind === "integer") {
    if (["smallint", "int2", "smallserial"].includes(base)) return "smallint";
    return "bigint";
  }

  if (kind === "numeric") {
    if (["real", "float4"].includes(base)) return "real";
    if (["numeric", "decimal", "money", "number"].includes(base)) return "numeric";
    return "double precision";
  }

  if (kind === "boolean") return "boolean";
  if (kind === "date") return "date";
  if (kind === "timestamp") {
    return normalized.includes("without time zone") ? "timestamp" : "timestamptz";
  }

  return null;
}

function sqlEscape(
  value: unknown,
  dialect: "postgres" | "mssql" | "mysql",
  destType?: string | null
): string {
  let escaped: string;

  if (value === null || value === undefined) {
    escaped = "NULL";
  } else if (typeof value === "number") {
    escaped = String(value);
  } else if (typeof value === "boolean") {
    if (dialect === "mssql" || dialect === "mysql") {
      escaped = value ? "1" : "0";
    } else {
      escaped = value ? "TRUE" : "FALSE";
    }
  } else if (value instanceof Date) {
    escaped = `'${value.toISOString().replace(/'/g, "''")}'`;
  } else {
    escaped = `'${String(value).replace(/'/g, "''")}'`;
  }

  if (dialect !== "postgres") return escaped;

  const cast = postgresCastForDestinationType(destType);
  return cast ? `${escaped}::${cast}` : escaped;
}

function buildPostgresUpsertBatch(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string | null | undefined> = {}
): UpsertBatchSql {
  const fullTable = fullSqlTableRef(schema, table, "postgres");
  const source = buildValuesSource("postgres", columns, rows, columnTypes);
  const colList = quotedColumnList(columns, "postgres");
  const selectCols = selectSourceColumns(columns, "postgres");
  const match = keyMatchClause("postgres", "T", "S", pkColumns);
  const updateCols = nonKeyColumns(columns, pkColumns);
  const setClause = updateSetClause("postgres", updateCols);

  return {
    countExistingSql: `SELECT COUNT(*)::int AS existing_count
FROM ${source}
WHERE EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
    updateExistingSql: setClause
      ? `UPDATE ${fullTable} AS T
SET ${setClause}
FROM ${source}
WHERE ${match}`
      : null,
    insertMissingSql: `INSERT INTO ${fullTable} (${colList})
SELECT ${selectCols}
FROM ${source}
WHERE NOT EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
  };
}

function buildMssqlUpsertBatch(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string | null | undefined> = {}
): UpsertBatchSql {
  const fullTable = fullSqlTableRef(schema, table, "mssql");
  const source = buildValuesSource("mssql", columns, rows, columnTypes);
  const colList = quotedColumnList(columns, "mssql");
  const selectCols = selectSourceColumns(columns, "mssql");
  const match = keyMatchClause("mssql", "T", "S", pkColumns);
  const updateCols = nonKeyColumns(columns, pkColumns);
  const setClause = updateSetClause("mssql", updateCols);

  return {
    countExistingSql: `SELECT COUNT(*) AS existing_count
FROM ${source}
WHERE EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
    updateExistingSql: setClause
      ? `UPDATE T
SET ${setClause}
FROM ${fullTable} AS T
JOIN ${source} ON ${match}`
      : null,
    insertMissingSql: `INSERT INTO ${fullTable} (${colList})
SELECT ${selectCols}
FROM ${source}
WHERE NOT EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
  };
}

function buildMysqlUpsertBatch(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): UpsertBatchSql {
  const fullTable = fullSqlTableRef(schema, table, "mysql");
  const source = buildMysqlSelectSource(columns, rows);
  const colList = quotedColumnList(columns, "mysql");
  const selectCols = selectSourceColumns(columns, "mysql");
  const match = keyMatchClause("mysql", "T", "S", pkColumns);
  const updateCols = nonKeyColumns(columns, pkColumns);
  const setClause = updateSetClause("mysql", updateCols);

  return {
    countExistingSql: `SELECT COUNT(*) AS existing_count
FROM ${source}
WHERE EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
    updateExistingSql: setClause
      ? `UPDATE ${fullTable} AS T
JOIN ${source} ON ${match}
SET ${setClause}`
      : null,
    insertMissingSql: `INSERT INTO ${fullTable} (${colList})
SELECT ${selectCols}
FROM ${source}
WHERE NOT EXISTS (SELECT 1 FROM ${fullTable} AS T WHERE ${match})`,
  };
}

function buildValuesSource(
  dialect: "postgres" | "mssql",
  columns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string | null | undefined> = {}
): string {
  const valueClauses = rows.map((row) => {
    const vals = columns.map((column) => sqlEscape(row[column], dialect, columnTypes[column]));
    return `(${vals.join(", ")})`;
  });
  return `(VALUES ${valueClauses.join(", ")}) AS S (${quotedColumnList(columns, dialect)})`;
}

function buildMysqlSelectSource(
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  const selects = rows.map((row) => {
    const values = columns.map((column) => {
      return `${sqlEscape(row[column], "mysql")} AS ${quoteSqlIdentifier(column, "mysql")}`;
    });
    return `SELECT ${values.join(", ")}`;
  });
  return `(${selects.join(" UNION ALL ")}) AS S`;
}

function quotedColumnList(
  columns: string[],
  dialect: "postgres" | "mssql" | "mysql"
): string {
  return columns.map((column) => quoteSqlIdentifier(column, dialect)).join(", ");
}

function selectSourceColumns(
  columns: string[],
  dialect: "postgres" | "mssql" | "mysql"
): string {
  return columns.map((column) => `S.${quoteSqlIdentifier(column, dialect)}`).join(", ");
}

function nonKeyColumns(columns: string[], pkColumns: string[]): string[] {
  const pkSet = new Set(pkColumns.map((column) => column.toLowerCase()));
  return columns.filter((column) => !pkSet.has(column.toLowerCase()));
}

function updateSetClause(
  dialect: "postgres" | "mssql" | "mysql",
  columns: string[]
): string {
  return columns
    .map((column) => {
      const quoted = quoteSqlIdentifier(column, dialect);
      if (dialect === "postgres") return `${quoted} = S.${quoted}`;
      return `T.${quoted} = S.${quoted}`;
    })
    .join(", ");
}

function keyMatchClause(
  dialect: "postgres" | "mssql" | "mysql",
  leftAlias: string,
  rightAlias: string,
  pkColumns: string[]
): string {
  return pkColumns
    .map((column) => {
      const quoted = quoteSqlIdentifier(column, dialect);
      if (dialect === "postgres") {
        return `${leftAlias}.${quoted} IS NOT DISTINCT FROM ${rightAlias}.${quoted}`;
      }
      if (dialect === "mysql") {
        return `${leftAlias}.${quoted} <=> ${rightAlias}.${quoted}`;
      }
      return `${leftAlias}.${quoted} = ${rightAlias}.${quoted}`;
    })
    .join(" AND ");
}
