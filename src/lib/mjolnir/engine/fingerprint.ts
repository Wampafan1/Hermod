/**
 * Mjolnir — Column fingerprinting engine.
 *
 * Analyzes column data to infer types, detect date patterns, compute
 * content hashes, and build structural fingerprints. Uses Node crypto
 * for SHA-256 hashing (no external deps).
 */

import { createHash } from "crypto";
import type { ColumnFingerprint, InferredDataType } from "../types";

// ─── Date Detection Patterns ─────────────────────────

interface DatePatternDef {
  regex: RegExp;
  label: string;
}

/**
 * Ordered list of date pattern definitions. Checked in priority order;
 * the first pattern that matches >60% of non-null values wins.
 */
const DATE_PATTERNS: DatePatternDef[] = [
  // ISO: 2024-01-15T10:30:00Z or 2024-01-15T10:30:00+05:00 etc.
  {
    regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
    label: "YYYY-MM-DDTHH:mm:ssZ",
  },
  // ISO date only: 2024-01-15
  {
    regex: /^\d{4}-\d{2}-\d{2}$/,
    label: "YYYY-MM-DD",
  },
  // US with 4-digit year: 01/15/2024 or 1/15/2024
  {
    regex: /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    label: "MM/DD/YYYY",
  },
  // EU with dots: 15.01.2024
  {
    regex: /^\d{1,2}\.\d{1,2}\.\d{4}$/,
    label: "DD.MM.YYYY",
  },
  // Month name short: 15-Jan-2024
  {
    regex: /^\d{1,2}-[A-Za-z]{3}-\d{4}$/,
    label: "DD-MMM-YYYY",
  },
  // Month name format: Jan 15, 2024
  {
    regex: /^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/,
    label: "MMM DD, YYYY",
  },
];

/**
 * Check if a single value looks like a parseable date.
 * We use the Date constructor as a secondary validation after regex matching.
 */
function isValidDate(value: string): boolean {
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ─── Type Inference ──────────────────────────────────

/**
 * Infer the data type of a column from its values.
 *
 * Rules:
 * - If all non-null values are empty, return "empty"
 * - If >60% of non-null values match a single type, return that type
 * - Otherwise return "mixed"
 */
export function inferDataType(values: unknown[]): InferredDataType {
  const nonNull = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );

  if (nonNull.length === 0) {
    return "empty";
  }

  let numberCount = 0;
  let booleanCount = 0;
  let dateCount = 0;
  let stringCount = 0;

  for (const v of nonNull) {
    if (v instanceof Date) {
      if (!isNaN(v.getTime())) {
        dateCount++;
      } else {
        stringCount++;
      }
      continue;
    }

    if (typeof v === "boolean") {
      booleanCount++;
      continue;
    }

    if (typeof v === "number" || (typeof v === "bigint")) {
      numberCount++;
      continue;
    }

    const str = String(v).trim();

    // Check boolean strings
    if (/^(true|false)$/i.test(str)) {
      booleanCount++;
      continue;
    }

    // Check numeric strings (including negative and decimal)
    if (/^-?\d+(\.\d+)?$/.test(str) || /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(str)) {
      numberCount++;
      continue;
    }

    // Check date patterns
    let isDate = false;
    for (const pattern of DATE_PATTERNS) {
      if (pattern.regex.test(str)) {
        isDate = true;
        break;
      }
    }
    // Fallback: try Date constructor for values that look date-ish
    if (!isDate && isValidDate(str) && /\d{4}/.test(str)) {
      isDate = true;
    }

    if (isDate) {
      dateCount++;
      continue;
    }

    stringCount++;
  }

  const total = nonNull.length;
  const threshold = 0.6;

  if (numberCount / total >= threshold) return "number";
  if (booleanCount / total >= threshold) return "boolean";
  if (dateCount / total >= threshold) return "date";
  if (stringCount / total >= threshold) return "string";

  return "mixed";
}

// ─── Date Pattern Detection ──────────────────────────

/**
 * Detect the date format pattern for a column's values.
 *
 * Requires at least 5 non-null values to make a determination.
 * Returns the pattern label if >60% of non-null values match it,
 * otherwise undefined.
 */
export function detectDatePattern(values: unknown[]): string | undefined {
  const nonNull = values
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v).trim());

  if (nonNull.length < 5) {
    return undefined;
  }

  for (const pattern of DATE_PATTERNS) {
    const matchCount = nonNull.filter((s) => pattern.regex.test(s)).length;
    if (matchCount / nonNull.length > 0.6) {
      return pattern.label;
    }
  }

  return undefined;
}

// ─── Sample Hash ─────────────────────────────────────

/**
 * Compute a SHA-256 hash of the sorted unique non-null stringified values.
 *
 * This provides a content-based fingerprint that can be used to match
 * columns across two datasets even if they have different names.
 */
export function computeSampleHash(values: unknown[]): string {
  const unique = Array.from(
    new Set(
      values
        .filter((v) => v !== null && v !== undefined)
        .map((v) => (v instanceof Date ? v.toISOString() : String(v)))
    )
  ).sort();

  const content = unique.join("\x00"); // null byte separator
  return createHash("sha256").update(content).digest("hex");
}

// ─── Column Fingerprinting ───────────────────────────

/**
 * Build a full fingerprint for a single column.
 */
export function fingerprintColumn(
  name: string,
  values: unknown[]
): ColumnFingerprint {
  const total = values.length;
  const nullCount = values.filter(
    (v) => v === null || v === undefined || v === ""
  ).length;
  const nonNull = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );

  const dataType = inferDataType(values);
  const nullRate = total > 0 ? nullCount / total : 0;
  const uniqueValues = new Set(nonNull.map((v) => String(v)));
  const cardinality = uniqueValues.size;
  const sampleHash = computeSampleHash(values);

  const fingerprint: ColumnFingerprint = {
    name,
    dataType,
    nullRate: Math.round(nullRate * 1000) / 1000, // 3 decimal places
    cardinality,
    sampleHash,
  };

  // Top-N values for low-cardinality columns (cardinality < 100)
  if (cardinality > 0 && cardinality < 100 && nonNull.length > 0) {
    const freq = new Map<string, number>();
    for (const v of nonNull) {
      const key = String(v);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const sorted = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    fingerprint.topValues = sorted.map(([value, count]) => ({ value, count }));
  }

  // Type-specific stats
  if (dataType === "number") {
    const nums = nonNull
      .map((v) => {
        const s = String(v).replace(/,/g, "");
        return parseFloat(s);
      })
      .filter((n) => !isNaN(n));

    if (nums.length > 0) {
      fingerprint.minValue = nums.reduce((a, b) => (a < b ? a : b), nums[0]);
      fingerprint.maxValue = nums.reduce((a, b) => (a > b ? a : b), nums[0]);
    }
  } else if (dataType === "string" || dataType === "mixed") {
    const lengths = nonNull.map((v) => String(v).length);
    if (lengths.length > 0) {
      fingerprint.avgLength =
        Math.round(
          (lengths.reduce((sum, l) => sum + l, 0) / lengths.length) * 100
        ) / 100;
    }
  } else if (dataType === "date") {
    const pattern = detectDatePattern(values);
    if (pattern) {
      fingerprint.datePattern = pattern;
    }

    // Min/max by actual date value
    const dates = nonNull
      .map((v) => ({ original: String(v), parsed: new Date(String(v)) }))
      .filter((d) => !isNaN(d.parsed.getTime()))
      .sort((a, b) => a.parsed.getTime() - b.parsed.getTime());

    if (dates.length > 0) {
      fingerprint.minValue = dates[0].original;
      fingerprint.maxValue = dates[dates.length - 1].original;
    }
  }

  return fingerprint;
}

/**
 * Fingerprint all columns in a dataset.
 */
export function fingerprintAllColumns(
  columns: string[],
  rows: Record<string, unknown>[]
): ColumnFingerprint[] {
  return columns.map((col) => {
    const values = rows.map((row) => row[col]);
    return fingerprintColumn(col, values);
  });
}
