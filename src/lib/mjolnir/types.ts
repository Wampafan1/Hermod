/**
 * Mjolnir — Types for the deterministic forge engine.
 *
 * Covers forge steps, column fingerprinting, structural diff results,
 * parsed file data, and blueprint data structures.
 */

// ─── Forge Step Types ────────────────────────────────

export type ForgeStepType =
  | "remove_columns"
  | "rename_columns"
  | "reorder_columns"
  | "filter_rows"
  | "format"
  | "calculate"
  | "sort"
  | "deduplicate"
  | "aggregate"
  | "split_column"
  | "merge_columns"
  | "lookup"
  | "pivot"
  | "unpivot"
  | "custom_sql";

export interface ForgeStep {
  stepId?: string;   // Stable identity for version diffing — assigned once, never changes
  order: number;
  type: ForgeStepType;
  confidence: number; // 0.0–1.0
  config: Record<string, unknown>;
  description: string;
}

/** ForgeStep with guaranteed stepId — used after ensureStepIds() processing */
export interface VersionedForgeStep extends ForgeStep {
  stepId: string;
}

// ─── Step Metrics ───────────────────────────────────

/** Metrics collected for a single step during blueprint execution. */
export interface StepMetric {
  order: number;
  type: ForgeStepType;
  durationMs: number;
  rowsIn: number;
  rowsOut: number;
  columnsIn: number;
  columnsOut: number;
}

// ─── Column Fingerprint ──────────────────────────────

export type InferredDataType =
  | "string"
  | "number"
  | "date"
  | "boolean"
  | "mixed"
  | "empty";

export interface ColumnFingerprint {
  name: string;
  dataType: InferredDataType;
  nullRate: number; // 0.0–1.0
  cardinality: number; // unique value count
  sampleHash: string; // SHA-256 of sorted unique values
  minValue?: string | number;
  maxValue?: string | number;
  avgLength?: number; // for strings
  datePattern?: string; // detected date format pattern
  topValues?: Array<{ value: string; count: number }>; // top 10 most frequent (low-cardinality only)
}

// ─── Structural Diff ─────────────────────────────────

export interface ColumnMatch {
  beforeColumn: string;
  afterColumn: string;
  matchType: "exact" | "case_insensitive" | "normalized" | "levenshtein" | "fingerprint" | "loose_fingerprint" | "value_overlap";
  confidence: number;
}

export interface FormatChange {
  column: string;
  changeType:
    | "case"
    | "trim"
    | "date_format"
    | "number_format"
    | "whitespace";
  beforeSample: string;
  afterSample: string;
}

export interface AmbiguousCase {
  type:
    | "new_column"
    | "removed_rows"
    | "uncertain_match"
    | "complex_transform"
    | "formula_inference";
  description: string;
  context: Record<string, unknown>;
}

export interface StructuralDiffResult {
  // Column analysis
  matchedColumns: ColumnMatch[];
  removedColumns: string[]; // in BEFORE only
  addedColumns: string[]; // in AFTER only

  // Row analysis
  beforeRowCount: number;
  afterRowCount: number;
  removedRowCount: number;

  // Detected transformations
  sortDetected?: { column: string; direction: "asc" | "desc" };
  formatChanges: FormatChange[];
  reorderDetected: boolean;

  // High-confidence steps (deterministic)
  deterministicSteps: ForgeStep[];

  // Cases needing AI
  ambiguousCases: AmbiguousCase[];
}

// ─── Parsed File Data ────────────────────────────────

/** Category group from merged cells above the header row */
export interface ColumnGroup {
  name: string;
  columns: string[]; // column names belonging to this group
}

/** Formula metadata extracted from a data column */
export interface FormulaInfo {
  column: string; // column name this formula produces
  formula: string; // raw Excel formula (e.g. "=F3+H3+J3")
  expression: string; // translated to {Column Name} refs (e.g. "{SOU On Hand}+{DSHIP On Hand}+{In Transit}")
  referencedColumns: string[]; // resolved column names
}

export interface ParsedFileData {
  fileId: string;
  filename: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  sampleRows: Record<string, unknown>[]; // first 50
  fingerprints: ColumnFingerprint[];
  headerRowIndex: number; // which row was detected as the header (1-based)
  columnIndices: number[]; // actual 1-based Excel column positions
  columnGroups?: ColumnGroup[]; // optional merged-cell category groups
  formulas?: FormulaInfo[]; // formulas detected in data columns
}

// ─── Blueprint Formatting ────────────────────────────

/** Captured cell style from an Excel workbook. */
export interface CapturedCellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    name?: string;
    color?: string; // ARGB hex (e.g. "FF404040")
    underline?: boolean;
    strike?: boolean;
  };
  fill?: string; // ARGB hex for solid fill (e.g. "FFD9E1F2"), null = no fill
  alignment?: {
    horizontal?: string; // "left" | "center" | "right"
    vertical?: string;   // "top" | "middle" | "bottom"
    wrapText?: boolean;
  };
  border?: Record<string, { style: string; color?: string }>;
  numFmt?: string;
}

/**
 * Full formatting snapshot captured from an AFTER workbook.
 * Stored in Blueprint.afterFormatting and applied during Excel generation
 * to produce a pixel-perfect mirror of the original AFTER file.
 */
export interface BlueprintFormatting {
  /** How many rows in the header area (before data starts). 1 = just column headers, 2 = group row + headers, etc. */
  headerRowCount: number;
  /** Column widths in Excel character units (0-indexed) */
  columnWidths: number[];
  /** Row heights in points for header area rows (0-indexed) */
  headerRowHeights: number[];
  /** Cell styles for the header area — keyed by "row:col" (0-indexed) */
  headerStyles: Record<string, CapturedCellStyle>;
  /** Cell values in the header area — keyed by "row:col" (0-indexed). For merged group headers etc. */
  headerValues: Record<string, string | number | null>;
  /** Template style for data rows — keyed by column index (0-indexed). First data row's style. */
  dataRowStyles: Record<number, CapturedCellStyle>;
  /** Data row height in points (from first data row) */
  dataRowHeight?: number;
  /** Merged cell ranges in header area (0-indexed) */
  merges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  /** Freeze pane position (1-based row/col for ExcelJS) */
  freeze?: { row: number; col: number };
  /** Column names as they appear in the AFTER file header row */
  columns: string[];
}

// ─── Blueprint Data ──────────────────────────────────

export interface BlueprintData {
  steps: ForgeStep[];
  sourceSchema: {
    columns: string[];
    types: Record<string, InferredDataType>;
  } | null;
  analysisLog: StructuralDiffResult | null;
}
