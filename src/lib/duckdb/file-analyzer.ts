/**
 * DuckDB File Analyzer — Nidavellir Foundation
 *
 * Replaces csv-detector.ts and excel-detector.ts for the ANALYSIS path.
 * Uses DuckDB to analyze the FULL dataset instead of sampling 100 rows.
 */

import { createAnalyticsSession } from "./engine";
import type { TableProfile, ColumnProfile } from "./engine";
import { toHermodType } from "./type-mapper";
import type { ColumnMapping, SchemaMapping } from "@/lib/alfheim/types";

// ─── Public Types ───────────────────────────────────

export interface FileAnalysisResult {
  tableName: string;
  rowCount: number;
  columns: AnalyzedColumn[];
  profile: TableProfile;
  previewRows: Record<string, unknown>[];
}

export interface AnalyzedColumn {
  name: string;
  duckdbType: string;
  inferredType: string;
  nullable: boolean;
  distinctCount: number;
  nullCount: number;
  nullPercentage: number;
  uniquenessRatio: number;
  sampleValues: string[];
}

// ─── Backward-Compatible Result Types ───────────────

/** CSV detection result shape that existing UI components expect */
export interface CsvAnalysisResult {
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: SchemaMapping;
  // New fields (additive, optional for consumers)
  profile?: TableProfile;
  analyzedColumns?: AnalyzedColumn[];
}

/** Excel detection result shape that existing UI components expect */
export interface ExcelAnalysisResult {
  availableSheets: string[];
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: SchemaMapping;
  // New fields (additive)
  profile?: TableProfile;
  analyzedColumns?: AnalyzedColumn[];
}

// ─── Helpers ────────────────────────────────────────

function profileToAnalyzedColumns(profile: TableProfile): AnalyzedColumn[] {
  return profile.columns.map((col: ColumnProfile) => ({
    name: col.name,
    duckdbType: col.duckdbType,
    inferredType: col.inferredType,
    nullable: col.nullCount > 0,
    distinctCount: col.distinctCount,
    nullCount: col.nullCount,
    nullPercentage: col.nullPercentage,
    uniquenessRatio: col.uniquenessRatio,
    sampleValues: col.sampleValues,
  }));
}

function profileToColumnMappings(profile: TableProfile): ColumnMapping[] {
  return profile.columns.map((col: ColumnProfile) => ({
    jsonPath: col.name,
    columnName: col.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    dataType: toHermodType(col.duckdbType),
    nullable: col.nullCount > 0,
  }));
}

// ─── CSV Analysis ───────────────────────────────────

export async function analyzeCSV(
  buffer: Buffer,
  options?: {
    delimiter?: string;
    hasHeaders?: boolean;
    skipRows?: number;
  }
): Promise<FileAnalysisResult> {
  const session = await createAnalyticsSession();
  try {
    await session.loadCSV(buffer, "staging", {
      delimiter: options?.delimiter,
      hasHeaders: options?.hasHeaders,
      skipRows: options?.skipRows,
    });
    const profile = await session.profileTable("staging");
    const previewRows = await session.query<Record<string, unknown>>(
      "SELECT * FROM staging LIMIT 20"
    );

    return {
      tableName: "staging",
      rowCount: profile.rowCount,
      columns: profileToAnalyzedColumns(profile),
      profile,
      previewRows,
    };
  } finally {
    await session.close();
  }
}

/**
 * Analyze a CSV buffer and return results in the same shape as the
 * legacy csv-detector.ts, so existing UI components keep working.
 */
export async function analyzeCSVCompat(
  buffer: Buffer,
  options?: {
    delimiter?: string;
    hasHeaders?: boolean;
    skipRows?: number;
  }
): Promise<CsvAnalysisResult> {
  const analysis = await analyzeCSV(buffer, options);

  // Detect delimiter from buffer if DuckDB auto-detected
  // DuckDB doesn't expose the detected delimiter, so we do a quick check
  const detectedDelimiter = options?.delimiter ?? detectDelimiterFromBuffer(buffer);

  return {
    delimiter: detectedDelimiter,
    hasHeaders: options?.hasHeaders ?? true, // DuckDB defaults to headers=true
    encoding: "utf-8",
    rowCount: analysis.rowCount,
    sampleRows: analysis.previewRows.slice(0, 20),
    schema: { columns: profileToColumnMappings(analysis.profile) },
    profile: analysis.profile,
    analyzedColumns: analysis.columns,
  };
}

/** Quick delimiter detection from first few lines (same heuristic as legacy) */
function detectDelimiterFromBuffer(buffer: Buffer): string {
  const sample = buffer.subarray(0, 8192).toString("utf-8");
  const delimiters = [",", "\t", "|", ";"] as const;
  let bestDelim = ",";
  let bestScore = -1;

  for (const delim of delimiters) {
    const lines = sample.split("\n").slice(0, 10).filter((l) => l.trim());
    if (lines.length < 2) continue;
    const counts = lines.map((l) => l.split(delim).length);
    const mode = counts.sort(
      (a, b) =>
        counts.filter((v) => v === b).length - counts.filter((v) => v === a).length
    )[0];
    const consistency = counts.filter((c) => c === mode).length / counts.length;
    const score = consistency * mode;
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }

  return bestDelim;
}

// ─── Excel Analysis ─────────────────────────────────

export async function analyzeExcel(
  buffer: Buffer,
  options?: {
    sheetName?: string;
    sheetIndex?: number;
    hasHeaders?: boolean;
    skipRows?: number;
  }
): Promise<FileAnalysisResult> {
  const session = await createAnalyticsSession();
  try {
    await session.loadExcel(buffer, "staging", options);
    const profile = await session.profileTable("staging");
    const previewRows = await session.query<Record<string, unknown>>(
      "SELECT * FROM staging LIMIT 20"
    );

    return {
      tableName: "staging",
      rowCount: profile.rowCount,
      columns: profileToAnalyzedColumns(profile),
      profile,
      previewRows,
    };
  } finally {
    await session.close();
  }
}

/**
 * Analyze an Excel buffer and return results in the legacy shape.
 * Requires the workbook to also be read with ExcelJS to get sheet metadata
 * (DuckDB doesn't expose sheet names).
 */
export async function analyzeExcelCompat(
  buffer: Buffer,
  options?: {
    sheetName?: string;
    headerRow?: number;
    dataStartRow?: number;
  }
): Promise<ExcelAnalysisResult> {
  // Get sheet metadata via ExcelJS (lightweight — just metadata, not full parse)
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const availableSheets = workbook.worksheets.map((ws) => ws.name);
  const sheetName = options?.sheetName ?? availableSheets[0] ?? "Sheet1";
  const headerRow = options?.headerRow ?? 1;
  const dataStartRow = options?.dataStartRow ?? headerRow + 1;

  // Run DuckDB analysis
  const skipRows = headerRow > 1 ? headerRow - 1 : 0;
  const analysis = await analyzeExcel(buffer, {
    sheetName,
    skipRows,
    hasHeaders: true,
  });

  return {
    availableSheets,
    sheetName,
    headerRow,
    dataStartRow,
    rowCount: analysis.rowCount,
    sampleRows: analysis.previewRows.slice(0, 20),
    schema: { columns: profileToColumnMappings(analysis.profile) },
    profile: analysis.profile,
    analyzedColumns: analysis.columns,
  };
}

// ─── Generic Rows Analysis ──────────────────────────

/**
 * Analyze pre-parsed rows (from SQL query results or other sources).
 * Loads into DuckDB for full profiling.
 */
export async function analyzeRows(
  rows: Record<string, unknown>[]
): Promise<FileAnalysisResult> {
  const session = await createAnalyticsSession();
  try {
    await session.loadRows(rows, "staging");
    const profile = await session.profileTable("staging");
    const previewRows = rows.slice(0, 20);

    return {
      tableName: "staging",
      rowCount: profile.rowCount,
      columns: profileToAnalyzedColumns(profile),
      profile,
      previewRows,
    };
  } finally {
    await session.close();
  }
}
