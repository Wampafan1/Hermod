/**
 * Mjolnir — Input schema validation (pre-execution safety gate).
 *
 * Validates that the columns in incoming data satisfy the blueprint's
 * expected source schema. Uses multi-pass matching (exact, case-insensitive,
 * normalized) to handle column config renames like SOU_OnHand → SOU On Hand.
 */

import type { BlueprintData } from "../types";

// ─── Public Types ───────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean;
  /** True when sourceSchema was null — validation was skipped */
  skipped?: boolean;
  /** Columns expected by blueprint but missing from input */
  missingColumns: string[];
  /** Columns in input but not in blueprint schema (allowed, informational) */
  extraColumns: string[];
  /** Human-readable error message (only when valid === false) */
  error?: string;
}

// ─── Helpers ────────────────────────────────────────

/**
 * Normalize a column name for fuzzy matching:
 * strip underscores, hyphens, spaces → lowercase.
 * e.g. "SOU_OnHand" → "souonhand", "SOU On Hand" → "souonhand"
 */
function normalize(col: string): string {
  return col.replace(/[_\-\s]+/g, "").toLowerCase();
}

// ─── Main Entry Point ───────────────────────────────

/**
 * Validate that input columns satisfy a blueprint's expected source schema.
 *
 * Uses 3-pass matching (like structural diff) to be resilient to column
 * config renames:
 *   1. Exact match
 *   2. Case-insensitive match
 *   3. Normalized match (SOU_OnHand ↔ SOU On Hand)
 *
 * Rules:
 * - All schema columns must match an input column via any pass
 * - Extra columns in input are allowed (superset is OK)
 * - Null schema → skip validation (blueprint created without schema info)
 */
export function validateInputSchema(
  sourceSchema: BlueprintData["sourceSchema"],
  inputColumns: string[]
): SchemaValidationResult {
  if (!sourceSchema) {
    return { valid: true, skipped: true, missingColumns: [], extraColumns: [] };
  }

  // Build lookup sets for each matching pass
  const inputExact = new Set(inputColumns);
  const inputLower = new Set(inputColumns.map((c) => c.toLowerCase()));
  const inputNormalized = new Set(inputColumns.map(normalize));

  const missingColumns: string[] = [];
  for (const schemaCol of sourceSchema.columns) {
    // Pass 1: exact
    if (inputExact.has(schemaCol)) continue;
    // Pass 2: case-insensitive
    if (inputLower.has(schemaCol.toLowerCase())) continue;
    // Pass 3: normalized (strips _, -, spaces)
    if (inputNormalized.has(normalize(schemaCol))) continue;

    missingColumns.push(schemaCol);
  }

  // Extra columns: input columns not in schema (informational)
  const schemaNormalized = new Set(sourceSchema.columns.map(normalize));
  const extraColumns: string[] = inputColumns.filter(
    (col) => !schemaNormalized.has(normalize(col))
  );

  const valid = missingColumns.length === 0;
  const error = valid
    ? undefined
    : `Blueprint expects columns not found in input: ${missingColumns.join(", ")}`;

  return { valid, missingColumns, extraColumns, error };
}
