/**
 * AI Sheet Analyzer — Uses LLM to analyze raw spreadsheet structure,
 * column types, date formats, and primary keys.
 */

import type { LlmMessage } from "@/lib/llm/types";
import { getLlmProvider } from "@/lib/llm";

// ─── Types ──────────────────────────────────────────

export interface AIColumnAnalysis {
  index: number;
  suggestedName: string;
  dataType: "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "TIMESTAMP" | "JSON";
  dateFormat?: string;
  nullable: boolean;
  shouldInclude: boolean;
  notes?: string;
}

export interface AISheetAnalysisResult {
  hasHeaders: boolean;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number | null;
  skipRows: number[];
  columns: AIColumnAnalysis[];
  primaryKey: {
    columns: string[];
    type: "single" | "composite" | "synthetic";
    confidence: "high" | "medium" | "low";
    reason: string;
  };
  observations: string[];
  confidence: "high" | "medium" | "low";
}

// ─── Constants ──────────────────────────────────────

const MAX_SAMPLE_ROWS = 50;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 4000;

const VALID_DATA_TYPES = new Set(["STRING", "INTEGER", "FLOAT", "BOOLEAN", "TIMESTAMP", "JSON"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_PK_TYPE = new Set(["single", "composite", "synthetic"]);

// ─── System Prompt ──────────────────────────────────

const SYSTEM_PROMPT = `You are a data engineering assistant analyzing a raw spreadsheet.

Given the first rows of a file (raw values, no interpretation), determine:

1. STRUCTURE DETECTION:
   - Does the file have headers? Which row are they on?
   - Where does the actual data start? (skip title rows, blank rows, report headers)
   - Where does the data end? (detect summary/subtotal rows at the bottom)
   - Which specific rows should be skipped? (section dividers, notes, metadata)

2. COLUMN ANALYSIS (for each column):
   - What data type is it? Infer from ACTUAL VALUES, not just column names.
   - If it's a date/timestamp, what FORMAT is it in?
   - Is it nullable (any empty cells in the sample)?
   - Should it be included or skipped (empty columns, row-number columns)?
   - Any notes about the column (currency values, encoded IDs, etc.)

3. PRIMARY KEY DETECTION:
   - Find the column or MINIMUM combination of columns that uniquely identifies each row
   - Test single columns first (especially columns with "id" in the name)
   - If no single column is unique, find the smallest combination that is
   - Report confidence: high if clearly unique, medium if probably unique, low if uncertain

DETECTION RULES:
- Title/metadata rows: Usually rows 1-3, contain company name, report title, date range, or have only 1-2 non-empty cells
- Header rows: Short text labels, usually all strings, mostly unique values, no numbers
- Subtotal rows: Contain "Total", "Subtotal", "Sum", "Grand Total", or have values that are clearly sums of the column above
- Empty rows used as section dividers: skip them

DATE FORMAT DETECTION — look at actual values:
- "3/15/2026" or "03/15/2026" → M/D/YYYY (US format)
- "15/3/2026" or "15/03/2026" → D/M/YYYY (EU format)
- "2026-03-15" → YYYY-MM-DD (ISO format)
- "15-Mar-2026" or "Mar 15, 2026" → DD-MMM-YYYY or MMM DD, YYYY
- Large integers > 1000000000 → Unix timestamp (seconds if 10 digits, milliseconds if 13 digits)
- CRITICAL: If day value is ≤ 12 in ALL samples, you CANNOT distinguish US from EU format. Flag this ambiguity in notes and default to M/D/YYYY with a warning.

DATA TYPE DETECTION — infer from values:
- All integers (no decimals) → INTEGER
- Numbers with decimal points → FLOAT
- "true"/"false"/"yes"/"no"/"Y"/"N"/"1"/"0" → BOOLEAN
- Values matching any date pattern above → TIMESTAMP (specify the format)
- Everything else → STRING
- Mixed types in the same column → STRING (note the inconsistency)
- Column is entirely empty → shouldInclude: false

Return ONLY valid JSON matching this structure. No markdown, no backticks, no explanation outside the JSON.

{
  "hasHeaders": boolean,
  "headerRow": number,
  "dataStartRow": number,
  "dataEndRow": number | null,
  "skipRows": number[],
  "columns": [{ "index": number, "suggestedName": string, "dataType": string, "dateFormat": string?, "nullable": boolean, "shouldInclude": boolean, "notes": string? }],
  "primaryKey": { "columns": string[], "type": "single"|"composite"|"synthetic", "confidence": "high"|"medium"|"low", "reason": string },
  "observations": string[],
  "confidence": "high"|"medium"|"low"
}`;

// ─── User Prompt Builder ────────────────────────────

function buildUserPrompt(input: {
  rawRows: (string | number | boolean | null)[][];
  filename: string;
  sheetName?: string;
  totalRows: number;
  totalColumns: number;
}): string {
  const { rawRows, filename, sheetName, totalRows, totalColumns } = input;
  const sampleRows = rawRows.slice(0, MAX_SAMPLE_ROWS);

  const lines: string[] = [];
  lines.push(`File: ${filename}${sheetName ? ` (Sheet: "${sheetName}")` : ""}`);
  lines.push(`Total: ${totalRows} rows x ${totalColumns} columns`);
  lines.push(`\nFirst ${sampleRows.length} rows (raw values):\n`);

  for (let i = 0; i < sampleRows.length; i++) {
    const cells = sampleRows[i].map((cell) => {
      if (cell === null || cell === undefined) return "(empty)";
      return String(cell);
    });
    lines.push(`Row ${i + 1}: ${JSON.stringify(cells)}`);
  }

  return lines.join("\n");
}

// ─── Response Validation ────────────────────────────

function validateAndNormalize(raw: Record<string, unknown>): AISheetAnalysisResult {
  const hasHeaders = typeof raw.hasHeaders === "boolean" ? raw.hasHeaders : true;
  const headerRow = typeof raw.headerRow === "number" && raw.headerRow > 0 ? raw.headerRow : 1;
  const dataStartRow =
    typeof raw.dataStartRow === "number" && raw.dataStartRow > 0
      ? raw.dataStartRow
      : headerRow + 1;
  const dataEndRow =
    typeof raw.dataEndRow === "number" && raw.dataEndRow > 0 ? raw.dataEndRow : null;
  const skipRows = Array.isArray(raw.skipRows)
    ? raw.skipRows.filter((n): n is number => typeof n === "number")
    : [];

  const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
  const columns: AIColumnAnalysis[] = rawColumns.map(
    (col: Record<string, unknown>, i: number) => ({
      index: typeof col.index === "number" ? col.index : i,
      suggestedName:
        typeof col.suggestedName === "string" && col.suggestedName.trim()
          ? col.suggestedName.trim()
          : `column_${i + 1}`,
      dataType: VALID_DATA_TYPES.has(col.dataType as string)
        ? (col.dataType as AIColumnAnalysis["dataType"])
        : "STRING",
      dateFormat: typeof col.dateFormat === "string" ? col.dateFormat : undefined,
      nullable: typeof col.nullable === "boolean" ? col.nullable : true,
      shouldInclude: typeof col.shouldInclude === "boolean" ? col.shouldInclude : true,
      notes: typeof col.notes === "string" ? col.notes : undefined,
    })
  );

  const rawPk = (raw.primaryKey ?? {}) as Record<string, unknown>;
  const pkColumns = Array.isArray(rawPk.columns)
    ? rawPk.columns.filter((c): c is string => typeof c === "string")
    : [];
  const primaryKey = {
    columns: pkColumns,
    type: VALID_PK_TYPE.has(rawPk.type as string)
      ? (rawPk.type as "single" | "composite" | "synthetic")
      : pkColumns.length === 1
        ? ("single" as const)
        : pkColumns.length > 1
          ? ("composite" as const)
          : ("synthetic" as const),
    confidence: VALID_CONFIDENCE.has(rawPk.confidence as string)
      ? (rawPk.confidence as "high" | "medium" | "low")
      : "medium",
    reason: typeof rawPk.reason === "string" ? rawPk.reason : "AI analysis",
  };

  const observations = Array.isArray(raw.observations)
    ? raw.observations.filter((o): o is string => typeof o === "string")
    : [];

  const confidence = VALID_CONFIDENCE.has(raw.confidence as string)
    ? (raw.confidence as "high" | "medium" | "low")
    : "medium";

  return {
    hasHeaders,
    headerRow,
    dataStartRow,
    dataEndRow,
    skipRows,
    columns,
    primaryKey,
    observations,
    confidence,
  };
}

// ─── Main Export ─────────────────────────────────────

export async function analyzeSheetWithAI(input: {
  rawRows: (string | number | boolean | null)[][];
  filename: string;
  sheetName?: string;
  totalRows: number;
  totalColumns: number;
}): Promise<AISheetAnalysisResult> {
  const llm = getLlmProvider();

  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const response = await llm.chat({
    messages,
    temperature: DEFAULT_TEMPERATURE,
    responseFormat: { type: "json_object" },
    maxTokens: DEFAULT_MAX_TOKENS,
  });

  const parsed = JSON.parse(response.content);
  return validateAndNormalize(parsed);
}
