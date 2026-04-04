/**
 * Primary Key Detection — Analyzes sample rows to find the best natural key.
 *
 * Tests single columns first, then 2-column combos, then 3-column combos.
 * Returns the simplest key that achieves 100% uniqueness (or closest to it).
 */

export interface PKDetectionResult {
  columns: string[];
  type: "single" | "composite" | "synthetic";
  confidence: "high" | "medium" | "low";
  reason: string;
  uniquenessScore: number; // 0.0 – 1.0
}

const ID_PATTERNS = /^id$|_id$|Id$|^uuid$|^key$|^code$|^sku$|^number$/i;

export function detectPrimaryKey(
  rows: Record<string, unknown>[],
  columns: { name: string; dataType: string }[]
): PKDetectionResult {
  if (rows.length === 0) {
    return {
      columns: [],
      type: "synthetic",
      confidence: "low",
      reason: "No sample rows to analyze",
      uniquenessScore: 0,
    };
  }

  // Phase 1: Single columns — prioritize ID-like names
  const idCols = columns.filter((c) => ID_PATTERNS.test(c.name));
  const otherCols = columns.filter((c) => !ID_PATTERNS.test(c.name));

  for (const col of [...idCols, ...otherCols]) {
    const values = rows.map((r) => r[col.name]);
    const nonNull = values.filter((v) => v != null && v !== "");
    if (nonNull.length < rows.length) continue; // has nulls — skip as PK candidate

    const unique = new Set(nonNull.map(String));
    if (unique.size === rows.length) {
      return {
        columns: [col.name],
        type: "single",
        confidence: "high",
        reason: `${col.name} is unique across all ${rows.length} sample rows`,
        uniquenessScore: 1.0,
      };
    }
  }

  // Phase 2: 2-column combinations
  const colNames = columns.map((c) => c.name);
  const combos2 = generateCombinations(colNames, 2);
  for (const combo of combos2) {
    if (isUniqueCombo(rows, combo)) {
      return {
        columns: combo,
        type: "composite",
        confidence: "high",
        reason: `${combo.join(" + ")} combination is unique across all ${rows.length} sample rows`,
        uniquenessScore: 1.0,
      };
    }
  }

  // Phase 3: 3-column combinations (limit to top 30 most likely)
  const combos3 = generateCombinations(colNames, 3).slice(0, 30);
  for (const combo of combos3) {
    if (isUniqueCombo(rows, combo)) {
      return {
        columns: combo,
        type: "composite",
        confidence: "medium",
        reason: `${combo.join(" + ")} combination is unique (3-column composite)`,
        uniquenessScore: 1.0,
      };
    }
  }

  // Phase 4: No natural key — recommend synthetic from highest cardinality columns
  const ranked = columns
    .map((c) => ({
      name: c.name,
      cardinality: new Set(rows.map((r) => String(r[c.name] ?? ""))).size,
    }))
    .sort((a, b) => b.cardinality - a.cardinality);

  const topCols = ranked.slice(0, 3).map((c) => c.name);
  const score =
    new Set(rows.map((r) => topCols.map((c) => String(r[c] ?? "")).join("||")))
      .size / rows.length;

  return {
    columns: topCols,
    type: "synthetic",
    confidence: "low",
    reason: `No unique natural key found. Recommend synthetic key from ${topCols.join(" + ")}`,
    uniquenessScore: score,
  };
}

/** Test uniqueness for a given column combination. */
export function testUniqueness(
  rows: Record<string, unknown>[],
  columns: string[]
): number {
  if (rows.length === 0) return 0;
  const composites = rows.map((r) =>
    columns.map((c) => String(r[c] ?? "")).join("||")
  );
  return new Set(composites).size / rows.length;
}

/** Generate a __hermod_pk value from a row given the PK columns. */
export function buildPkValue(
  row: Record<string, unknown>,
  pkColumns: string[]
): string {
  return pkColumns.map((c) => String(row[c] ?? "")).join("_");
}

function isUniqueCombo(rows: Record<string, unknown>[], combo: string[]): boolean {
  const values = rows.map((r) =>
    combo.map((c) => String(r[c] ?? "")).join("||")
  );
  return new Set(values).size === rows.length;
}

function generateCombinations(items: string[], size: number): string[][] {
  if (size === 1) return items.map((i) => [i]);
  const result: string[][] = [];
  for (let i = 0; i < items.length - size + 1; i++) {
    const rest = generateCombinations(items.slice(i + 1), size - 1);
    for (const combo of rest) {
      result.push([items[i], ...combo]);
    }
  }
  return result;
}
