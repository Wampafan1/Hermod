/**
 * Mjolnir -- AI inference engine (Phase 4).
 *
 * Resolves ambiguous cases from the deterministic structural diff
 * by calling an LLM with specialized prompts. Groups ambiguous cases
 * by type and dispatches to the appropriate prompt template.
 */

import type { LlmProvider } from "@/lib/llm/types";
import { getLlmProvider } from "@/lib/llm";
import type {
  AmbiguousCase,
  ForgeStep,
  FormulaInfo,
  ParsedFileData,
  StructuralDiffResult,
} from "../types";
import {
  INFER_FORMULA_PROMPT,
  DETECT_FILTERS_PROMPT,
  CLASSIFY_AMBIGUOUS_PROMPT,
  ANALYZE_COLUMNS_PROMPT,
} from "../prompts";
import { validateAndNormalizeSteps } from "./step-validator";

// ─── Constants ──────────────────────────────────────

/** Maximum rows sent to the LLM to save tokens. */
const MAX_SAMPLE_ROWS = 10;

/** Default temperature for deterministic-style outputs. */
const DEFAULT_TEMPERATURE = 0.1;

/** Default max tokens for LLM responses. */
const DEFAULT_MAX_TOKENS = 4096;

/** Maximum AI calls per inference run to prevent runaway costs. */
const MAX_AI_CALLS = 10;

/** Threshold for switching to bulk analysis (analyze-columns) instead of per-column calls. */
const BULK_ANALYSIS_THRESHOLD = 3;

// ─── Context Building ───────────────────────────────

/**
 * Build a JSON context string for LLM consumption.
 * Caps sample data at MAX_SAMPLE_ROWS to save tokens.
 */
/** Build the context data object (not yet stringified). */
export function buildContextObject(
  diff: StructuralDiffResult,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    diffSummary: {
      matchedColumns: diff.matchedColumns.map((m) => ({
        before: m.beforeColumn,
        after: m.afterColumn,
        matchType: m.matchType,
        confidence: m.confidence,
      })),
      removedColumns: diff.removedColumns,
      addedColumns: diff.addedColumns,
      beforeRowCount: diff.beforeRowCount,
      afterRowCount: diff.afterRowCount,
      removedRowCount: diff.removedRowCount,
      reorderDetected: diff.reorderDetected,
      formatChanges: diff.formatChanges,
      sortDetected: diff.sortDetected ?? null,
    },
    beforeData: {
      columns: before.columns,
      sampleRows: before.sampleRows.slice(0, MAX_SAMPLE_ROWS),
      fingerprints: before.fingerprints,
    },
    afterData: {
      columns: after.columns,
      sampleRows: after.sampleRows.slice(0, MAX_SAMPLE_ROWS),
      fingerprints: after.fingerprints,
    },
  };

  if (description) {
    context.userDescription = description;
  }

  return context;
}

/** Build context as a JSON string. */
export function buildContext(
  diff: StructuralDiffResult,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string
): string {
  return JSON.stringify(buildContextObject(diff, before, after, description), null, 2);
}

/**
 * Build a formula lookup map from ParsedFileData.formulas.
 */
function buildFormulaMap(data: ParsedFileData): Map<string, FormulaInfo> {
  const map = new Map<string, FormulaInfo>();
  if (data.formulas) {
    for (const f of data.formulas) {
      map.set(f.column, f);
    }
  }
  return map;
}

/**
 * Build a focused context for formula inference on a specific column.
 * Includes detected formula metadata when available.
 */
function buildFormulaContext(
  column: string,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string
): string {
  const sampleCount = Math.min(before.sampleRows.length, after.sampleRows.length, MAX_SAMPLE_ROWS);
  const beforeSample = before.sampleRows.slice(0, sampleCount);
  const afterSample = after.sampleRows.slice(0, sampleCount);

  const context: Record<string, unknown> = {
    targetColumn: column,
    beforeColumns: before.columns,
    beforeFingerprints: before.fingerprints,
    sampleData: beforeSample.map((row, i) => ({
      beforeRow: row,
      afterValue: afterSample[i]?.[column] ?? null,
    })),
  };

  // Include formula metadata if the parser detected a formula for this column
  const formulaMap = buildFormulaMap(after);
  const formulaInfo = formulaMap.get(column);
  if (formulaInfo) {
    context.detectedFormula = {
      rawFormula: formulaInfo.formula,
      expression: formulaInfo.expression,
      referencedColumns: formulaInfo.referencedColumns,
    };
  }

  if (description) {
    context.userDescription = description;
  }

  return JSON.stringify(context, null, 2);
}

/**
 * Build a focused context for row filter detection.
 */
function buildFilterContext(
  diff: StructuralDiffResult,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string
): string {
  // Identify removed rows by finding BEFORE rows not present in AFTER.
  // Use a simple stringified comparison on matched columns.
  const matchedBeforeCols = diff.matchedColumns.map((m) => m.beforeColumn);
  const matchedAfterCols = diff.matchedColumns.map((m) => m.afterColumn);

  const afterRowKeys = new Set(
    after.sampleRows.slice(0, MAX_SAMPLE_ROWS * 5).map((row) =>
      matchedAfterCols.map((col) => JSON.stringify(row[col])).join("|")
    )
  );

  const removedRows: Record<string, unknown>[] = [];
  const keptRows: Record<string, unknown>[] = [];

  for (const row of before.sampleRows) {
    const key = matchedBeforeCols.map((col) => JSON.stringify(row[col])).join("|");
    if (afterRowKeys.has(key)) {
      if (keptRows.length < MAX_SAMPLE_ROWS) {
        keptRows.push(row);
      }
    } else {
      if (removedRows.length < MAX_SAMPLE_ROWS) {
        removedRows.push(row);
      }
    }
  }

  const context: Record<string, unknown> = {
    beforeRowCount: diff.beforeRowCount,
    afterRowCount: diff.afterRowCount,
    removedRowCount: diff.removedRowCount,
    removedRows,
    keptRows,
    columns: before.columns,
    fingerprints: before.fingerprints,
  };

  if (description) {
    context.userDescription = description;
  }

  return JSON.stringify(context, null, 2);
}

/**
 * Build context for bulk column analysis (analyze-columns prompt).
 * Sends all unmatched column pairs in one request instead of one-per-column.
 */
function buildBulkColumnContext(
  columns: string[],
  diff: StructuralDiffResult,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string
): string {
  const sampleCount = Math.min(before.sampleRows.length, after.sampleRows.length, MAX_SAMPLE_ROWS);
  const beforeSample = before.sampleRows.slice(0, sampleCount);
  const afterSample = after.sampleRows.slice(0, sampleCount);

  // Include formula metadata for any target columns that have formulas
  const formulaMap = buildFormulaMap(after);
  const detectedFormulas: Record<string, { rawFormula: string; expression: string; referencedColumns: string[] }> = {};
  for (const col of columns) {
    const fi = formulaMap.get(col);
    if (fi) {
      detectedFormulas[col] = {
        rawFormula: fi.formula,
        expression: fi.expression,
        referencedColumns: fi.referencedColumns,
      };
    }
  }

  const context: Record<string, unknown> = {
    diffSummary: {
      matchedColumns: diff.matchedColumns.map((m) => ({
        before: m.beforeColumn,
        after: m.afterColumn,
        matchType: m.matchType,
        confidence: m.confidence,
      })),
      removedColumns: diff.removedColumns,
      addedColumns: diff.addedColumns,
    },
    targetColumns: columns,
    beforeColumns: before.columns,
    beforeFingerprints: before.fingerprints,
    afterColumns: after.columns,
    sampleData: beforeSample.map((row, i) => ({
      beforeRow: row,
      afterRow: afterSample[i] ?? {},
    })),
  };

  // Only include if we found any formulas
  if (Object.keys(detectedFormulas).length > 0) {
    context.detectedFormulas = detectedFormulas;
  }

  if (description) {
    context.userDescription = description;
  }

  return JSON.stringify(context, null, 2);
}

// ─── Response Parsing ───────────────────────────────

/**
 * Parse ForgeStep objects from an LLM JSON response.
 * Handles both single-object and array formats gracefully.
 * Re-numbers steps starting from the given order.
 * Uses non-greedy regex to avoid capturing across explanation text.
 */

/**
 * Extract parsed JSON from an LLM response string.
 * Handles markdown code fences, bare JSON, and embedded JSON in explanation text.
 * Tries non-greedy then greedy extraction for both arrays and objects.
 */
function extractJsonFromLlmResponse(content: string): unknown | null {
  let jsonStr = content.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Direct parse
  try { return JSON.parse(jsonStr); } catch { /* continue */ }

  // Non-greedy extraction: try array, then object
  for (const pattern of [/\[[\s\S]*?\]/, /\{[\s\S]*?\}/]) {
    const match = jsonStr.match(pattern);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* continue */ }
    }
  }

  // Greedy fallback: try array, then object
  for (const pattern of [/\[[\s\S]*\]/, /\{[\s\S]*\}/]) {
    const match = jsonStr.match(pattern);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* continue */ }
    }
  }

  return null;
}

export function parseStepsFromResponse(
  content: string,
  startOrder: number
): ForgeStep[] {
  const parsed = extractJsonFromLlmResponse(content);
  if (parsed === null) return [];

  // Normalize to array
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  const steps: ForgeStep[] = [];
  let order = startOrder;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const raw = item as Record<string, unknown>;

    // Validate required fields
    if (!raw.type || typeof raw.type !== "string") continue;
    if (typeof raw.confidence !== "number") continue;

    // Skip low-confidence steps
    if (raw.confidence < 0.5) continue;

    steps.push({
      order: order++,
      type: raw.type as ForgeStep["type"],
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      config: (raw.config as Record<string, unknown>) ?? {},
      description: typeof raw.description === "string" ? raw.description : "",
    });
  }

  return steps;
}

/**
 * Parse a single filter step from an LLM response for detect-filters prompt.
 * The response is a single JSON object, not an array.
 */
function parseFilterFromResponse(
  content: string,
  startOrder: number
): ForgeStep[] {
  const parsed = extractJsonFromLlmResponse(content);
  if (!parsed || typeof parsed !== "object") return [];

  const raw = parsed as Record<string, unknown>;

  // Check if the filter was identified (confidence > 0, column non-empty)
  if (
    typeof raw.confidence !== "number" ||
    raw.confidence < 0.5 ||
    !raw.column ||
    typeof raw.column !== "string"
  ) {
    return [];
  }

  return [
    {
      order: startOrder,
      type: "filter_rows",
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      config: {
        column: raw.column,
        operator: raw.operator ?? "eq",
        value: raw.value ?? null,
      },
      description: typeof raw.description === "string"
        ? raw.description
        : `Filter rows where ${raw.column} ${raw.operator} ${JSON.stringify(raw.value)}`,
    },
  ];
}

/**
 * Parse a formula inference response into a calculate ForgeStep.
 * Issue #4: Emits `column` (not `outputColumn`) to match executor expectations.
 */
function parseFormulaFromResponse(
  content: string,
  columnName: string,
  startOrder: number
): ForgeStep[] {
  const parsed = extractJsonFromLlmResponse(content);
  if (!parsed || typeof parsed !== "object") return [];

  const raw = parsed as Record<string, unknown>;

  if (
    typeof raw.confidence !== "number" ||
    raw.confidence < 0.5 ||
    !raw.formula ||
    typeof raw.formula !== "string"
  ) {
    return [];
  }

  // Extract source columns from {Column Name} references in the formula
  const sourceColumns: string[] = [];
  const colRefPattern = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = colRefPattern.exec(raw.formula)) !== null) {
    if (!sourceColumns.includes(match[1])) {
      sourceColumns.push(match[1]);
    }
  }

  return [
    {
      order: startOrder,
      type: "calculate",
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      config: {
        column: columnName, // Issue #4: was "outputColumn", now "column" to match executor
        formula: raw.formula,
        sourceColumns,
      },
      description: typeof raw.explanation === "string"
        ? `Calculate '${columnName}': ${raw.explanation}`
        : `Calculate '${columnName}' using formula: ${raw.formula}`,
    },
  ];
}

// ─── Main Inference Function ────────────────────────

/**
 * Run AI inference on ambiguous cases from a structural diff.
 *
 * Groups ambiguous cases by type and dispatches to specialized prompts:
 * - new_column cases (>3): analyze-columns prompt (bulk, one call)
 * - new_column cases (<=3): infer-formula prompt (one call per column)
 * - removed_rows cases: detect-filters prompt
 * - uncertain_match / others: classify-ambiguous prompt
 *
 * Caps total AI calls at MAX_AI_CALLS to prevent runaway costs.
 * Returns ForgeStep objects validated through the step-validator.
 */
export interface AiInferenceResult {
  steps: ForgeStep[];
  warnings: string[];
}

export async function runAiInference(
  diff: StructuralDiffResult,
  before: ParsedFileData,
  after: ParsedFileData,
  description?: string,
  provider?: LlmProvider
): Promise<AiInferenceResult> {
  const warnings: string[] = [];

  // If no ambiguous cases, nothing to do
  if (diff.ambiguousCases.length === 0) {
    return { steps: [], warnings };
  }

  // Resolve LLM provider
  let llm: LlmProvider;
  try {
    llm = provider ?? getLlmProvider();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`LLM provider not configured: ${msg}`);
    return { steps: [], warnings };
  }

  // Determine starting order after deterministic steps (excluding reorder_columns,
  // which uses order=900 to ensure it runs after all AI-inferred steps).
  const maxDeterministicOrder = diff.deterministicSteps.reduce(
    (max, step) => step.type === "reorder_columns" ? max : Math.max(max, step.order),
    -1
  );
  let nextOrder = maxDeterministicOrder + 1;

  // Group ambiguous cases by type
  const newColumnCases: AmbiguousCase[] = [];
  const removedRowsCases: AmbiguousCase[] = [];
  const otherCases: AmbiguousCase[] = [];

  for (const ac of diff.ambiguousCases) {
    if (ac.type === "new_column") {
      newColumnCases.push(ac);
    } else if (ac.type === "removed_rows") {
      removedRowsCases.push(ac);
    } else {
      otherCases.push(ac);
    }
  }

  const allSteps: ForgeStep[] = [];
  let aiCallCount = 0;

  // ─── New Column Cases ──────────────────────────────

  // First, resolve any columns that have detected formulas without AI
  const formulaMap = buildFormulaMap(after);
  const unresolvedNewCols: AmbiguousCase[] = [];
  const deterministicFormulaColumns = new Set<string>();

  for (const nc of newColumnCases) {
    const column = nc.context.column as string;
    const formulaInfo = formulaMap.get(column);

    if (formulaInfo && formulaInfo.referencedColumns.length > 0) {
      // We have a formula — generate a calculate step deterministically
      deterministicFormulaColumns.add(column);
      allSteps.push({
        order: nextOrder++,
        type: "calculate",
        confidence: 0.9,
        config: {
          column,
          formula: formulaInfo.expression,
          sourceColumns: formulaInfo.referencedColumns,
        },
        description: `Calculate '${column}' from detected formula: ${formulaInfo.formula}`,
      });
    } else {
      unresolvedNewCols.push(nc);
    }
  }

  // Now handle remaining unresolved new columns via AI
  if (unresolvedNewCols.length > BULK_ANALYSIS_THRESHOLD) {
    // Issue #20: Use analyze-columns prompt for bulk resolution
    if (aiCallCount >= MAX_AI_CALLS) {
      warnings.push(
        `AI call limit reached (${MAX_AI_CALLS}). ${unresolvedNewCols.length} new column(s) were not analyzed.`
      );
    } else {
      try {
        const columns = unresolvedNewCols.map((nc) => nc.context.column as string);
        const context = buildBulkColumnContext(columns, diff, before, after, description);

        const response = await llm.chat({
          messages: [
            { role: "system", content: ANALYZE_COLUMNS_PROMPT },
            { role: "user", content: context },
          ],
          temperature: DEFAULT_TEMPERATURE,
          responseFormat: { type: "json_object" },
          maxTokens: DEFAULT_MAX_TOKENS,
        });
        aiCallCount++;

        const steps = parseStepsFromResponse(response.content, nextOrder);
        // Filter out AI calculate steps for columns already handled by deterministic formulas
        const deduped = steps.filter((s) => {
          if (s.type === "calculate") {
            const col = s.config.column as string;
            if (col && deterministicFormulaColumns.has(col)) return false;
          }
          return true;
        });
        const validated = validateAndNormalizeSteps(deduped);
        warnings.push(...validated.warnings);

        for (const step of validated.steps) {
          allSteps.push(step);
          nextOrder = step.order + 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`AI bulk column analysis failed: ${msg}`);
        console.warn("[Mjolnir] AI bulk column analysis failed:", msg);
      }
    }
  } else {
    // Individual formula inference for each remaining new column
    for (const nc of unresolvedNewCols) {
      if (aiCallCount >= MAX_AI_CALLS) {
        const remaining = unresolvedNewCols.length - unresolvedNewCols.indexOf(nc);
        warnings.push(
          `AI call limit reached (${MAX_AI_CALLS}). ${remaining} new column(s) were not analyzed.`
        );
        break;
      }

      const column = nc.context.column as string;
      try {
        const context = buildFormulaContext(column, before, after, description);

        const response = await llm.chat({
          messages: [
            { role: "system", content: INFER_FORMULA_PROMPT },
            { role: "user", content: context },
          ],
          temperature: DEFAULT_TEMPERATURE,
          responseFormat: { type: "json_object" },
          maxTokens: DEFAULT_MAX_TOKENS,
        });
        aiCallCount++;

        const steps = parseFormulaFromResponse(response.content, column, nextOrder);
        // Filter out AI calculate steps for columns already handled deterministically
        const deduped = steps.filter((s) => {
          if (s.type === "calculate") {
            const col = s.config.column as string;
            if (col && deterministicFormulaColumns.has(col)) return false;
          }
          return true;
        });
        const validated = validateAndNormalizeSteps(deduped);
        warnings.push(...validated.warnings);

        for (const step of validated.steps) {
          allSteps.push(step);
          nextOrder = step.order + 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`AI inference failed for new column "${column}": ${msg}`);
        console.warn(`[Mjolnir] AI inference failed for new_column "${column}":`, msg);
      }
    }
  }

  // ─── Removed Rows Cases (filter detection) ─────────

  if (removedRowsCases.length > 0) {
    if (aiCallCount >= MAX_AI_CALLS) {
      warnings.push(
        `AI call limit reached (${MAX_AI_CALLS}). Row filter detection was skipped.`
      );
    } else {
      try {
        const context = buildFilterContext(diff, before, after, description);

        const response = await llm.chat({
          messages: [
            { role: "system", content: DETECT_FILTERS_PROMPT },
            { role: "user", content: context },
          ],
          temperature: DEFAULT_TEMPERATURE,
          responseFormat: { type: "json_object" },
          maxTokens: DEFAULT_MAX_TOKENS,
        });
        aiCallCount++;

        const steps = parseFilterFromResponse(response.content, nextOrder);
        const validated = validateAndNormalizeSteps(steps);
        warnings.push(...validated.warnings);

        for (const step of validated.steps) {
          allSteps.push(step);
          nextOrder = step.order + 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`AI inference failed for row filter detection: ${msg}`);
        console.warn("[Mjolnir] AI inference failed for removed_rows:", msg);
      }
    }
  }

  // ─── Other Cases (general classification) ──────────

  if (otherCases.length > 0) {
    if (aiCallCount >= MAX_AI_CALLS) {
      warnings.push(
        `AI call limit reached (${MAX_AI_CALLS}). ${otherCases.length} ambiguous case(s) were not analyzed.`
      );
    } else {
      try {
        const contextObj = buildContextObject(diff, before, after, description);
        contextObj.ambiguousCases = otherCases;
        const contextWithCases = JSON.stringify(contextObj, null, 2);

        const response = await llm.chat({
          messages: [
            { role: "system", content: CLASSIFY_AMBIGUOUS_PROMPT },
            { role: "user", content: contextWithCases },
          ],
          temperature: DEFAULT_TEMPERATURE,
          responseFormat: { type: "json_object" },
          maxTokens: DEFAULT_MAX_TOKENS,
        });
        aiCallCount++;

        const steps = parseStepsFromResponse(response.content, nextOrder);
        const validated = validateAndNormalizeSteps(steps);
        warnings.push(...validated.warnings);

        for (const step of validated.steps) {
          allSteps.push(step);
          nextOrder = step.order + 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`AI inference failed for ambiguous classification: ${msg}`);
        console.warn("[Mjolnir] AI inference failed for ambiguous classification:", msg);
      }
    }
  }

  // Final deduplication: if multiple calculate steps target the same column,
  // keep only the first one (deterministic formulas are added first, so they win)
  const seenCalcColumns = new Set<string>();
  const dedupedSteps = allSteps.filter((step) => {
    if (step.type === "calculate") {
      const col = step.config.column as string;
      if (col) {
        if (seenCalcColumns.has(col)) return false;
        seenCalcColumns.add(col);
      }
    }
    return true;
  });

  return { steps: dedupedSteps, warnings };
}
