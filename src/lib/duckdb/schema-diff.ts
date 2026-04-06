/**
 * Schema drift detection — canonical location.
 *
 * Compares a new file's profiled schema against a saved schema snapshot
 * to detect added/removed/type-changed columns. Used by both Connections
 * (file uploads) and Gates (push validation).
 */

import type { AnalyzedColumn } from "./file-analyzer";
import { toHermodType } from "./type-mapper";

// ─── Types ──────────────────────────────────────────

export interface SavedColumn {
  name: string;
  duckdbType: string;
  inferredType: string;
  nullable: boolean;
}

export interface SchemaDiff {
  added: Array<{ name: string; type: string }>;
  removed: Array<{ name: string; type: string }>;
  typeChanged: Array<{ name: string; oldType: string; newType: string }>;
}

export interface DriftResult {
  hasDrift: boolean;
  diff: SchemaDiff;
}

// ─── Type Coercion Tolerance ────────────────────────

/**
 * Determine if two types are compatible enough to NOT flag as drift.
 * E.g., INTEGER ↔ BIGINT is fine, INTEGER ↔ VARCHAR is not.
 */
function typesAreCompatible(savedType: string, newType: string): boolean {
  if (savedType === newType) return true;

  const savedHermod = toHermodType(savedType);
  const newHermod = toHermodType(newType);

  // Same Hermod type family → compatible
  if (savedHermod === newHermod) return true;

  // INTEGER ↔ FLOAT is tolerable (widening)
  if (
    (savedHermod === "INTEGER" && newHermod === "FLOAT") ||
    (savedHermod === "FLOAT" && newHermod === "INTEGER")
  ) {
    return true;
  }

  return false;
}

// ─── Diff Engine ────────────────────────────────────

export function computeSchemaDiff(
  savedColumns: SavedColumn[],
  newColumns: AnalyzedColumn[]
): DriftResult {
  const diff: SchemaDiff = { added: [], removed: [], typeChanged: [] };

  // Build lookup maps (case-insensitive)
  const savedMap = new Map<string, SavedColumn>();
  for (const col of savedColumns) {
    savedMap.set(col.name.toLowerCase(), col);
  }

  const newMap = new Map<string, AnalyzedColumn>();
  for (const col of newColumns) {
    newMap.set(col.name.toLowerCase(), col);
  }

  // Check for added columns (in new file but not in saved)
  for (const col of newColumns) {
    if (!savedMap.has(col.name.toLowerCase())) {
      diff.added.push({ name: col.name, type: col.duckdbType });
    }
  }

  // Check for removed columns (in saved but not in new file)
  for (const col of savedColumns) {
    if (!newMap.has(col.name.toLowerCase())) {
      diff.removed.push({ name: col.name, type: col.duckdbType });
    }
  }

  // Check for type changes (in both, but different types)
  for (const col of newColumns) {
    const saved = savedMap.get(col.name.toLowerCase());
    if (saved && !typesAreCompatible(saved.duckdbType, col.duckdbType)) {
      diff.typeChanged.push({
        name: col.name,
        oldType: saved.duckdbType,
        newType: col.duckdbType,
      });
    }
  }

  // Only added columns and type changes are blocking drift.
  // Removed columns (destination has them, file does not) are harmless —
  // they get NULL for inserts and stay unchanged for updates.
  const hasDrift =
    diff.added.length > 0 ||
    diff.typeChanged.length > 0;

  return { hasDrift, diff };
}
