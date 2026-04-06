/**
 * DuckDB File Analyzer — Nidavellir Foundation
 *
 * Replaces csv-detector.ts and excel-detector.ts for the ANALYSIS path.
 * Uses DuckDB to analyze the FULL dataset instead of sampling 100 rows.
 */

import { createAnalyticsSession } from "./engine";
import type { AnalyticsSession, TableProfile, ColumnProfile } from "./engine";
import { toHermodType } from "./type-mapper";
import type { ColumnMapping, SchemaMapping } from "@/lib/alfheim/types";
import { discoverUCCs } from "@/lib/ucc";
import type { DiscoveredUCC, UCCStats } from "@/lib/ucc";

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

// ─── Unified Pipeline — THE single entry point ─────

export class FileAnalysisError extends Error {
  code: "INVALID_FILE_TYPE" | "FILE_TOO_LARGE" | "UNREADABLE_FILE" | "PROFILING_FAILED" | "UCC_TIMEOUT";
  context?: Record<string, unknown>;

  constructor(code: FileAnalysisError["code"], message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "FileAnalysisError";
    this.code = code;
    this.context = context;
  }
}

export interface FullAnalysisResult {
  fileName: string;
  fileType: "excel" | "csv" | "tsv";

  // Sheet metadata (Excel only)
  availableSheets?: string[];
  selectedSheet?: string;
  headerRow?: number;
  dataStartRow?: number;

  // Schema
  rowCount: number;
  columns: AnalyzedColumn[];
  profile: TableProfile;
  previewRows: Record<string, unknown>[];

  // Primary Key Detection
  primaryKey: {
    detected: boolean;
    column: string | null;
    compositeKey: string[] | null;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
    allKeys: Array<{
      columns: string[];
      type: "single" | "composite";
      quality: {
        columnCount: number;
        totalNullCount: number;
        hasIdPattern: boolean;
        allColumnsNotNull: boolean;
      };
    }>;
    nearMisses: Array<{
      columns: string[];
      uniquenessRatio: number;
      duplicateCount: number;
    }>;
    stats: {
      totalRows: number;
      candidateColumns: number;
      levelsSearched: number;
      queriesExecuted: number;
      durationMs: number;
      timedOut: boolean;
    };
  };

  // Backward compat
  schema: SchemaMapping;
}

/**
 * Full file ingestion pipeline — THE single entry point.
 *
 * Loads a file into DuckDB, profiles all columns against the full dataset,
 * runs UCC discovery for primary key detection, and returns everything.
 *
 * Both Connections and Gates call this. No other file analysis path should exist.
 */
export async function analyzeFile(
  buffer: Buffer,
  fileName: string,
  options?: {
    sheetName?: string;
    sheetIndex?: number;
    headerRow?: number;
    dataStartRow?: number;
    delimiter?: string;
    hasHeaders?: boolean;
    skipRows?: number;
    skipUCC?: boolean;
    thorough?: boolean;
  }
): Promise<FullAnalysisResult> {
  // 1. Determine file type
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  let fileType: "excel" | "csv" | "tsv";
  if (ext === "xlsx" || ext === "xls") {
    fileType = "excel";
  } else if (ext === "csv") {
    fileType = "csv";
  } else if (ext === "tsv") {
    fileType = "tsv";
  } else {
    throw new FileAnalysisError("INVALID_FILE_TYPE", `Unsupported file type: .${ext}. Accepted: .xlsx, .csv, .tsv`);
  }

  // 2. Create DuckDB session
  const session = await createAnalyticsSession();

  try {
    // 3. Load file
    try {
      if (fileType === "excel") {
        const skipRows = options?.headerRow && options.headerRow > 1 ? options.headerRow - 1 : options?.skipRows;
        await session.loadExcel(buffer, "staging", {
          sheetName: options?.sheetName,
          sheetIndex: options?.sheetIndex,
          hasHeaders: options?.hasHeaders,
          skipRows,
        });
      } else {
        await session.loadCSV(buffer, "staging", {
          delimiter: options?.delimiter ?? (fileType === "tsv" ? "\t" : undefined),
          hasHeaders: options?.hasHeaders,
          skipRows: options?.skipRows,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("memory") || msg.includes("allocation")) {
        throw new FileAnalysisError("FILE_TOO_LARGE", "File is too large for in-memory analysis", { originalError: msg });
      }
      throw new FileAnalysisError("UNREADABLE_FILE", `Could not read file: ${msg}`);
    }

    // 4. Profile
    let profile: TableProfile;
    try {
      profile = await session.profileTable("staging");
    } catch (err) {
      throw new FileAnalysisError("PROFILING_FAILED", `DuckDB profiling failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Excel sheet metadata
    let availableSheets: string[] | undefined;
    let selectedSheet: string | undefined;
    if (fileType === "excel") {
      try {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.default.Workbook();
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
        availableSheets = workbook.worksheets.map((ws) => ws.name);
        selectedSheet = options?.sheetName ?? availableSheets[0] ?? "Sheet1";
      } catch {
        // Sheet metadata is non-critical
      }
    }

    // 6. Preview rows
    const previewRows = profile.rowCount > 0
      ? await session.query<Record<string, unknown>>("SELECT * FROM staging LIMIT 20")
      : [];

    const columns = profileToAnalyzedColumns(profile);

    // 7. Early exit for empty files
    if (profile.rowCount === 0) {
      return buildFullResult({
        fileName, fileType, availableSheets, selectedSheet, options,
        profile, columns, previewRows,
        primaryKey: noPrimaryKey(0),
      });
    }

    // 8-13. UCC Discovery — two-pass approach: original data first, normalized as fallback
    let allFoundKeys: import("@/lib/ucc").DiscoveredUCC[] = [];
    let uccStats: import("@/lib/ucc").UCCStats | null = null;

    if (!options?.skipUCC && profile.rowCount > 1) {
      // ── PASS 1: Run UCC on original staging table ──
      // This matches what the connection flow does — no normalization, just raw data.
      console.log("[analyzeFile] PASS 1: UCC on staging (original data)");
      try {
        const uccResult = await discoverUCCs(session, "staging", profile);
        allFoundKeys = [...uccResult.uccs];
        uccStats = uccResult.stats;
        console.log(`[analyzeFile] PASS 1 result: ${allFoundKeys.length} keys found, ${uccResult.stats.queriesExecuted} queries, ${uccResult.stats.timedOut ? "TIMED OUT" : "OK"}`);
        if (allFoundKeys.length > 0) {
          console.log(`[analyzeFile] PASS 1 best key: [${allFoundKeys[0].columns.join(", ")}] (${allFoundKeys[0].type})`);
        }
      } catch (err) {
        console.error("[analyzeFile] PASS 1 UCC discovery failed:", err instanceof Error ? err.message : err);
      }

      // ── Single-column fallback on original data ──
      // Catches columns the AI pruner excluded. One query per column, cheap.
      const foundSingleCols = new Set(
        allFoundKeys.filter((k) => k.type === "single").map((k) => k.columns[0])
      );
      const fallbackCols = profile.columns.filter(
        (c) => c.nullCount === 0 && !foundSingleCols.has(c.name)
      );

      if (fallbackCols.length > 0) {
        console.log(`[analyzeFile] Single-column fallback: checking ${fallbackCols.length} columns on staging`);
        const checks = fallbackCols.map(
          (c, i) => `COUNT(DISTINCT ${qid(c.name)}) = COUNT(*) AS fb_${i}`
        );
        try {
          const fbResult = await session.query<Record<string, unknown>>(
            `SELECT ${checks.join(", ")} FROM staging`
          );
          const row = fbResult[0] ?? {};
          let fallbackFound = 0;
          for (let i = 0; i < fallbackCols.length; i++) {
            if (row[`fb_${i}`] === true) {
              const col = fallbackCols[i];
              allFoundKeys.push({
                columns: [col.name],
                type: "single",
                verified: true,
                rowCount: profile.rowCount,
                quality: {
                  columnCount: 1,
                  totalNullCount: 0,
                  hasIdPattern: /id|key|code|number|sku|ref|num|no\b/i.test(col.name),
                  allColumnsNotNull: true,
                },
              });
              fallbackFound++;
            }
          }
          console.log(`[analyzeFile] Single-column fallback found ${fallbackFound} unique columns`);
        } catch (err) {
          console.error("[analyzeFile] Single-column fallback failed:", err instanceof Error ? err.message : err);
        }
      }

      // ── PASS 2: If nothing found, try normalized data ──
      // Normalization catches whitespace/case duplicates that hide uniqueness.
      if (allFoundKeys.length === 0) {
        console.log("[analyzeFile] PASS 2: No keys from original data. Building normalized table...");
        try {
          await buildNormalizedTable(session, profile);
          const normalizedProfile = await session.profileTable("staging_normalized");

          // UCC on normalized
          const normResult = await discoverUCCs(session, "staging_normalized", normalizedProfile);
          allFoundKeys.push(...normResult.uccs);
          console.log(`[analyzeFile] PASS 2 normalized UCC: ${normResult.uccs.length} keys found`);

          if (uccStats) {
            uccStats.queriesExecuted += normResult.stats.queriesExecuted;
            uccStats.totalDurationMs += normResult.stats.totalDurationMs;
          } else {
            uccStats = normResult.stats;
          }

          // Single-column fallback on normalized (catches case/whitespace issues)
          if (allFoundKeys.length === 0) {
            const normFallbackCols = normalizedProfile.columns.filter(
              (c) => c.nullCount === 0
            );
            if (normFallbackCols.length > 0) {
              const normChecks = normFallbackCols.map(
                (c, i) => `COUNT(DISTINCT ${qid(c.name)}) = COUNT(*) AS nfb_${i}`
              );
              const nfbResult = await session.query<Record<string, unknown>>(
                `SELECT ${normChecks.join(", ")} FROM staging_normalized`
              );
              const nfbRow = nfbResult[0] ?? {};
              for (let i = 0; i < normFallbackCols.length; i++) {
                if (nfbRow[`nfb_${i}`] === true) {
                  const col = normFallbackCols[i];
                  allFoundKeys.push({
                    columns: [col.name],
                    type: "single",
                    verified: true,
                    rowCount: normalizedProfile.rowCount,
                    quality: {
                      columnCount: 1,
                      totalNullCount: 0,
                      hasIdPattern: /id|key|code|number|sku|ref|num|no\b/i.test(col.name),
                      allColumnsNotNull: true,
                    },
                  });
                }
              }
              console.log(`[analyzeFile] PASS 2 normalized fallback: ${allFoundKeys.length} total keys`);
            }
          }
        } catch (err) {
          console.error("[analyzeFile] PASS 2 normalized analysis failed:", err instanceof Error ? err.message : err);
        }
      }

      // ── Thorough mode: no AI pruning, all columns as candidates ──
      const shouldBeThorough = options?.thorough || (allFoundKeys.length === 0 && profile.columns.length <= 100);
      if (shouldBeThorough && allFoundKeys.length === 0) {
        console.log(`[analyzeFile] Thorough mode: re-running UCC with skipPruning on staging (${profile.columns.length} columns)`);
        try {
          const thoroughResult = await discoverUCCs(session, "staging", profile, { skipPruning: true });
          allFoundKeys.push(...thoroughResult.uccs);
          console.log(`[analyzeFile] Thorough mode found ${thoroughResult.uccs.length} keys`);
          if (uccStats) {
            uccStats.queriesExecuted += thoroughResult.stats.queriesExecuted;
            uccStats.totalDurationMs += thoroughResult.stats.totalDurationMs;
          }
        } catch (err) {
          console.error("[analyzeFile] Thorough mode failed:", err instanceof Error ? err.message : err);
        }
      }
    }

    // Near-miss surfacing — show almost-unique columns when nothing perfect found
    const nearMisses: FullAnalysisResult["primaryKey"]["nearMisses"] = [];
    if (allFoundKeys.length === 0 && profile.rowCount > 1 && !options?.skipUCC) {
      const topCandidates = profile.columns
        .filter((c) => c.nullCount === 0 && c.uniquenessRatio >= 0.999)
        .sort((a, b) => b.uniquenessRatio - a.uniquenessRatio)
        .slice(0, 5);

      for (const col of topCandidates) {
        nearMisses.push({
          columns: [col.name],
          uniquenessRatio: col.uniquenessRatio,
          duplicateCount: profile.rowCount - col.distinctCount,
        });
      }
      if (nearMisses.length > 0) {
        console.log(`[analyzeFile] Near-misses: ${nearMisses.map(nm => `${nm.columns[0]} (${(nm.uniquenessRatio * 100).toFixed(1)}%)`).join(", ")}`);
      } else {
        console.log("[analyzeFile] No keys found, no near-misses either.");
      }
    }

    // Extract best PK from all passes
    const primaryKey = extractBestPK(allFoundKeys, nearMisses, profile.rowCount, uccStats);

    return buildFullResult({
      fileName, fileType, availableSheets, selectedSheet, options,
      profile, columns, previewRows, primaryKey,
    });
  } finally {
    await session.close();
  }
}

// ─── analyzeFile helpers ────────────────────────────

function qid(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function buildNormalizedTable(session: AnalyticsSession, profile: TableProfile): Promise<void> {
  const colExprs = profile.columns.map((c) => {
    const q = qid(c.name);
    if (c.duckdbType === "VARCHAR" || c.duckdbType.startsWith("VARCHAR")) {
      return `NULLIF(TRIM(LOWER(${q})), '') AS ${q}`;
    }
    return `${q} AS ${q}`;
  });

  await session.execute(
    `CREATE TABLE staging_normalized AS SELECT ${colExprs.join(", ")} FROM staging`
  );
}

function noPrimaryKey(totalRows: number): FullAnalysisResult["primaryKey"] {
  return {
    detected: false,
    column: null,
    compositeKey: null,
    confidence: "NONE",
    allKeys: [],
    nearMisses: [],
    stats: {
      totalRows,
      candidateColumns: 0,
      levelsSearched: 0,
      queriesExecuted: 0,
      durationMs: 0,
      timedOut: false,
    },
  };
}

function extractBestPK(
  allKeys: DiscoveredUCC[],
  nearMisses: FullAnalysisResult["primaryKey"]["nearMisses"],
  totalRows: number,
  uccStats: UCCStats | null
): FullAnalysisResult["primaryKey"] {
  const sorted = [...allKeys].sort((a, b) => {
    if (a.quality.columnCount !== b.quality.columnCount) return a.quality.columnCount - b.quality.columnCount;
    if (a.quality.allColumnsNotNull !== b.quality.allColumnsNotNull) return a.quality.allColumnsNotNull ? -1 : 1;
    if (a.quality.hasIdPattern !== b.quality.hasIdPattern) return a.quality.hasIdPattern ? -1 : 1;
    return a.quality.totalNullCount - b.quality.totalNullCount;
  });

  const best = sorted[0] ?? null;

  let confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE" = "NONE";
  if (best) {
    if (best.type === "single" && best.quality.allColumnsNotNull && best.quality.hasIdPattern) {
      confidence = "HIGH";
    } else if (best.type === "single" && best.quality.allColumnsNotNull) {
      confidence = "MEDIUM";
    } else if (best.type === "single") {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }
  } else if (nearMisses.length > 0) {
    confidence = "LOW";
  }

  return {
    detected: best !== null,
    column: best?.type === "single" ? best.columns[0] : null,
    compositeKey: best?.type === "composite" ? best.columns : null,
    confidence,
    allKeys: sorted.map((k) => ({
      columns: k.columns,
      type: k.type,
      quality: k.quality,
    })),
    nearMisses,
    stats: {
      totalRows,
      candidateColumns: uccStats?.candidateColumns ?? 0,
      levelsSearched: uccStats?.levelsSearched ?? 0,
      queriesExecuted: uccStats?.queriesExecuted ?? 0,
      durationMs: uccStats?.totalDurationMs ?? 0,
      timedOut: uccStats?.timedOut ?? false,
    },
  };
}

function buildFullResult(params: {
  fileName: string;
  fileType: "excel" | "csv" | "tsv";
  availableSheets?: string[];
  selectedSheet?: string;
  options?: { headerRow?: number; dataStartRow?: number };
  profile: TableProfile;
  columns: AnalyzedColumn[];
  previewRows: Record<string, unknown>[];
  primaryKey: FullAnalysisResult["primaryKey"];
}): FullAnalysisResult {
  const { fileName, fileType, availableSheets, selectedSheet, options, profile, columns, previewRows, primaryKey } = params;

  const schema: SchemaMapping = {
    columns: profile.columns.map((col: ColumnProfile) => ({
      jsonPath: col.name,
      columnName: col.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      dataType: toHermodType(col.duckdbType),
      nullable: col.nullCount > 0,
    })),
  };

  return {
    fileName,
    fileType,
    availableSheets,
    selectedSheet,
    headerRow: options?.headerRow ?? (fileType === "excel" ? 1 : undefined),
    dataStartRow: options?.dataStartRow ?? (fileType === "excel" ? 2 : undefined),
    rowCount: profile.rowCount,
    columns,
    profile,
    previewRows,
    primaryKey,
    schema,
  };
}
