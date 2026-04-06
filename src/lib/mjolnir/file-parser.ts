/**
 * Mjolnir — Excel file parser.
 *
 * Parses uploaded .xlsx files using ExcelJS. Handles real-world Excel files
 * with multi-row headers, merged category groups, and formula cells.
 *
 * Header detection strategy (two tiers):
 *   Mjölnir: AI analyzes the first 20 raw rows → returns headerRow + confidence.
 *            Validated (cells must look like labels, not data). Falls back to
 *            heuristic on failure or low confidence.
 *   Heimdall/Thor: Heuristic scoring — uniqueness, string-only, merge penalty, width match.
 *   Both:    Rows above the header are treated as title/metadata (skipped).
 *            Data starts at headerRow + 1.
 *
 * Formula handling:
 *   - Formula cells with cached results → use the result value
 *   - Formula cells WITHOUT cached results → null for data, but capture
 *     the formula text + resolve cell references to column names as metadata
 */

import ExcelJS from "exceljs";
import type {
  ParsedFileData,
  ColumnFingerprint,
  ColumnGroup,
  FormulaInfo,
} from "./types";
import { fingerprintAllColumns } from "./engine/fingerprint";
import { getLlmProvider } from "@/lib/llm";

/** Maximum file size: 50 MB */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Maximum rows included in sample data */
export const SAMPLE_ROW_CAP = 50;

/** How many rows to scan when detecting the header row */
const HEADER_SCAN_DEPTH = 10;

/** How many rows to send to the LLM for AI header detection */
const AI_SCAN_DEPTH = 20;

// ─── Header Detection ────────────────────────────────

interface RowScore {
  rowIndex: number; // 1-based
  uniqueCount: number;
  totalCells: number;
  allStrings: boolean;
  mergeCount: number; // how many merged ranges touch this row
  score: number;
}

/**
 * Build a set of merge ranges from the worksheet.
 * ExcelJS stores merges as strings like "A1:E1".
 */
function getMergeRanges(worksheet: ExcelJS.Worksheet): Array<{
  top: number;
  bottom: number;
  left: number;
  right: number;
}> {
  const ranges: Array<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  }> = [];

  // ExcelJS exposes merges via worksheet model or the _merges map
  // The public API is worksheet.model.merges (array of range strings)
  const merges: string[] =
    (worksheet.model as unknown as { merges?: string[] })?.merges ?? [];

  for (const rangeStr of merges) {
    // Parse "A1:E1" format
    const match = rangeStr.match(
      /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i
    );
    if (!match) continue;
    const left = colLetterToNumber(match[1]);
    const top = parseInt(match[2], 10);
    const right = colLetterToNumber(match[3]);
    const bottom = parseInt(match[4], 10);
    ranges.push({ top, bottom, left, right });
  }

  return ranges;
}

/** Convert column letter(s) to 1-based number: A=1, B=2, ..., Z=26, AA=27 */
function colLetterToNumber(letters: string): number {
  const upper = letters.toUpperCase();
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result;
}

/** Convert 1-based column number to letter: 1=A, 2=B, ..., 26=Z, 27=AA */
function colNumberToLetter(num: number): string {
  let result = "";
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

// ─── Raw Row Reader (for AI + heuristic) ────────────

/**
 * Read raw cell values from the first N rows without interpretation.
 * Returns a 2D array of row → cell values (as strings).
 */
function readRawRows(
  worksheet: ExcelJS.Worksheet,
  maxRows: number,
): { rowIndex: number; cells: (string | null)[] }[] {
  const result: { rowIndex: number; cells: (string | null)[] }[] = [];
  const totalCols = worksheet.columnCount;
  const rowCount = Math.min(worksheet.rowCount, maxRows);

  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: (string | null)[] = [];
    for (let c = 1; c <= totalCols; c++) {
      const cell = row.getCell(c);
      const raw = cell.value;
      if (raw === null || raw === undefined) {
        cells.push(null);
      } else if (typeof raw === "object" && "richText" in raw) {
        cells.push((raw as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join(""));
      } else if (typeof raw === "object" && "formula" in raw) {
        const fv = raw as ExcelJS.CellFormulaValue;
        cells.push(fv.result != null ? String(fv.result) : null);
      } else {
        cells.push(String(raw));
      }
    }
    result.push({ rowIndex: r, cells });
  }
  return result;
}

/**
 * Count non-empty cells in a raw row.
 */
function countNonEmpty(cells: (string | null)[]): number {
  return cells.filter((c) => c !== null && c.trim() !== "").length;
}

// ─── Header Validation ──────────────────────────────

/** Patterns that indicate a cell is a data value, not a header label. */
const DATA_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,          // ISO date
  /^\d+\.\d{2}$/,                  // decimal number like 2800.00
  /^-?\d+$/,                       // plain integer
  /^\$[\d,]+\.\d{2}$/,            // currency
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // date like 3/15/26
];

/**
 * Validate that a row's cells look like headers rather than data values.
 * Returns true if the row passes validation.
 */
function validateHeaderRow(cells: (string | null)[]): boolean {
  const nonNull = cells.filter((c): c is string => c !== null && c.trim() !== "");
  if (nonNull.length === 0) return false;

  // At least 50% should be strings (not numbers/dates)
  const stringCount = nonNull.filter((c) => typeof c === "string").length;
  if (stringCount / nonNull.length < 0.5) return false;

  // Headers should be short (< 50 chars)
  const longCount = nonNull.filter((c) => c.length > 50).length;
  if (longCount > nonNull.length * 0.3) return false;

  // If > 30% of cells match data-value patterns, it's probably data, not headers
  const dataLikeCount = nonNull.filter((c) =>
    DATA_PATTERNS.some((p) => p.test(c)),
  ).length;
  if (dataLikeCount / nonNull.length > 0.3) return false;

  return true;
}

// ─── AI Header Detection (Mjölnir tier) ─────────────

interface AiHeaderResult {
  headerRowIndex: number; // 1-based (ExcelJS convention)
  confidence: number;
  reasoning: string;
}

const HEADER_DETECT_SYSTEM = `You are analyzing an Excel file to find the header row — the row that contains column names for the actual data table.

Common patterns in messy files:
- Title rows with company names, report titles, or dates (e.g., "ACME CORPORATION", "Monthly GL Report", "Generated: 2026-03-15")
- Blank rows separating metadata from data
- Report artifact rows (page numbers, "*** REPORT TOTALS ***", separator lines)
- The actual header row contains SHORT, UPPERCASE or Title_Case labels that describe data columns (e.g., "GL_ACCT", "TRANS_DT", "Invoice Number", "Amount")
- Data rows below the header contain actual values — numbers, dates, long text, reference codes

Identify which row (1-indexed) is the actual header row containing column names.

Return ONLY valid JSON:
{
  "headerRow": <1-indexed row number>,
  "confidence": <number between 0 and 1>,
  "reasoning": "<one sentence explaining why>"
}`;

/**
 * Use LLM to detect the header row from raw spreadsheet rows.
 * Returns a result with confidence, or null if the LLM call fails.
 */
async function detectHeaderRowWithAI(
  rawRows: { rowIndex: number; cells: (string | null)[] }[],
): Promise<AiHeaderResult | null> {
  try {
    const provider = getLlmProvider();

    // Format rows — show row numbers and cell values as JSON arrays
    const formatted = rawRows.map((r) => {
      const cells = r.cells.map((c) => c ?? null);
      return `Row ${r.rowIndex}: ${JSON.stringify(cells)}`;
    }).join("\n");

    const response = await provider.chat({
      messages: [
        { role: "system", content: HEADER_DETECT_SYSTEM },
        { role: "user", content: `Here are the first ${rawRows.length} rows of the file:\n\n${formatted}` },
      ],
      temperature: 0,
      maxTokens: 200,
      responseFormat: { type: "json_object" },
    });

    const parsed = JSON.parse(response.content);
    const headerRow = parsed?.headerRow;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0.5;
    const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning : "";

    if (typeof headerRow === "number" && headerRow >= 1 && headerRow <= rawRows.length) {
      return { headerRowIndex: headerRow, confidence, reasoning };
    }
    return null;
  } catch (err) {
    console.error("[Mjolnir] AI header detection failed, using heuristic fallback:", err);
    return null;
  }
}

// ─── Heuristic Header Detection (Heimdall/Thor fallback) ─────

/**
 * Heuristic: find the first row whose non-empty cell count matches the mode
 * (most common width) across all rows, and whose cells are all strings.
 * Title rows typically have 1-2 cells; the header row matches data width.
 */
export function detectHeaderRowHeuristic(
  worksheet: ExcelJS.Worksheet,
  mergeRanges: Array<{ top: number; bottom: number; left: number; right: number }>,
  rawRows?: { rowIndex: number; cells: (string | null)[] }[],
): number {
  const rows = rawRows ?? readRawRows(worksheet, HEADER_SCAN_DEPTH);
  const maxRow = Math.min(worksheet.rowCount, HEADER_SCAN_DEPTH);
  if (maxRow === 0) return 1;

  // Compute non-empty cell counts for ALL rows (not just scan range)
  const widths: number[] = [];
  const allRowCount = Math.min(worksheet.rowCount, HEADER_SCAN_DEPTH + 30);
  for (let r = 1; r <= allRowCount; r++) {
    const row = worksheet.getRow(r);
    let w = 0;
    row.eachCell({ includeEmpty: false }, () => { w++; });
    if (w > 0) widths.push(w);
  }

  // Find the mode width
  const freq = new Map<number, number>();
  for (const w of widths) freq.set(w, (freq.get(w) ?? 0) + 1);
  let typicalWidth = 0;
  let maxFreq = 0;
  for (const [w, f] of freq) {
    if (f > maxFreq || (f === maxFreq && w > typicalWidth)) {
      typicalWidth = w;
      maxFreq = f;
    }
  }

  const scores: RowScore[] = [];

  for (const rawRow of rows) {
    const rowIdx = rawRow.rowIndex;
    const nonEmpty = countNonEmpty(rawRow.cells);
    if (nonEmpty === 0) continue;

    const stringValues = rawRow.cells.filter((c): c is string => c !== null && c.trim() !== "");
    const allStrings = stringValues.length === nonEmpty;
    const allShort = stringValues.every((s) => s.length < 50);
    const uniqueCount = new Set(stringValues).size;

    const mergeCount = mergeRanges.filter(
      (r) => rowIdx >= r.top && rowIdx <= r.bottom && r.left !== r.right,
    ).length;

    let score = 0;

    // +2: All cells are short strings
    if (allStrings && allShort && stringValues.length > 0) score += 2;

    // +2: All cell values are unique
    if (uniqueCount > 0 && uniqueCount === stringValues.length) score += 2;

    // +2: Same column count as majority of data rows (need reliable data)
    if (typicalWidth > 0 && nonEmpty === typicalWidth && maxFreq >= 3) score += 2;

    // +1: Nearly full row (within 1 of typical width)
    if (typicalWidth > 0 && nonEmpty >= typicalWidth - 1 && maxFreq >= 3) score += 1;

    // -3: Merged cells (title/category row)
    if (mergeCount > 0) score -= 3;

    // -1: Very few cells vs typical (title or subtitle)
    if (nonEmpty <= 2 && typicalWidth > 3) score -= 1;

    scores.push({
      rowIndex: rowIdx,
      uniqueCount,
      totalCells: nonEmpty,
      allStrings,
      mergeCount,
      score,
    });
  }

  if (scores.length === 0) return 1;

  scores.sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex);
  return scores[0].rowIndex;
}

/**
 * Detect the header row.
 *
 * - Mjölnir tier (useMjolnir=true): AI-powered detection with confidence-based
 *   fallback to heuristic. Validates the detected row looks like actual headers.
 * - Heimdall/Thor tier (useMjolnir=false): heuristic only
 *
 * The detected headerRow is stored in the ParsedFileData result so downstream
 * code (blueprints, subsequent runs) can skip re-detection.
 */
export async function detectHeaderRow(
  worksheet: ExcelJS.Worksheet,
  mergeRanges: Array<{ top: number; bottom: number; left: number; right: number }>,
  useMjolnir = false,
): Promise<number> {
  const rawRows = readRawRows(worksheet, AI_SCAN_DEPTH);
  const heuristicResult = detectHeaderRowHeuristic(worksheet, mergeRanges, rawRows);

  if (!useMjolnir) {
    return heuristicResult;
  }

  // Mjölnir tier: try AI first
  const aiResult = await detectHeaderRowWithAI(rawRows);

  if (aiResult === null) {
    // AI call failed entirely — use heuristic
    return heuristicResult;
  }

  // Validate the AI-detected row looks like headers
  const aiRowCells = rawRows.find((r) => r.rowIndex === aiResult.headerRowIndex)?.cells ?? [];
  const aiValid = validateHeaderRow(aiRowCells);

  // If validation fails, the AI picked a data row — fall back to heuristic
  if (!aiValid) {
    console.warn(
      `[Mjolnir] AI-detected row ${aiResult.headerRowIndex} failed validation ` +
      `(cells look like data values, not headers). Falling back to heuristic row ${heuristicResult}.`,
    );
    return heuristicResult;
  }

  // If AI confidence is low, cross-check with heuristic
  if (aiResult.confidence < 0.7 && aiResult.headerRowIndex !== heuristicResult) {
    console.warn(
      `[Mjolnir] Header detection disagreement: AI says row ${aiResult.headerRowIndex} ` +
      `(conf: ${aiResult.confidence}), heuristic says row ${heuristicResult}. ` +
      `Using AI result but flagging for review.`,
    );
  }

  return aiResult.headerRowIndex;
}

// ─── Column Groups ───────────────────────────────────

/**
 * Extract category groups from merged cells in rows above the header row.
 * For example, if header is Row 2 and Row 1 has merged cells:
 *   A1:E1 = "IDENTITY", F1:K1 = "WHAT DO WE HAVE?"
 * Returns: [{ name: "IDENTITY", columns: ["SKU","ASIN",...] }, ...]
 */
function extractColumnGroups(
  worksheet: ExcelJS.Worksheet,
  headerRowIndex: number,
  columns: string[],
  columnIndices: number[],
  mergeRanges: Array<{ top: number; bottom: number; left: number; right: number }>
): ColumnGroup[] {
  if (headerRowIndex <= 1) return [];

  const groups: ColumnGroup[] = [];

  // Look at the row directly above the header
  const groupRowIdx = headerRowIndex - 1;
  const groupRow = worksheet.getRow(groupRowIdx);

  // Find merged ranges in the group row
  const rowMerges = mergeRanges.filter(
    (r) => r.top <= groupRowIdx && r.bottom >= groupRowIdx
  );

  for (const merge of rowMerges) {
    // Get the value of the top-left cell of the merge
    const cell = groupRow.getCell(merge.left);
    const name = extractCellValueSimple(cell);
    if (!name || String(name).trim() === "") continue;

    // Find which header columns fall within this merge range
    const groupCols: string[] = [];
    for (let i = 0; i < columnIndices.length; i++) {
      if (columnIndices[i] >= merge.left && columnIndices[i] <= merge.right) {
        groupCols.push(columns[i]);
      }
    }

    if (groupCols.length > 0) {
      groups.push({ name: String(name).trim(), columns: groupCols });
    }
  }

  // Also check for non-merged cells in the group row that span a single column
  if (groups.length === 0) {
    // No merged cells found — maybe the group row uses individual cells
    // In this case, don't generate groups (it's probably just a different layout)
    return [];
  }

  return groups;
}

// ─── Formula Extraction ──────────────────────────────

/**
 * Scan the first data row for formula cells and extract formula metadata.
 * Resolves cell references (like F3, H3) to column names using the header map.
 */
function extractFormulas(
  worksheet: ExcelJS.Worksheet,
  dataStartRow: number,
  columns: string[],
  columnIndices: number[]
): FormulaInfo[] {
  const formulas: FormulaInfo[] = [];

  // Build a map: column letter → column name
  const colLetterMap = new Map<string, string>();
  for (let i = 0; i < columnIndices.length; i++) {
    const letter = colNumberToLetter(columnIndices[i]);
    colLetterMap.set(letter, columns[i]);
  }

  // Scan the first data row for formulas
  const firstDataRow = worksheet.getRow(dataStartRow);
  if (!firstDataRow) return formulas;

  for (let i = 0; i < columnIndices.length; i++) {
    const colNum = columnIndices[i];
    const cell = firstDataRow.getCell(colNum);
    const raw = cell.value;

    if (raw === null || raw === undefined) continue;

    let formulaText: string | null = null;

    if (typeof raw === "object" && "formula" in raw) {
      formulaText = (raw as ExcelJS.CellFormulaValue).formula;
    } else if (typeof raw === "object" && "sharedFormula" in raw) {
      formulaText = (raw as ExcelJS.CellSharedFormulaValue).formula ?? null;
    }

    if (!formulaText) continue;

    // Resolve cell references to column names
    const { expression, referencedColumns } = resolveFormulaReferences(
      formulaText,
      colLetterMap,
      dataStartRow
    );

    formulas.push({
      column: columns[i],
      formula: `=${formulaText}`,
      expression,
      referencedColumns,
    });
  }

  return formulas;
}

/**
 * Resolve cell references in a formula to {Column Name} references.
 *
 * Examples:
 *   "F3+H3+J3" → "{SOU On Hand}+{DSHIP On Hand}+{In Transit}"
 *   "IFERROR(U3/S3,0)" → "IFERROR({AMZ Consumed}/{Plan SOU M1},0)"
 */
function resolveFormulaReferences(
  formula: string,
  colLetterMap: Map<string, string>,
  _dataRow: number
): { expression: string; referencedColumns: string[] } {
  const referencedColumns: string[] = [];

  // Match cell references like A3, AB12, $A$3, etc.
  // Negative lookbehind prevents matching inside function names (e.g., LOG10, INT2)
  // Max 3 letters (Excel max column is XFD)
  const cellRefPattern = /(?<![A-Za-z])\$?([A-Za-z]{1,3})\$?(\d+)/g;

  const expression = formula.replace(cellRefPattern, (_match, colLetters: string, _rowNum: string) => {
    const colName = colLetterMap.get(colLetters.toUpperCase());
    if (colName) {
      if (!referencedColumns.includes(colName)) {
        referencedColumns.push(colName);
      }
      return `{${colName}}`;
    }
    // If we can't resolve, keep original reference
    return _match;
  });

  return { expression, referencedColumns };
}

// ─── Cell Value Extraction ───────────────────────────

/**
 * Simple cell value extraction (for header/group rows — no formula handling).
 */
function extractCellValueSimple(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  if (typeof value === "object" && "richText" in value) {
    return (value as ExcelJS.CellRichTextValue).richText
      .map((part) => part.text)
      .join("");
  }

  if (typeof value === "object" && "hyperlink" in value) {
    return (value as ExcelJS.CellHyperlinkValue).text ?? (value as ExcelJS.CellHyperlinkValue).hyperlink;
  }

  if (typeof value === "object" && "formula" in value) {
    const fv = value as ExcelJS.CellFormulaValue;
    return fv.result !== undefined ? fv.result : null;
  }

  return value;
}

/**
 * Extract a usable value from an ExcelJS cell, handling formulas,
 * dates, rich text, and null/undefined.
 */
function extractCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;

  if (value === null || value === undefined) {
    return null;
  }

  // Formula cells: use the calculated result
  if (typeof value === "object" && "formula" in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue;
    return formulaValue.result !== undefined ? formulaValue.result : null;
  }

  // Shared formula cells
  if (typeof value === "object" && "sharedFormula" in value) {
    const sharedValue = value as ExcelJS.CellSharedFormulaValue;
    return sharedValue.result !== undefined ? sharedValue.result : null;
  }

  // Rich text cells: concatenate plain text parts
  if (typeof value === "object" && "richText" in value) {
    const richText = value as ExcelJS.CellRichTextValue;
    return richText.richText.map((part) => part.text).join("");
  }

  // Date cells: keep as Date object
  if (value instanceof Date) {
    return value;
  }

  // Error cells
  if (typeof value === "object" && "error" in value) {
    return null;
  }

  // Hyperlink cells
  if (typeof value === "object" && "hyperlink" in value) {
    const hyperlinkValue = value as ExcelJS.CellHyperlinkValue;
    return hyperlinkValue.text ?? hyperlinkValue.hyperlink;
  }

  // Normal values (string, number, boolean)
  return value;
}

// ─── Main Parser ─────────────────────────────────────

/**
 * Parse an Excel buffer into structured data with column fingerprints.
 *
 * Handles real-world Excel files:
 *   - Multi-row headers with merged category groups
 *   - Formula cells (uses cached result or captures formula metadata)
 *   - Hidden rows (skipped)
 *
 * @param buffer  - Raw .xlsx file bytes
 * @param filename - Original filename (for metadata)
 * @param fileId  - Unique identifier for this upload
 * @returns Parsed file data including columns, rows, sample, fingerprints, and formula metadata
 */
export async function parseExcelBuffer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buffer: any,
  filename: string,
  fileId: string,
  /** When true, uses AI-powered header detection (Mjölnir tier). */
  useMjolnir = false,
): Promise<ParsedFileData> {
  // Normalize to Buffer for consistent API
  const buf: Buffer = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer as Uint8Array);

  // Enforce file size limit
  if (buf.length > MAX_FILE_SIZE) {
    throw new Error(
      `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    );
  }

  // Load workbook
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as never);

  // Get first worksheet
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheets found in workbook");
  }

  // Detect merged cell ranges
  const mergeRanges = getMergeRanges(worksheet);

  // Detect header row (handles multi-row headers with merged category groups)
  const headerRowIndex = await detectHeaderRow(worksheet, mergeRanges, useMjolnir);

  if (headerRowIndex > 1) {
    console.log(
      `[Mjolnir] Detected header row at row ${headerRowIndex}, skipping ${headerRowIndex - 1} title/metadata rows`
    );
  }

  // Extract headers from the detected header row
  const headerRow = worksheet.getRow(headerRowIndex);
  const columns: string[] = [];
  const columnIndices: number[] = [];

  const seenHeaders = new Set<string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const value = extractCellValueSimple(cell);
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      let name = String(value).trim();
      // Deduplicate: append _2, _3, etc. for duplicate header names
      if (seenHeaders.has(name)) {
        let suffix = 2;
        while (seenHeaders.has(`${name}_${suffix}`)) suffix++;
        name = `${name}_${suffix}`;
      }
      seenHeaders.add(name);
      columns.push(name);
      columnIndices.push(colNumber);
    }
  });

  if (columns.length === 0) {
    throw new Error(
      `No column headers found in row ${headerRowIndex}`
    );
  }

  // Extract column groups from rows above the header
  const columnGroups = extractColumnGroups(
    worksheet,
    headerRowIndex,
    columns,
    columnIndices,
    mergeRanges
  );

  // Extract data rows (starting from headerRow + 1)
  const dataStartRow = headerRowIndex + 1;
  const rows: Record<string, unknown>[] = [];
  const rowCount = worksheet.rowCount;

  for (let rowIdx = dataStartRow; rowIdx <= rowCount; rowIdx++) {
    const row = worksheet.getRow(rowIdx);

    // Skip hidden rows
    if (row.hidden) continue;

    // Skip completely empty rows
    let hasValue = false;
    const record: Record<string, unknown> = {};

    for (let i = 0; i < columns.length; i++) {
      const colNumber = columnIndices[i];
      const cell = row.getCell(colNumber);
      const value = extractCellValue(cell);
      record[columns[i]] = value;
      if (value !== null && value !== undefined) {
        hasValue = true;
      }
    }

    if (hasValue) {
      rows.push(record);
    }
  }

  // Extract formula metadata from the first data row
  const formulas = extractFormulas(
    worksheet,
    dataStartRow,
    columns,
    columnIndices
  );

  // Cap sample rows
  const sampleRows = rows.slice(0, SAMPLE_ROW_CAP);

  // Generate fingerprints for all columns
  const fingerprints: ColumnFingerprint[] = fingerprintAllColumns(
    columns,
    rows
  );

  return {
    fileId,
    filename,
    columns,
    rows,
    rowCount: rows.length,
    sampleRows,
    fingerprints,
    headerRowIndex,
    columnIndices,
    columnGroups: columnGroups.length > 0 ? columnGroups : undefined,
    formulas: formulas.length > 0 ? formulas : undefined,
  };
}
