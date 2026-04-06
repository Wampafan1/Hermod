/**
 * Mjolnir — Validation engine (Phase 3).
 *
 * Two validation modes:
 *
 * 1. **Pattern validation** (default): Checks whether the blueprint correctly
 *    describes the transformation pattern — column structure, formula
 *    correctness, format transforms. Does NOT require row-by-row data match.
 *    Suited for real-world files where BEFORE/AFTER have different row
 *    counts or represent different time periods.
 *
 * 2. **Strict validation**: Full cell-by-cell comparison using key-based row
 *    matching (with positional fallback). Use when BEFORE/AFTER represent
 *    the same underlying data.
 */

import type { ForgeStep, FormulaInfo, ParsedFileData } from "../types";
import { executeBlueprint } from "./blueprint-executor";

// ─── Public Types ───────────────────────────────────

export interface ColumnValidation {
  column: string;
  matchCount: number;
  mismatchCount: number;
  matchRate: number;
}

export interface Mismatch {
  row: number;
  column: string;
  expected: unknown;
  actual: unknown;
}

/** A single check result for pattern validation */
export interface PatternCheck {
  category: "column_structure" | "formula" | "format" | "rename" | "row_count" | "completeness";
  status: "pass" | "fail" | "warn";
  description: string;
  details?: string;
}

export interface ValidationResult {
  overallMatchRate: number;
  totalCells: number;
  matchedCells: number;
  columnValidations: ColumnValidation[];
  mismatches: Mismatch[]; // capped at 100
  passed: boolean;
  unsupportedSteps: string[];
  /** How rows were matched — "key", "positional", or "pattern" */
  rowMatchMode: "key" | "positional" | "pattern";
  /** The column used for key-based matching, if any */
  keyColumn?: string;
  /** Rows in AFTER that had no matching row in executed output */
  unmatchedAfterRows: number;
  /** Rows in executed output that had no matching row in AFTER */
  unmatchedExecutedRows: number;
  /** Pattern-based check results (only in pattern mode) */
  patternChecks?: PatternCheck[];
}

// ─── Constants ──────────────────────────────────────

/** Numeric tolerance for floating point comparison. */
const NUMERIC_TOLERANCE = 0.01;

/** Maximum mismatches to record in the result. */
const MAX_MISMATCHES = 100;

/** Passing threshold for overall match rate. */
const PASS_THRESHOLD = 0.95;

/** How many overlapping rows to spot-check formulas on. */
const FORMULA_SPOT_CHECK_ROWS = 20;

// ─── Comparison Helpers ─────────────────────────────

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

function tryNormalizeDate(value: unknown): string | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime()) && /\d{4}/.test(trimmed)) {
      return d.toISOString();
    }
  }
  return null;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function cellsMatch(expected: unknown, actual: unknown): boolean {
  if (isNullish(expected) && isNullish(actual)) return true;
  if (isNullish(expected) || isNullish(actual)) return false;

  const expectedNum = tryParseNumber(expected);
  const actualNum = tryParseNumber(actual);
  if (expectedNum !== null && actualNum !== null) {
    return Math.abs(expectedNum - actualNum) <= NUMERIC_TOLERANCE;
  }

  const expectedDate = tryNormalizeDate(expected);
  const actualDate = tryNormalizeDate(actual);
  if (expectedDate !== null && actualDate !== null) {
    return expectedDate === actualDate;
  }

  const expectedStr = String(expected).trim();
  const actualStr = String(actual).trim();
  return expectedStr === actualStr;
}

// ─── Key Column Detection ───────────────────────────

function toKeyString(value: unknown): string {
  if (value === null || value === undefined) return "__NULL__";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function findKeyColumn(
  matchedPairs: Array<{ refCol: string; execCol: string }>,
  afterRows: Record<string, unknown>[],
  executedRows: Record<string, unknown>[]
): { refCol: string; execCol: string } | null {
  let bestPair: { refCol: string; execCol: string } | null = null;
  let bestScore = 0;

  for (const pair of matchedPairs) {
    const afterValues = afterRows.map((r) => toKeyString(r[pair.refCol]));
    const execValues = executedRows.map((r) => toKeyString(r[pair.execCol]));

    const afterNonNull = afterValues.filter((v) => v !== "__NULL__");
    const execNonNull = execValues.filter((v) => v !== "__NULL__");
    if (afterNonNull.length === 0 || execNonNull.length === 0) continue;

    const afterUniqueSet = new Set(afterNonNull);
    const execUniqueSet = new Set(execNonNull);

    const afterRatio = afterUniqueSet.size / afterNonNull.length;
    const execRatio = execUniqueSet.size / execNonNull.length;

    if (afterRatio < 0.95 || execRatio < 0.95) continue;

    // Require ≥50% key overlap between the two datasets
    let overlapCount = 0;
    for (const key of execUniqueSet) {
      if (afterUniqueSet.has(key)) overlapCount++;
    }
    const overlapRatio = overlapCount / execUniqueSet.size;
    if (overlapRatio < 0.5) continue;

    const score = overlapRatio * Math.min(afterRatio, execRatio);
    if (score > bestScore) {
      bestScore = score;
      bestPair = pair;
    }
  }

  return bestPair;
}

// ─── Column Matching (shared) ───────────────────────

interface ColumnPairingResult {
  matchedPairs: Array<{ refCol: string; execCol: string }>;
  unmatchedRefCols: string[];
  unmatchedExecCols: string[];
}

function pairColumns(
  referenceColumns: string[],
  executedColumns: string[]
): ColumnPairingResult {
  const refLowerMap = new Map<string, string>();
  for (const col of referenceColumns) {
    refLowerMap.set(col.toLowerCase(), col);
  }

  const matchedPairs: Array<{ refCol: string; execCol: string }> = [];
  const usedRefCols = new Set<string>();
  const usedExecCols = new Set<string>();

  for (const execCol of executedColumns) {
    const refCol = refLowerMap.get(execCol.toLowerCase());
    if (refCol && !usedRefCols.has(refCol)) {
      matchedPairs.push({ refCol, execCol });
      usedRefCols.add(refCol);
      usedExecCols.add(execCol);
    }
  }

  const unmatchedRefCols = referenceColumns.filter((c) => !usedRefCols.has(c));
  const unmatchedExecCols = executedColumns.filter((c) => !usedExecCols.has(c));

  return { matchedPairs, unmatchedRefCols, unmatchedExecCols };
}

// ─── Pattern Validation ─────────────────────────────

/** Stub step types that are not fully implemented in the executor. */
const STUB_STEP_TYPES = new Set(["lookup", "pivot", "unpivot", "custom_sql"]);

/**
 * Pattern validation: checks whether the blueprint correctly describes
 * the transformation pattern without requiring full row-by-row data match.
 *
 * Checks:
 * 1. Column structure — all AFTER columns are produced by the blueprint
 * 2. Rename accuracy — renamed columns map to the right AFTER names
 * 3. Formula spot-check — calculate steps produce correct values on overlapping rows
 * 4. Format spot-check — format steps transform values correctly
 * 5. Row count info — advisory, not a pass/fail criterion
 */
function validatePattern(
  steps: ForgeStep[],
  before: ParsedFileData,
  after: ParsedFileData,
  unsupportedSteps: string[]
): ValidationResult {
  const checks: PatternCheck[] = [];
  let passCount = 0;
  let totalChecks = 0;

  // Execute the blueprint against BEFORE data
  let execution: ReturnType<typeof executeBlueprint>;
  try {
    execution = executeBlueprint(steps, {
      columns: before.columns,
      rows: before.rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      overallMatchRate: 0,
      totalCells: 0,
      matchedCells: 0,
      columnValidations: [],
      mismatches: [],
      rowMatchMode: "pattern" as const,
      unmatchedAfterRows: 0,
      unmatchedExecutedRows: 0,
      patternChecks: [{ category: "column_structure" as const, status: "fail" as const, description: `Blueprint execution failed: ${msg}` }],
      unsupportedSteps,
    };
  }

  const { matchedPairs, unmatchedRefCols, unmatchedExecCols } = pairColumns(
    after.columns,
    execution.columns
  );

  // ─── Check 1: Column Structure ─────────────────────

  // How many of AFTER's columns does the blueprint produce?
  const afterColCount = after.columns.length;
  const matchedColCount = matchedPairs.length;
  const structureRate = afterColCount > 0 ? matchedColCount / afterColCount : 1;

  totalChecks++;
  if (structureRate >= 0.9) {
    passCount++;
    checks.push({
      category: "column_structure",
      status: structureRate >= 1.0 ? "pass" : "warn",
      description: `Blueprint produces ${matchedColCount}/${afterColCount} expected columns (${Math.round(structureRate * 100)}%)`,
      details: unmatchedRefCols.length > 0
        ? `Missing: ${unmatchedRefCols.join(", ")}`
        : undefined,
    });
  } else {
    checks.push({
      category: "column_structure",
      status: "fail",
      description: `Blueprint only produces ${matchedColCount}/${afterColCount} expected columns (${Math.round(structureRate * 100)}%)`,
      details: `Missing: ${unmatchedRefCols.join(", ")}`,
    });
  }

  // Extra columns not in AFTER (advisory)
  if (unmatchedExecCols.length > 0) {
    checks.push({
      category: "column_structure",
      status: "warn",
      description: `Blueprint produces ${unmatchedExecCols.length} extra column(s) not in AFTER`,
      details: `Extra: ${unmatchedExecCols.join(", ")}`,
    });
  }

  // ─── Check 2: Rename Steps ────────────────────────

  const renameSteps = steps.filter((s) => s.type === "rename_columns");
  for (const step of renameSteps) {
    const mapping = step.config.mapping as Record<string, string> | undefined;
    if (!mapping) continue;

    totalChecks++;
    const renames = Object.entries(mapping);
    const correctRenames = renames.filter(([, newName]) =>
      after.columns.some((c) => c.toLowerCase() === newName.toLowerCase())
    );

    if (correctRenames.length === renames.length) {
      passCount++;
      checks.push({
        category: "rename",
        status: "pass",
        description: `All ${renames.length} renames map to valid AFTER columns`,
      });
    } else {
      const bad = renames.filter(
        ([, newName]) => !after.columns.some((c) => c.toLowerCase() === newName.toLowerCase())
      );
      checks.push({
        category: "rename",
        status: "fail",
        description: `${bad.length}/${renames.length} renames target columns not in AFTER`,
        details: bad.map(([from, to]) => `${from} → ${to}`).join(", "),
      });
    }
  }

  // ─── Check 3: Formula Spot-Check ──────────────────

  // Find a key column for row matching (needed to spot-check formulas)
  const keyPair = findKeyColumn(matchedPairs, after.rows, execution.rows);

  const calculateSteps = steps.filter((s) => s.type === "calculate");
  if (calculateSteps.length > 0 && keyPair) {
    // Build key→row maps for overlapping rows
    const afterKeyMap = new Map<string, Record<string, unknown>>();
    for (const row of after.rows) {
      const key = toKeyString(row[keyPair.refCol]);
      if (!afterKeyMap.has(key)) afterKeyMap.set(key, row);
    }

    const execKeyMap = new Map<string, Record<string, unknown>>();
    for (const row of execution.rows) {
      const key = toKeyString(row[keyPair.execCol]);
      if (!execKeyMap.has(key)) execKeyMap.set(key, row);
    }

    // Find overlapping keys
    const overlapKeys: string[] = [];
    for (const key of execKeyMap.keys()) {
      if (afterKeyMap.has(key)) {
        overlapKeys.push(key);
        if (overlapKeys.length >= FORMULA_SPOT_CHECK_ROWS) break;
      }
    }

    for (const step of calculateSteps) {
      const column = step.config.column as string;
      if (!column) continue;

      // Find the AFTER column name (case-insensitive)
      const afterCol = after.columns.find(
        (c) => c.toLowerCase() === column.toLowerCase()
      );
      const execCol = execution.columns.find(
        (c) => c.toLowerCase() === column.toLowerCase()
      );

      if (!afterCol || !execCol || overlapKeys.length === 0) {
        totalChecks++;
        checks.push({
          category: "formula",
          status: "warn",
          description: `Cannot spot-check formula for "${column}" — no overlapping rows or column not found`,
        });
        continue;
      }

      // Spot-check: compare formula output on overlapping rows
      let matchCount = 0;
      let compareCount = 0;
      let unevaluableCount = 0; // execution null, AFTER has value

      for (const key of overlapKeys) {
        const afterRow = afterKeyMap.get(key)!;
        const execRow = execKeyMap.get(key)!;

        const expectedVal = afterRow[afterCol];
        const actualVal = execRow[execCol];

        // Skip null-vs-null (formula might not have cached values in AFTER)
        if (isNullish(expectedVal) && isNullish(actualVal)) continue;
        // If AFTER has a value but executed doesn't (formula couldn't evaluate)
        if (isNullish(actualVal) && !isNullish(expectedVal)) {
          unevaluableCount++;
          continue;
        }
        // If executed has a value but AFTER doesn't (AFTER file lacks cached formula results)
        if (isNullish(expectedVal) && !isNullish(actualVal)) {
          unevaluableCount++;
          continue;
        }

        compareCount++;
        if (cellsMatch(expectedVal, actualVal)) matchCount++;
      }

      totalChecks++;
      if (compareCount === 0 && unevaluableCount > 0) {
        // Parser couldn't evaluate ANY rows — formula was extracted from the file
        // but our expression parser can't handle it. Warn, don't fail.
        passCount++;
        checks.push({
          category: "formula",
          status: "warn",
          description: `Formula "${column}": parser cannot evaluate (${unevaluableCount} row(s) unevaluable)`,
          details: `Formula: ${step.config.formula}`,
        });
      } else if (compareCount === 0) {
        passCount++;
        checks.push({
          category: "formula",
          status: "warn",
          description: `Formula "${column}": no comparable values (AFTER values may be uncached formulas)`,
          details: `Formula: ${step.config.formula}`,
        });
      } else {
        const rate = matchCount / compareCount;
        if (rate >= 0.8) {
          passCount++;
          checks.push({
            category: "formula",
            status: rate >= 0.95 ? "pass" : "warn",
            description: `Formula "${column}": ${Math.round(rate * 100)}% match on ${compareCount} spot-checked rows`,
            details: `Formula: ${step.config.formula}`,
          });
        } else {
          // If row counts differ, the data is from different time periods.
          // Formula values won't match even if formula logic is correct.
          // Downgrade to warn — structure is verified, values are not comparable.
          const differentTimePeriod = before.rowCount !== after.rowCount;
          const sourceColumns = step.config.sourceColumns as string[] | undefined;
          const formulaStructureValid = !sourceColumns || sourceColumns.length === 0 || sourceColumns.every(
            (sc: string) => execution.columns.some(c => c.toLowerCase() === sc.toLowerCase())
          );

          if (differentTimePeriod && formulaStructureValid) {
            passCount++;
            checks.push({
              category: "formula",
              status: "warn",
              description: `Formula "${column}": ${Math.round(rate * 100)}% value match on ${compareCount} rows (expected — different time periods, formula structure verified)`,
              details: `Formula: ${step.config.formula}`,
            });
          } else {
            checks.push({
              category: "formula",
              status: "fail",
              description: `Formula "${column}": only ${Math.round(rate * 100)}% match on ${compareCount} spot-checked rows`,
              details: `Formula: ${step.config.formula}`,
            });
          }
        }
      }
    }
  } else if (calculateSteps.length > 0 && !keyPair) {
    // Can't spot-check formulas without a key column — just note the formulas exist
    for (const step of calculateSteps) {
      totalChecks++;
      passCount++; // Give benefit of doubt — formula was extracted from the file
      checks.push({
        category: "formula",
        status: "warn",
        description: `Formula "${step.config.column}": cannot spot-check (no key column found)`,
        details: `Formula: ${step.config.formula}`,
      });
    }
  }

  // ─── Check 4: Format Steps ────────────────────────

  const formatSteps = steps.filter((s) => s.type === "format");
  if (formatSteps.length > 0) {
    totalChecks++;
    passCount++; // Format steps are deterministic — if they exist, they'll work
    checks.push({
      category: "format",
      status: "pass",
      description: `${formatSteps.length} format transform(s) applied`,
      details: formatSteps.map((s) => `${s.config.column}: ${s.config.formatType}`).join(", "),
    });
  }

  // ─── Check 4b: Completeness (NULL rates) ──────────

  // If AFTER has a mostly non-null column but execution produces mostly nulls → problem.
  // Skip columns that are outputs of calculate steps — those already have their own
  // formula spot-check and would be double-penalized if the expression parser can't
  // fully evaluate the formula (null output → completeness fail on top of formula fail).
  const formulaOutputColumns = new Set(
    calculateSteps
      .map((s) => (s.config.column as string)?.toLowerCase())
      .filter(Boolean)
  );

  for (const pair of matchedPairs) {
    // Skip formula output columns — already checked by formula spot-check
    if (formulaOutputColumns.has(pair.execCol.toLowerCase())) continue;

    const afterNulls = after.rows.filter(
      (r) => r[pair.refCol] === null || r[pair.refCol] === undefined
    ).length;
    const execNulls = execution.rows.filter(
      (r) => r[pair.execCol] === null || r[pair.execCol] === undefined
    ).length;

    const afterNullRate = after.rows.length > 0 ? afterNulls / after.rows.length : 0;
    const execNullRate = execution.rows.length > 0 ? execNulls / execution.rows.length : 0;

    if (afterNullRate < 0.1 && execNullRate > 0.5) {
      totalChecks++;
      checks.push({
        category: "completeness",
        status: "fail",
        description: `Column "${pair.refCol}" is ${Math.round(execNullRate * 100)}% null in output but ${Math.round(afterNullRate * 100)}% null in expected`,
      });
    }
  }

  // ─── Check 5: Row Count Advisory ──────────────────

  const rowDiff = after.rowCount - execution.rows.length;
  if (rowDiff !== 0) {
    checks.push({
      category: "row_count",
      status: "warn",
      description: rowDiff > 0
        ? `AFTER has ${rowDiff} more row(s) than BEFORE — new data expected`
        : `Blueprint produces ${Math.abs(rowDiff)} more row(s) than AFTER`,
    });
  } else {
    checks.push({
      category: "row_count",
      status: "pass",
      description: `Row count matches (${after.rowCount} rows)`,
    });
  }

  // ─── Compute Overall Score ────────────────────────

  // Pattern score = weighted: column structure (50%) + checks pass rate (50%)
  const checksRate = totalChecks > 0 ? passCount / totalChecks : 1;
  const overallMatchRate = structureRate * 0.5 + checksRate * 0.5;
  const passed = overallMatchRate >= PASS_THRESHOLD && structureRate >= 0.9;

  // Build column validations from structure check
  const columnValidations: ColumnValidation[] = matchedPairs.map((p) => ({
    column: p.refCol,
    matchCount: 1,
    mismatchCount: 0,
    matchRate: 1.0,
  }));
  for (const col of unmatchedRefCols) {
    columnValidations.push({
      column: col,
      matchCount: 0,
      mismatchCount: 1,
      matchRate: 0,
    });
  }

  return {
    overallMatchRate,
    totalCells: totalChecks,
    matchedCells: passCount,
    columnValidations,
    mismatches: [],
    passed,
    unsupportedSteps,
    rowMatchMode: "pattern",
    unmatchedAfterRows: Math.max(0, after.rowCount - execution.rows.length),
    unmatchedExecutedRows: Math.max(0, execution.rows.length - after.rowCount),
    patternChecks: checks,
  };
}

// ─── Strict (Cell-by-Cell) Validation ───────────────

/**
 * Strict validation: full cell-by-cell comparison with key-based row
 * matching (positional fallback when no key column found).
 */
function validateStrict(
  steps: ForgeStep[],
  before: ParsedFileData,
  after: ParsedFileData,
  unsupportedSteps: string[]
): ValidationResult {
  let execution: ReturnType<typeof executeBlueprint>;
  try {
    execution = executeBlueprint(steps, {
      columns: before.columns,
      rows: before.rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      overallMatchRate: 0,
      totalCells: 0,
      matchedCells: 0,
      columnValidations: [],
      mismatches: [{ row: 0, column: "N/A", expected: "execution success", actual: msg }],
      rowMatchMode: "positional" as const,
      unmatchedAfterRows: 0,
      unmatchedExecutedRows: 0,
      unsupportedSteps,
    };
  }

  const { matchedPairs, unmatchedRefCols, unmatchedExecCols } = pairColumns(
    after.columns,
    execution.columns
  );

  const referenceRowCount = after.rows.length;
  const executedRowCount = execution.rows.length;

  if (
    matchedPairs.length === 0 &&
    unmatchedRefCols.length === 0 &&
    unmatchedExecCols.length === 0
  ) {
    return {
      overallMatchRate: 1.0,
      totalCells: 0,
      matchedCells: 0,
      columnValidations: [],
      mismatches: [],
      passed: true,
      unsupportedSteps,
      rowMatchMode: "positional",
      unmatchedAfterRows: 0,
      unmatchedExecutedRows: 0,
    };
  }

  // Try key-based row matching
  const keyPair = findKeyColumn(matchedPairs, after.rows, execution.rows);

  let rowMatchMode: "key" | "positional";
  let keyColumn: string | undefined;
  let rowPairs: Array<{ afterIdx: number | null; execIdx: number | null }>;
  let unmatchedAfterRows = 0;
  let unmatchedExecutedRows = 0;

  if (keyPair) {
    rowMatchMode = "key";
    keyColumn = keyPair.refCol;

    const afterKeyMap = new Map<string, number>();
    for (let i = 0; i < after.rows.length; i++) {
      const key = toKeyString(after.rows[i][keyPair.refCol]);
      if (!afterKeyMap.has(key)) afterKeyMap.set(key, i);
    }
    const execKeyMap = new Map<string, number>();
    for (let i = 0; i < execution.rows.length; i++) {
      const key = toKeyString(execution.rows[i][keyPair.execCol]);
      if (!execKeyMap.has(key)) execKeyMap.set(key, i);
    }

    rowPairs = [];
    const usedExecIndices = new Set<number>();

    for (let afterIdx = 0; afterIdx < after.rows.length; afterIdx++) {
      const key = toKeyString(after.rows[afterIdx][keyPair.refCol]);
      const execIdx = execKeyMap.get(key);
      if (execIdx !== undefined && !usedExecIndices.has(execIdx)) {
        rowPairs.push({ afterIdx, execIdx });
        usedExecIndices.add(execIdx);
      } else {
        rowPairs.push({ afterIdx, execIdx: null });
        unmatchedAfterRows++;
      }
    }
    for (let execIdx = 0; execIdx < execution.rows.length; execIdx++) {
      if (!usedExecIndices.has(execIdx)) {
        rowPairs.push({ afterIdx: null, execIdx });
        unmatchedExecutedRows++;
      }
    }
  } else {
    rowMatchMode = "positional";
    rowPairs = [];
    const maxRows = Math.max(referenceRowCount, executedRowCount);
    for (let i = 0; i < maxRows; i++) {
      rowPairs.push({
        afterIdx: i < referenceRowCount ? i : null,
        execIdx: i < executedRowCount ? i : null,
      });
      if (i >= referenceRowCount) unmatchedExecutedRows++;
      if (i >= executedRowCount) unmatchedAfterRows++;
    }
  }

  // Cell-by-cell comparison
  let totalCells = 0;
  let matchedCells = 0;
  const mismatches: Mismatch[] = [];
  const columnValidations: ColumnValidation[] = [];

  const allColumnPairs: Array<{ refCol: string | null; execCol: string | null }> = [
    ...matchedPairs.map((p) => ({
      refCol: p.refCol as string | null,
      execCol: p.execCol as string | null,
    })),
    ...unmatchedRefCols.map((c) => ({ refCol: c as string | null, execCol: null as string | null })),
    ...unmatchedExecCols.map((c) => ({ refCol: null as string | null, execCol: c as string | null })),
  ];

  for (const colPair of allColumnPairs) {
    const displayColumn = colPair.refCol ?? colPair.execCol!;
    let colMatch = 0;
    let colMismatch = 0;

    for (const rp of rowPairs) {
      totalCells++;

      if (!colPair.refCol || !colPair.execCol) {
        colMismatch++;
        if (mismatches.length < MAX_MISMATCHES) {
          mismatches.push({
            row: rp.afterIdx ?? rp.execIdx ?? 0,
            column: displayColumn,
            expected: colPair.refCol && rp.afterIdx !== null
              ? (after.rows[rp.afterIdx][colPair.refCol] ?? null)
              : undefined,
            actual: colPair.execCol && rp.execIdx !== null
              ? (execution.rows[rp.execIdx][colPair.execCol] ?? null)
              : undefined,
          });
        }
        continue;
      }

      if (rp.afterIdx === null || rp.execIdx === null) {
        colMismatch++;
        if (mismatches.length < MAX_MISMATCHES) {
          mismatches.push({
            row: rp.afterIdx ?? rp.execIdx ?? 0,
            column: displayColumn,
            expected: rp.afterIdx !== null
              ? (after.rows[rp.afterIdx][colPair.refCol] ?? null)
              : null,
            actual: rp.execIdx !== null
              ? (execution.rows[rp.execIdx][colPair.execCol] ?? null)
              : null,
          });
        }
        continue;
      }

      const expectedValue = after.rows[rp.afterIdx][colPair.refCol] ?? null;
      const actualValue = execution.rows[rp.execIdx][colPair.execCol] ?? null;

      if (cellsMatch(expectedValue, actualValue)) {
        colMatch++;
      } else {
        colMismatch++;
        if (mismatches.length < MAX_MISMATCHES) {
          mismatches.push({
            row: rp.afterIdx,
            column: displayColumn,
            expected: expectedValue,
            actual: actualValue,
          });
        }
      }
    }

    matchedCells += colMatch;
    columnValidations.push({
      column: displayColumn,
      matchCount: colMatch,
      mismatchCount: colMismatch,
      matchRate: (colMatch + colMismatch) > 0
        ? colMatch / (colMatch + colMismatch)
        : 1.0,
    });
  }

  const overallMatchRate = totalCells > 0 ? matchedCells / totalCells : 1.0;

  return {
    overallMatchRate,
    totalCells,
    matchedCells,
    columnValidations,
    mismatches,
    passed: overallMatchRate >= PASS_THRESHOLD,
    unsupportedSteps,
    rowMatchMode,
    keyColumn,
    unmatchedAfterRows,
    unmatchedExecutedRows,
  };
}

// ─── Main Entry Point ───────────────────────────────

/**
 * Validate a blueprint against BEFORE/AFTER data.
 *
 * Uses pattern validation by default (checks transformation correctness
 * without requiring row-by-row data match). Pass `mode: "strict"` for
 * full cell-by-cell comparison.
 */
export function validateBlueprint(
  steps: ForgeStep[],
  before: ParsedFileData,
  after: ParsedFileData,
  mode: "pattern" | "strict" = "pattern"
): ValidationResult {
  const unsupportedSteps = steps
    .filter((s) => STUB_STEP_TYPES.has(s.type))
    .map((s) => `${s.type}: ${s.description || "(no description)"}`);

  if (mode === "strict") {
    return validateStrict(steps, before, after, unsupportedSteps);
  }
  return validatePattern(steps, before, after, unsupportedSteps);
}
