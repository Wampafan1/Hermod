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
function normalizedDuckdbType(type: string): string {
  return type.toUpperCase().replace(/\(.*\)/, "").trim();
}

function isIntegerDuckdbType(type: string): boolean {
  return toHermodType(type) === "INTEGER";
}

function isDateOrDateStringDuckdbType(type: string): boolean {
  const hermod = toHermodType(type);
  return hermod === "TIMESTAMP" || hermod === "STRING";
}

export function isDateLikeColumnName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    /\b(date|dt|eta|etd|arrival|departure|departures|posted|shipped|delivered)\b/.test(normalized) ||
    /\b(created|updated|modified) at\b/.test(normalized)
  );
}

function isDateLikeSample(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\d{4}-\d{1,2}-\d{1,2}(?:[t\s].*)?$/i.test(trimmed) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed) ||
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(trimmed)
  );
}

function hasDateLikeValueProfile(column: AnalyzedColumn): boolean {
  const samples = column.sampleValues ?? [];
  if (samples.length === 0) return true;

  const dateLikeCount = samples.filter(isDateLikeSample).length;
  return dateLikeCount / samples.length >= 0.6;
}

function isExcelSerialDateCompatibility(savedType: string, newColumn: AnalyzedColumn): boolean {
  if (!isIntegerDuckdbType(savedType)) return false;
  if (!isDateOrDateStringDuckdbType(newColumn.duckdbType)) return false;
  if (!isDateLikeColumnName(newColumn.name)) return false;
  return toHermodType(newColumn.duckdbType) === "TIMESTAMP" || hasDateLikeValueProfile(newColumn);
}

function typesAreCompatible(savedType: string, newColumn: AnalyzedColumn): boolean {
  const newType = newColumn.duckdbType;
  if (normalizedDuckdbType(savedType) === normalizedDuckdbType(newType)) return true;

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

  if (isExcelSerialDateCompatibility(savedType, newColumn)) {
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
    if (saved && !typesAreCompatible(saved.duckdbType, col)) {
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
