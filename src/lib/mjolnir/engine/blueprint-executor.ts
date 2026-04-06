/**
 * Mjolnir — Blueprint executor engine.
 *
 * Executes a ForgeStep[] pipeline against tabular input data.
 * Each step handler transforms the running columns/rows state.
 * The expression parser is used for "calculate" steps.
 */

import type { ForgeStep, ForgeStepType, StepMetric } from "../types";
import { evaluateExpression, parseFormula, evaluate } from "./expression-parser";
import type { AstNode } from "./expression-parser";

// ─── Public Types ───────────────────────────────────

export interface ExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
  metrics: StepMetric[];
  totalDurationMs: number;
}

// ─── Internal State ─────────────────────────────────

interface PipelineState {
  columns: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
  _warningSet: Set<string>;
}

/** Add a warning with O(1) dedup via Set. */
function addWarning(state: PipelineState, warning: string): void {
  if (!state._warningSet.has(warning)) {
    state._warningSet.add(warning);
    state.warnings.push(warning);
  }
}

// ─── Step Handlers ──────────────────────────────────

/**
 * Remove specified columns from the dataset.
 * Config: { columns: string[] }
 */
function handleRemoveColumns(state: PipelineState, config: Record<string, unknown>): void {
  const columnsToRemove = config.columns as string[];
  if (!Array.isArray(columnsToRemove)) return;

  const removeSet = new Set(columnsToRemove);
  state.columns = state.columns.filter((c) => !removeSet.has(c));

  for (const row of state.rows) {
    for (const col of columnsToRemove) {
      delete row[col];
    }
  }
}

/**
 * Rename columns and update row keys.
 * Config: { mapping: Record<string, string> } — key = old name, value = new name
 */
function handleRenameColumns(state: PipelineState, config: Record<string, unknown>): void {
  const mapping = config.mapping as Record<string, string> | undefined;
  if (!mapping || typeof mapping !== "object") return;

  // Check for collision: rename target exists and isn't being renamed away
  const renameTargets = new Set(Object.values(mapping));
  const renameSources = new Set(Object.keys(mapping));
  for (const col of state.columns) {
    if (renameTargets.has(col) && !renameSources.has(col)) {
      addWarning(state, `Rename collision: target "${col}" already exists and is not being renamed`);
    }
  }

  // Update column list
  state.columns = state.columns.map((c) => mapping[c] ?? c);

  // Update row keys — snapshot old values first to prevent chain rename corruption
  // (e.g., mapping {A:"B", B:"C"} must not lose B's original value)
  for (const row of state.rows) {
    const snapshot: Record<string, unknown> = {};
    for (const oldName of Object.keys(mapping)) {
      if (oldName in row) {
        snapshot[oldName] = row[oldName];
      }
    }
    for (const [oldName, newName] of Object.entries(mapping)) {
      if (oldName in snapshot && oldName !== newName) {
        row[newName] = snapshot[oldName];
        delete row[oldName];
      }
    }
  }
}

/**
 * Reorder the columns array.
 * Config: { order: string[] }
 */
function handleReorderColumns(state: PipelineState, config: Record<string, unknown>): void {
  const order = config.order as string[] | undefined;
  if (!Array.isArray(order)) return;

  // Only include columns that actually exist, then append any unlisted columns
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const col of order) {
    if (state.columns.includes(col) && !seen.has(col)) {
      ordered.push(col);
      seen.add(col);
    }
  }

  // Append columns not in the explicit order
  for (const col of state.columns) {
    if (!seen.has(col)) {
      ordered.push(col);
    }
  }

  state.columns = ordered;
}

/**
 * Filter rows based on a column condition.
 * Config: { column: string, operator: string, value?: unknown }
 * Operators: eq, neq, gt, lt, gte, lte, contains, is_null, not_null
 */
function handleFilterRows(state: PipelineState, config: Record<string, unknown>): void {
  const column = config.column as string;
  const operator = config.operator as string;
  const filterValue = config.value;

  if (!column || !operator) return;

  state.rows = state.rows.filter((row) => {
    const cellValue = row[column];

    switch (operator) {
      case "is_null":
        return cellValue === null || cellValue === undefined || cellValue === "";

      case "not_null":
        return cellValue !== null && cellValue !== undefined && cellValue !== "";

      case "eq":
        return coercedEquals(cellValue, filterValue);

      case "neq":
        return !coercedEquals(cellValue, filterValue);

      case "gt":
        return coercedCompare(cellValue, filterValue) > 0;

      case "lt":
        return coercedCompare(cellValue, filterValue) < 0;

      case "gte":
        return coercedCompare(cellValue, filterValue) >= 0;

      case "lte":
        return coercedCompare(cellValue, filterValue) <= 0;

      case "contains": {
        if (cellValue === null || cellValue === undefined) return false;
        const haystack = String(cellValue).toLowerCase();
        const needle = String(filterValue).toLowerCase();
        return haystack.includes(needle);
      }

      default:
        return true;
    }
  });
}

/**
 * Coerced equality: try numeric comparison first, then string.
 */
function coercedEquals(a: unknown, b: unknown): boolean {
  const aNum = tryParseNumber(a);
  const bNum = tryParseNumber(b);
  if (aNum !== null && bNum !== null) {
    return aNum === bNum;
  }
  return String(a ?? "") === String(b ?? "");
}

/**
 * Coerced comparison: try numeric, then string.
 * Returns negative, zero, or positive.
 */
function coercedCompare(a: unknown, b: unknown): number {
  const aNum = tryParseNumber(a);
  const bNum = tryParseNumber(b);
  if (aNum !== null && bNum !== null) {
    return aNum - bNum;
  }
  const aStr = String(a ?? "");
  const bStr = String(b ?? "");
  return aStr.localeCompare(bStr);
}

/**
 * Try to parse a value as a number. Returns null if not numeric.
 */
function tryParseNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Apply a format transformation to a column.
 * Config: { column: string, formatType: string, pattern?: string }
 * Format types: uppercase, lowercase, trim, date_format
 */
function handleFormat(state: PipelineState, config: Record<string, unknown>): void {
  const column = config.column as string;
  const formatType = config.formatType as string;

  if (!column || !formatType) return;

  for (const row of state.rows) {
    const value = row[column];
    if (value === null || value === undefined) continue;

    switch (formatType) {
      case "uppercase":
        row[column] = String(value).toUpperCase();
        break;

      case "lowercase":
        row[column] = String(value).toLowerCase();
        break;

      case "trim":
        row[column] = String(value).trim();
        break;

      case "date_format": {
        const dateStr = String(value);
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          const pattern = config.pattern as string | undefined;
          if (pattern) {
            // Basic pattern substitution for common tokens
            row[column] = formatDate(parsed, pattern);
          } else {
            row[column] = parsed.toISOString();
          }
        }
        break;
      }

      case "number_format": {
        // Pad numbers with leading zeros
        const numStr = String(value);
        const padding = config.pattern as string | undefined;
        if (padding && /^0+$/.test(padding)) {
          // Pad to length of pattern (e.g., "000" → pad to 3 chars)
          row[column] = numStr.padStart(padding.length, "0");
        }
        break;
      }
    }
  }
}

/**
 * Basic date formatter supporting common pattern tokens.
 * Tokens: YYYY, MM, DD, HH, mm, ss
 */
function formatDate(date: Date, pattern: string): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");

  return pattern
    .replace(/YYYY/g, yyyy)
    .replace(/MM/g, mm)
    .replace(/DD/g, dd)
    .replace(/HH/g, hh)
    .replace(/mm/g, min)
    .replace(/ss/g, ss);
}

/**
 * Add or overwrite a column with calculated values using formula expressions.
 * Config: { column: string, formula: string }
 */
function handleCalculate(state: PipelineState, config: Record<string, unknown>): void {
  const column = config.column as string;
  const formula = config.formula as string;

  if (!column || !formula) return;

  // Add column if it doesn't exist
  if (!state.columns.includes(column)) {
    state.columns.push(column);
  }

  // Parse once — fail fast on syntax errors
  let ast: AstNode;
  try {
    ast = parseFormula(formula);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addWarning(state, `Formula parse error for "${column}": ${message}`);
    for (const row of state.rows) {
      row[column] = null;
    }
    return;
  }

  // Evaluate per-row — only runtime errors caught here
  for (const row of state.rows) {
    try {
      row[column] = evaluate(ast, row);
    } catch (err) {
      row[column] = null;
      const message = err instanceof Error ? err.message : String(err);
      addWarning(state, `Calculate error in "${column}": ${message}`);
    }
  }
}

/**
 * Sort rows by a column value.
 * Config: { column: string, direction: "asc" | "desc" }
 * Null values sort last regardless of direction.
 */
function handleSort(state: PipelineState, config: Record<string, unknown>): void {
  const column = config.column as string;
  const direction = (config.direction as string) || "asc";

  if (!column) return;

  const multiplier = direction === "desc" ? -1 : 1;

  state.rows.sort((a, b) => {
    const aVal = a[column];
    const bVal = b[column];

    // Null values sort last
    const aNull = aVal === null || aVal === undefined || aVal === "";
    const bNull = bVal === null || bVal === undefined || bVal === "";

    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;

    // Try numeric comparison
    const aNum = tryParseNumber(aVal);
    const bNum = tryParseNumber(bVal);
    if (aNum !== null && bNum !== null) {
      return (aNum - bNum) * multiplier;
    }

    // Try date comparison — only for values that look like actual dates
    const aStr = String(aVal);
    const bStr = String(bVal);
    const dateIsh = /[\/-]/.test(aStr) && /\d{4}/.test(aStr);
    if (dateIsh || aVal instanceof Date) {
      const aDate = aVal instanceof Date ? aVal : new Date(aStr);
      const bDate = bVal instanceof Date ? bVal : new Date(bStr);
      if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
        return (aDate.getTime() - bDate.getTime()) * multiplier;
      }
    }

    // String comparison
    return String(aVal).localeCompare(String(bVal)) * multiplier;
  });
}

/**
 * Remove duplicate rows.
 * Config: { columns?: string[] } — columns to check. If omitted, use all columns.
 */
function handleDeduplicate(state: PipelineState, config: Record<string, unknown>): void {
  const checkColumns = (config.columns as string[] | undefined) ?? state.columns;
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];

  for (const row of state.rows) {
    const key = checkColumns.map((c) => JSON.stringify(row[c] ?? null)).join("\x00");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }

  state.rows = unique;
}

/**
 * Aggregate rows by grouping columns with aggregation functions.
 * Config: { groupBy: string[], aggregations: Array<{ column, function, outputColumn? }> }
 * Functions: sum, count, avg, min, max, count_distinct
 */
function handleAggregate(state: PipelineState, config: Record<string, unknown>): void {
  const groupBy = (config.groupBy as string[]) ?? [];
  const aggregations = config.aggregations as Array<{
    column: string;
    function: string;
    outputColumn?: string;
  }>;
  if (!Array.isArray(aggregations)) return;

  // Build groups
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of state.rows) {
    const key = groupBy.map((col) => JSON.stringify(row[col] ?? null)).join("\x00");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Compute aggregations per group
  const resultRows: Record<string, unknown>[] = [];
  for (const [, groupRows] of groups) {
    const row: Record<string, unknown> = {};

    // Copy group-by column values from first row
    for (const col of groupBy) {
      row[col] = groupRows[0][col];
    }

    // Compute each aggregation
    for (const agg of aggregations) {
      const outputCol = agg.outputColumn ?? `${agg.function}_${agg.column}`;
      const values = groupRows
        .map((r) => r[agg.column])
        .filter((v) => v !== null && v !== undefined);
      const nums = values
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => !isNaN(n));

      switch (agg.function) {
        case "sum":
          row[outputCol] = nums.reduce((a, b) => a + b, 0);
          break;
        case "count":
          row[outputCol] = groupRows.length;
          break;
        case "avg":
          row[outputCol] = nums.length > 0
            ? nums.reduce((a, b) => a + b, 0) / nums.length
            : null;
          break;
        case "min":
          row[outputCol] = nums.length > 0
            ? nums.reduce((a, b) => (a < b ? a : b), nums[0])
            : null;
          break;
        case "max":
          row[outputCol] = nums.length > 0
            ? nums.reduce((a, b) => (a > b ? a : b), nums[0])
            : null;
          break;
        case "count_distinct":
          row[outputCol] = new Set(values.map((v) => String(v))).size;
          break;
        default:
          row[outputCol] = null;
      }
    }

    resultRows.push(row);
  }

  // Update columns: groupBy columns + aggregation output columns
  state.columns = [
    ...groupBy,
    ...aggregations.map((a) => a.outputColumn ?? `${a.function}_${a.column}`),
  ];
  state.rows = resultRows;
}

/**
 * Split a column into multiple columns by delimiter.
 * Config: { column, delimiter, outputColumns, keepOriginal? }
 */
function handleSplitColumn(state: PipelineState, config: Record<string, unknown>): void {
  const column = config.column as string;
  const delimiter = config.delimiter as string;
  const outputColumns = config.outputColumns as string[];
  const keepOriginal = (config.keepOriginal as boolean) ?? false;

  if (!column || !delimiter || !Array.isArray(outputColumns) || outputColumns.length === 0) return;

  // Add output columns where source column was (or after it)
  const colIdx = state.columns.indexOf(column);
  if (colIdx === -1) return;

  // Build new column list
  const newCols = [...state.columns];
  if (!keepOriginal) {
    newCols.splice(colIdx, 1, ...outputColumns);
  } else {
    newCols.splice(colIdx + 1, 0, ...outputColumns);
  }
  state.columns = newCols;

  // Split values in rows
  for (const row of state.rows) {
    const value = row[column];
    const parts = value !== null && value !== undefined
      ? String(value).split(delimiter)
      : [];

    for (let i = 0; i < outputColumns.length; i++) {
      row[outputColumns[i]] = i < parts.length ? parts[i] : null;
    }

    if (!keepOriginal) {
      delete row[column];
    }
  }
}

/**
 * Merge multiple columns into one with a delimiter.
 * Config: { columns, delimiter, outputColumn, keepOriginals? }
 */
function handleMergeColumns(state: PipelineState, config: Record<string, unknown>): void {
  const columns = config.columns as string[];
  const delimiter = config.delimiter as string;
  const outputColumn = config.outputColumn as string;
  const keepOriginals = (config.keepOriginals as boolean) ?? false;

  if (!Array.isArray(columns) || columns.length === 0 || !outputColumn || delimiter === undefined) return;

  // Add output column at position of first source column
  const firstIdx = state.columns.indexOf(columns[0]);
  if (firstIdx === -1) return;

  // Build new column list
  if (!keepOriginals) {
    const removeSet = new Set(columns);
    state.columns = state.columns.filter((c) => !removeSet.has(c));
    // Insert output column at original position of first source
    const insertIdx = Math.min(firstIdx, state.columns.length);
    state.columns.splice(insertIdx, 0, outputColumn);
  } else {
    state.columns.splice(firstIdx + 1, 0, outputColumn);
  }

  // Merge values in rows
  for (const row of state.rows) {
    const parts = columns
      .map((c) => row[c])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v));
    row[outputColumn] = parts.join(delimiter);

    if (!keepOriginals) {
      for (const col of columns) {
        delete row[col];
      }
    }
  }
}

/**
 * Stub handler for unimplemented step types.
 */
function handleStub(state: PipelineState, stepType: string): void {
  addWarning(state, `Step type '${stepType}' is not yet implemented`);
}

// ─── Step Dispatch ──────────────────────────────────

/**
 * Map of step type to handler function.
 */
const STEP_HANDLERS: Record<
  ForgeStepType,
  (state: PipelineState, config: Record<string, unknown>) => void
> = {
  remove_columns: handleRemoveColumns,
  rename_columns: handleRenameColumns,
  reorder_columns: handleReorderColumns,
  filter_rows: handleFilterRows,
  format: handleFormat,
  calculate: handleCalculate,
  sort: handleSort,
  deduplicate: handleDeduplicate,
  aggregate: handleAggregate,
  split_column: handleSplitColumn,
  merge_columns: handleMergeColumns,
  lookup: (state) => handleStub(state, "lookup"),
  pivot: (state) => handleStub(state, "pivot"),
  unpivot: (state) => handleStub(state, "unpivot"),
  custom_sql: (state) => handleStub(state, "custom_sql"),
};

// ─── Main Entry Point ───────────────────────────────

/**
 * Execute a blueprint (ForgeStep[] pipeline) against tabular input data.
 *
 * Steps are sorted by `order` and applied sequentially. Each step mutates
 * the running state (columns, rows, warnings). Unknown step types add a
 * warning and pass data through unchanged.
 *
 * @param steps - The ordered pipeline of forge steps
 * @param input - The input dataset (columns + rows)
 * @returns The transformed dataset with any warnings
 */
export function executeBlueprint(
  steps: ForgeStep[],
  input: { columns: string[]; rows: Record<string, unknown>[] }
): ExecutionResult {
  // Deep-clone input to avoid mutating caller's data
  const state: PipelineState = {
    columns: [...input.columns],
    rows: input.rows.map((row) => ({ ...row })),
    warnings: [],
    _warningSet: new Set(),
  };

  // Sort steps by order
  const sorted = [...steps].sort((a, b) => a.order - b.order);

  // Execute each step with metrics collection
  const pipelineStart = performance.now();
  const metrics: StepMetric[] = [];

  for (const step of sorted) {
    const rowsIn = state.rows.length;
    const columnsIn = state.columns.length;
    const stepStart = performance.now();

    const handler = STEP_HANDLERS[step.type];
    if (handler) {
      try {
        handler(state, step.config);
      } catch (err) {
        throw err;
      }
    } else {
      addWarning(state, `Unknown step type: ${step.type}`);
    }

    metrics.push({
      order: step.order,
      type: step.type,
      durationMs: Math.round((performance.now() - stepStart) * 100) / 100,
      rowsIn,
      rowsOut: state.rows.length,
      columnsIn,
      columnsOut: state.columns.length,
    });
  }

  return {
    columns: state.columns,
    rows: state.rows,
    warnings: state.warnings,
    metrics,
    totalDurationMs: Math.round((performance.now() - pipelineStart) * 100) / 100,
  };
}
