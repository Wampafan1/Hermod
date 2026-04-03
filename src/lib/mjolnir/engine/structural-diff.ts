/**
 * Mjolnir — Structural diff engine (Phase 1: deterministic).
 *
 * Compares two ParsedFileData snapshots (before/after) and produces a
 * StructuralDiffResult describing column matches, row changes, detected
 * transformations, deterministic forge steps, and ambiguous cases
 * requiring AI resolution.
 */

import type {
  AmbiguousCase,
  ColumnMatch,
  ForgeStep,
  FormatChange,
  ParsedFileData,
  StructuralDiffResult,
} from "../types";

// ─── Levenshtein Distance ────────────────────────────

/**
 * Standard dynamic programming Levenshtein distance.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Early exit: callers only care about distance <= 2
  if (Math.abs(m - n) > 2) return 3;

  // Two-row rolling array: O(n) space instead of O(m*n)
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,     // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ─── Column Name Normalization ───────────────────────

/**
 * Normalize a column name for comparison by stripping separators and lowercasing.
 * "SOU_OnHand" → "souonhand", "SOU On Hand" → "souonhand", "first-name" → "firstname"
 */
export function normalizeColumnName(name: string): string {
  return name
    .replace(/[_\-\s]+/g, "") // strip underscores, hyphens, spaces
    .toLowerCase();
}

// ─── Column Matching ─────────────────────────────────

/**
 * Match columns between before and after datasets using a cascading strategy:
 * 1. Exact name match (confidence 1.0)
 * 2. Case-insensitive match (confidence 0.95)
 * 3. Levenshtein distance <= 2, name length > 4 (confidence 0.7-0.9)
 * 4. Fingerprint match: same data type + sample hash (confidence 0.6)
 *
 * Each before column is matched at most once, and each after column is
 * consumed at most once. Higher-confidence strategies run first.
 */
function matchColumns(
  before: ParsedFileData,
  after: ParsedFileData
): {
  matched: ColumnMatch[];
  unmatchedBefore: string[];
  unmatchedAfter: string[];
} {
  const matched: ColumnMatch[] = [];
  const remainingBefore = new Set(before.columns);
  const remainingAfter = new Set(after.columns);

  // Build fingerprint lookup maps
  const beforeFpMap = new Map(
    before.fingerprints.map((fp) => [fp.name, fp])
  );
  const afterFpMap = new Map(
    after.fingerprints.map((fp) => [fp.name, fp])
  );

  // Pass 1: Exact match
  for (const bc of Array.from(remainingBefore)) {
    if (remainingAfter.has(bc)) {
      matched.push({
        beforeColumn: bc,
        afterColumn: bc,
        matchType: "exact",
        confidence: 1.0,
      });
      remainingBefore.delete(bc);
      remainingAfter.delete(bc);
    }
  }

  // Pass 2: Case-insensitive match
  for (const bc of Array.from(remainingBefore)) {
    const bcLower = bc.toLowerCase();
    for (const ac of Array.from(remainingAfter)) {
      if (ac.toLowerCase() === bcLower) {
        matched.push({
          beforeColumn: bc,
          afterColumn: ac,
          matchType: "case_insensitive",
          confidence: 0.95,
        });
        remainingBefore.delete(bc);
        remainingAfter.delete(ac);
        break;
      }
    }
  }

  // Pass 2b: Normalized name match (strips underscores, hyphens, spaces → lowercase)
  // Catches: SOU_OnHand ↔ "SOU On Hand", first-name ↔ "First Name", part_code ↔ "Part Code"
  for (const bc of Array.from(remainingBefore)) {
    const bcNorm = normalizeColumnName(bc);
    for (const ac of Array.from(remainingAfter)) {
      if (normalizeColumnName(ac) === bcNorm) {
        matched.push({
          beforeColumn: bc,
          afterColumn: ac,
          matchType: "normalized",
          confidence: 0.92,
        });
        remainingBefore.delete(bc);
        remainingAfter.delete(ac);
        break;
      }
    }
  }

  // Pass 3: Levenshtein match (distance <= 2, both names length > 2)
  // Issue #7: lowered threshold from >4 to >2 to catch short column names
  const levenshteinCandidates: Array<{
    bc: string;
    ac: string;
    distance: number;
  }> = [];

  for (const bc of remainingBefore) {
    if (bc.length <= 2) continue;
    for (const ac of remainingAfter) {
      if (ac.length <= 2) continue;
      const dist = levenshteinDistance(bc, ac);
      if (dist <= 2) {
        levenshteinCandidates.push({ bc, ac, distance: dist });
      }
    }
  }

  // Sort by distance (best matches first)
  levenshteinCandidates.sort((a, b) => a.distance - b.distance);

  for (const candidate of levenshteinCandidates) {
    if (
      remainingBefore.has(candidate.bc) &&
      remainingAfter.has(candidate.ac)
    ) {
      // Confidence: distance 1 → 0.9, distance 2 → 0.7
      const confidence = candidate.distance === 1 ? 0.9 : 0.7;
      matched.push({
        beforeColumn: candidate.bc,
        afterColumn: candidate.ac,
        matchType: "levenshtein",
        confidence,
      });
      remainingBefore.delete(candidate.bc);
      remainingAfter.delete(candidate.ac);
    }
  }

  // Pass 4: Fingerprint match (same dataType + sampleHash)
  for (const bc of Array.from(remainingBefore)) {
    const bfp = beforeFpMap.get(bc);
    if (!bfp) continue;

    for (const ac of Array.from(remainingAfter)) {
      const afp = afterFpMap.get(ac);
      if (!afp) continue;

      if (
        bfp.dataType === afp.dataType &&
        bfp.sampleHash === afp.sampleHash
      ) {
        matched.push({
          beforeColumn: bc,
          afterColumn: ac,
          matchType: "fingerprint",
          confidence: 0.6,
        });
        remainingBefore.delete(bc);
        remainingAfter.delete(ac);
        break;
      }
    }
  }

  // Pass 4b: Loose fingerprint match (same dataType + similar cardinality/nullRate)
  // Issue #6: strict fingerprint requires exact sampleHash which breaks for renamed+transformed data
  for (const bc of Array.from(remainingBefore)) {
    const bfp = beforeFpMap.get(bc);
    if (!bfp) continue;

    let bestMatch: { ac: string; score: number } | null = null;

    for (const ac of Array.from(remainingAfter)) {
      const afp = afterFpMap.get(ac);
      if (!afp) continue;

      // Same data type required
      if (bfp.dataType !== afp.dataType) continue;

      // Cardinality within 20%
      const maxCard = Math.max(bfp.cardinality, afp.cardinality, 1);
      const cardDiff = Math.abs(bfp.cardinality - afp.cardinality) / maxCard;
      if (cardDiff > 0.2) continue;

      // Null rate within 10%
      const nullDiff = Math.abs(bfp.nullRate - afp.nullRate);
      if (nullDiff > 0.1) continue;

      // Score: tighter cardinality + nullRate = better match
      const score = 1 - (cardDiff + nullDiff) / 2;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { ac, score };
      }
    }

    if (bestMatch && remainingAfter.has(bestMatch.ac)) {
      matched.push({
        beforeColumn: bc,
        afterColumn: bestMatch.ac,
        matchType: "loose_fingerprint",
        confidence: 0.5,
      });
      remainingBefore.delete(bc);
      remainingAfter.delete(bestMatch.ac);
    }
  }

  // Pass 5: Value-based matching — compare actual cell data for remaining unmatched columns
  // Issues #5, #8: When column names are completely different, this is the only way to detect renames
  if (remainingBefore.size > 0 && remainingAfter.size > 0) {
    const valueCandidates: Array<{
      bc: string;
      ac: string;
      overlapRate: number;
    }> = [];

    // Sample first 50 rows for comparison
    const sampleSize = Math.min(before.rows.length, after.rows.length, 50);

    for (const bc of remainingBefore) {
      for (const ac of remainingAfter) {
        let matchCount = 0;
        let compareCount = 0;

        for (let i = 0; i < sampleSize; i++) {
          const bVal = before.rows[i]?.[bc];
          const aVal = after.rows[i]?.[ac];

          // Skip null-vs-null pairs (uninformative)
          if (
            (bVal === null || bVal === undefined || bVal === "") &&
            (aVal === null || aVal === undefined || aVal === "")
          ) {
            continue;
          }

          compareCount++;

          // Exact match
          if (bVal === aVal) {
            matchCount++;
            continue;
          }

          // Fuzzy: trimmed + case-insensitive string comparison
          if (bVal != null && aVal != null) {
            const bStr = String(bVal).trim().toLowerCase();
            const aStr = String(aVal).trim().toLowerCase();
            if (bStr === aStr) {
              matchCount++;
            }
          }
        }

        // Need at least some data to compare and >80% overlap
        if (compareCount >= 2) {
          const overlapRate = matchCount / compareCount;
          if (overlapRate >= 0.8) {
            valueCandidates.push({ bc, ac, overlapRate });
          }
        }
      }
    }

    // Greedy assignment: best overlap first
    valueCandidates.sort((a, b) => b.overlapRate - a.overlapRate);

    for (const candidate of valueCandidates) {
      if (
        remainingBefore.has(candidate.bc) &&
        remainingAfter.has(candidate.ac)
      ) {
        // Confidence scales with overlap: 80% → 0.7, 100% → 0.85
        const confidence = 0.7 + (candidate.overlapRate - 0.8) * 0.75;
        matched.push({
          beforeColumn: candidate.bc,
          afterColumn: candidate.ac,
          matchType: "value_overlap",
          confidence: Math.min(0.85, confidence),
        });
        remainingBefore.delete(candidate.bc);
        remainingAfter.delete(candidate.ac);
      }
    }
  }

  return {
    matched,
    unmatchedBefore: Array.from(remainingBefore),
    unmatchedAfter: Array.from(remainingAfter),
  };
}

// ─── Sort Detection ──────────────────────────────────

/**
 * Try to parse a value as a numeric for sort comparison.
 */
function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Try to parse a value as a Date for sort comparison.
 */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a column's values are sorted in ascending or descending order.
 * Returns the direction if fully sorted, null otherwise.
 */
function detectColumnSort(
  values: unknown[]
): "asc" | "desc" | null {
  const nonNull = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );
  if (nonNull.length < 2) return null;

  // Try numeric sort
  const nums = nonNull.map(toNumeric);
  if (nums.every((n) => n !== null)) {
    const validNums = nums as number[];
    let isAsc = true;
    let isDesc = true;
    for (let i = 1; i < validNums.length; i++) {
      if (validNums[i] < validNums[i - 1]) isAsc = false;
      if (validNums[i] > validNums[i - 1]) isDesc = false;
    }
    if (isAsc && !isDesc) return "asc";
    if (isDesc && !isAsc) return "desc";
    if (isAsc && isDesc) return null; // all equal — not meaningfully sorted
    return null;
  }

  // Try date sort
  const dates = nonNull.map(toDate);
  if (dates.every((d) => d !== null)) {
    const validDates = dates as Date[];
    let isAsc = true;
    let isDesc = true;
    for (let i = 1; i < validDates.length; i++) {
      if (validDates[i].getTime() < validDates[i - 1].getTime()) isAsc = false;
      if (validDates[i].getTime() > validDates[i - 1].getTime()) isDesc = false;
    }
    if (isAsc && !isDesc) return "asc";
    if (isDesc && !isAsc) return "desc";
    if (isAsc && isDesc) return null; // all equal
    return null;
  }

  // Try string sort (localeCompare)
  const strings = nonNull.map((v) => String(v));
  let isAsc = true;
  let isDesc = true;
  for (let i = 1; i < strings.length; i++) {
    const cmp = strings[i].localeCompare(strings[i - 1]);
    if (cmp < 0) isAsc = false;
    if (cmp > 0) isDesc = false;
  }
  if (isAsc && !isDesc) return "asc";
  if (isDesc && !isAsc) return "desc";
  if (isAsc && isDesc) return null; // all equal
  return null;
}

/**
 * Detect if a sort was applied by checking if AFTER is sorted on a column
 * that was NOT sorted the same way in BEFORE.
 */
function detectSortChange(
  before: ParsedFileData,
  after: ParsedFileData,
  matchedColumns: ColumnMatch[]
): { column: string; direction: "asc" | "desc" } | undefined {
  for (const match of matchedColumns) {
    const afterValues = after.rows.map((r) => r[match.afterColumn]);
    const afterSort = detectColumnSort(afterValues);

    if (afterSort) {
      const beforeValues = before.rows.map((r) => r[match.beforeColumn]);
      const beforeSort = detectColumnSort(beforeValues);

      // Only report if AFTER is sorted but BEFORE was not sorted the same way
      if (beforeSort !== afterSort) {
        return { column: match.afterColumn, direction: afterSort };
      }
    }
  }

  return undefined;
}

// ─── Format Change Detection ─────────────────────────

/**
 * Detect format changes between matched columns.
 * Only reports a change if >80% of compared value pairs show the same pattern.
 */
function detectFormatChanges(
  before: ParsedFileData,
  after: ParsedFileData,
  matchedColumns: ColumnMatch[]
): FormatChange[] {
  const changes: FormatChange[] = [];
  const sampleSize = Math.min(before.rows.length, after.rows.length, 50);

  if (sampleSize === 0) return changes;

  for (const match of matchedColumns) {
    const beforeValues: string[] = [];
    const afterValues: string[] = [];

    for (let i = 0; i < sampleSize; i++) {
      const bv = before.rows[i]?.[match.beforeColumn];
      const av = after.rows[i]?.[match.afterColumn];
      if (
        bv !== null &&
        bv !== undefined &&
        bv !== "" &&
        av !== null &&
        av !== undefined &&
        av !== ""
      ) {
        beforeValues.push(String(bv));
        afterValues.push(String(av));
      }
    }

    if (beforeValues.length === 0) continue;

    const total = beforeValues.length;
    const threshold = 0.8;

    // Check: case change (uppercase or lowercase)
    let uppercaseCount = 0;
    let lowercaseCount = 0;
    for (let i = 0; i < total; i++) {
      if (
        afterValues[i] === beforeValues[i].toUpperCase() &&
        afterValues[i] !== beforeValues[i]
      ) {
        uppercaseCount++;
      }
      if (
        afterValues[i] === beforeValues[i].toLowerCase() &&
        afterValues[i] !== beforeValues[i]
      ) {
        lowercaseCount++;
      }
    }

    if (uppercaseCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "case",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
      continue;
    }

    if (lowercaseCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "case",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
      continue;
    }

    // Check: trim (whitespace removal)
    let trimCount = 0;
    for (let i = 0; i < total; i++) {
      if (
        afterValues[i] === beforeValues[i].trim() &&
        afterValues[i] !== beforeValues[i]
      ) {
        trimCount++;
      }
    }

    if (trimCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "trim",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
      continue;
    }

    // Check: whitespace normalization (multiple spaces → single)
    let whitespaceCount = 0;
    for (let i = 0; i < total; i++) {
      const normalized = beforeValues[i].replace(/\s+/g, " ").trim();
      if (afterValues[i] === normalized && afterValues[i] !== beforeValues[i]) {
        whitespaceCount++;
      }
    }

    if (whitespaceCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "whitespace",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
      continue;
    }

    // Check: date format change (Issue #10)
    // Detect patterns like ISO→US (YYYY-MM-DD → MM/DD/YYYY) or US→EU (MM/DD/YYYY → DD/MM/YYYY)
    let dateFormatCount = 0;
    for (let i = 0; i < total; i++) {
      if (looksLikeDateFormatChange(beforeValues[i], afterValues[i])) {
        dateFormatCount++;
      }
    }

    if (dateFormatCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "date_format",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
      continue;
    }

    // Check: number padding (e.g., "42" → "042", "7" → "007")
    let paddingCount = 0;
    for (let i = 0; i < total; i++) {
      const bv = beforeValues[i];
      const av = afterValues[i];
      // After has leading zeros that before doesn't
      if (
        /^\d+$/.test(bv) &&
        /^0+\d+$/.test(av) &&
        parseInt(bv) === parseInt(av) &&
        av.length > bv.length
      ) {
        paddingCount++;
      }
    }

    if (paddingCount / total >= threshold) {
      changes.push({
        column: match.afterColumn,
        changeType: "number_format",
        beforeSample: beforeValues[0],
        afterSample: afterValues[0],
      });
    }
  }

  return changes;
}

/**
 * Check if two string values look like the same date in different formats.
 */
function looksLikeDateFormatChange(before: string, after: string): boolean {
  // Common date patterns
  const isoPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})/; // YYYY-MM-DD
  const usPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/; // MM/DD/YYYY
  const euPattern = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/; // DD.MM.YYYY

  const extractDate = (s: string): { y: number; m: number; d: number } | null => {
    let m: RegExpMatchArray | null;
    if ((m = s.match(isoPattern))) return { y: +m[1], m: +m[2], d: +m[3] };
    if ((m = s.match(usPattern))) return { y: +m[3], m: +m[1], d: +m[2] };
    if ((m = s.match(euPattern))) return { y: +m[3], m: +m[2], d: +m[1] };
    return null;
  };

  const bd = extractDate(before);
  const ad = extractDate(after);

  if (!bd || !ad) return false;
  // Same date, different string representation
  return bd.y === ad.y && bd.m === ad.m && bd.d === ad.d && before !== after;
}

// ─── Date Format Pattern Inference ───────────────────

/**
 * Infer a date format pattern from a sample string.
 * Returns a pattern compatible with the executor's formatDate() tokens.
 */
function inferDateFormatPattern(sample: string): string | null {
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(sample)) return "YYYY-MM-DD";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) return "MM/DD/YYYY";
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(sample)) return "DD.MM.YYYY";
  return null;
}

// ─── Reorder Detection ───────────────────────────────

/**
 * Check if the matched columns appear in a different order in AFTER vs BEFORE.
 */
function detectReorder(
  before: ParsedFileData,
  after: ParsedFileData,
  matchedColumns: ColumnMatch[]
): boolean {
  if (matchedColumns.length < 2) return false;

  // Build O(1) position lookups
  const beforeIdx = new Map(before.columns.map((c, i) => [c, i]));
  const afterIdx = new Map(after.columns.map((c, i) => [c, i]));

  // Get after-positions sorted by before-position
  const pairs = matchedColumns
    .map((m) => ({
      bp: beforeIdx.get(m.beforeColumn) ?? -1,
      ap: afterIdx.get(m.afterColumn) ?? -1,
    }))
    .sort((a, b) => a.bp - b.bp);

  // Check if after-positions are monotonically increasing — O(n) instead of O(n^2)
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].ap < pairs[i - 1].ap) return true;
  }

  return false;
}

// ─── Deterministic Step Generation ───────────────────

/**
 * Generate deterministic ForgeSteps from the analysis results.
 */
function generateDeterministicSteps(
  removedColumns: string[],
  matchedColumns: ColumnMatch[],
  reorderDetected: boolean,
  afterColumns: string[],
  formatChanges: FormatChange[],
  sortDetected: { column: string; direction: "asc" | "desc" } | undefined
): ForgeStep[] {
  const steps: ForgeStep[] = [];
  let order = 0;

  // Removed columns → remove_columns step
  if (removedColumns.length > 0) {
    steps.push({
      order: order++,
      type: "remove_columns",
      confidence: 1.0,
      config: { columns: removedColumns },
      description: `Remove ${removedColumns.length} column(s): ${removedColumns.join(", ")}`,
    });
  }

  // Renamed columns (from non-exact matches where names differ)
  // Only include matches with confidence >= 0.7 — lower-confidence matches
  // are also flagged as uncertain_match ambiguous cases for AI resolution.
  // Including them here would create conflicting rename steps that the AI
  // correction can't override (the column was already renamed to the wrong name).
  const renamedMatches = matchedColumns.filter(
    (m) =>
      m.confidence >= 0.7 &&
      (m.matchType === "levenshtein" ||
       m.matchType === "case_insensitive" ||
       m.matchType === "normalized" ||
       m.matchType === "fingerprint" ||
       m.matchType === "loose_fingerprint" ||
       m.matchType === "value_overlap")
  );
  if (renamedMatches.length > 0) {
    const renames: Record<string, string> = {};
    for (const m of renamedMatches) {
      renames[m.beforeColumn] = m.afterColumn;
    }
    // Use the minimum confidence among all renames
    const minConfidence = Math.min(...renamedMatches.map((m) => m.confidence));
    steps.push({
      order: order++,
      type: "rename_columns",
      confidence: minConfidence,
      config: { mapping: renames },
      description: `Rename ${renamedMatches.length} column(s): ${renamedMatches
        .map((m) => `${m.beforeColumn} -> ${m.afterColumn}`)
        .join(", ")}`,
    });
  }

  // Reordered columns — must run LAST so all columns (including AI-inferred
  // calculate/formula columns) exist before reordering. Use order=900 to ensure
  // it sorts after all AI steps (which get order values starting from the
  // deterministic step count).
  if (reorderDetected) {
    steps.push({
      order: 900,
      type: "reorder_columns",
      confidence: 1.0,
      config: { order: afterColumns },
      description: `Reorder columns to: ${afterColumns.join(", ")}`,
    });
  }

  // Format changes — one step per column to match executor's expected config
  for (const fc of formatChanges) {
    // Map diff changeType to executor formatType
    const formatType = fc.changeType === "case"
      ? (fc.afterSample === fc.beforeSample.toUpperCase() ? "uppercase" : "lowercase")
      : fc.changeType === "whitespace" ? "trim" : fc.changeType;

    const config: Record<string, string> = { column: fc.column, formatType };

    // Add pattern for format types that require it in the executor
    if (formatType === "number_format") {
      // Padding pattern: "0" repeated to target length (e.g., "042" → "000")
      config.pattern = "0".repeat(fc.afterSample.length);
    } else if (formatType === "date_format") {
      const pattern = inferDateFormatPattern(fc.afterSample);
      if (pattern) config.pattern = pattern;
    }

    steps.push({
      order: order++,
      type: "format",
      confidence: 0.9,
      config,
      description: `Format ${fc.column}: ${formatType} (${fc.beforeSample} → ${fc.afterSample})`,
    });
  }

  // Sort detected
  if (sortDetected) {
    steps.push({
      order: order++,
      type: "sort",
      confidence: 0.95,
      config: {
        column: sortDetected.column,
        direction: sortDetected.direction,
      },
      description: `Sort by ${sortDetected.column} ${sortDetected.direction.toUpperCase()}`,
    });
  }

  return steps;
}

// ─── Ambiguous Case Generation ───────────────────────

/**
 * Generate AmbiguousCases for situations requiring AI resolution.
 */
function generateAmbiguousCases(
  addedColumns: string[],
  before: ParsedFileData,
  after: ParsedFileData,
  matchedColumns: ColumnMatch[]
): AmbiguousCase[] {
  const cases: AmbiguousCase[] = [];

  // New columns in AFTER — might be calculated
  for (const col of addedColumns) {
    cases.push({
      type: "new_column",
      description: `Column "${col}" exists in AFTER but not in BEFORE — may be a calculated field`,
      context: { column: col },
    });
  }

  // Removed rows with no clear filter pattern
  if (after.rowCount < before.rowCount) {
    const removedCount = before.rowCount - after.rowCount;
    cases.push({
      type: "removed_rows",
      description: `${removedCount} row(s) were removed — filter logic unclear`,
      context: {
        beforeRowCount: before.rowCount,
        afterRowCount: after.rowCount,
        removedCount,
      },
    });
  }

  // Low-confidence column matches
  const uncertainMatches = matchedColumns.filter((m) => m.confidence < 0.7);
  for (const m of uncertainMatches) {
    cases.push({
      type: "uncertain_match",
      description: `Column match "${m.beforeColumn}" -> "${m.afterColumn}" has low confidence (${m.confidence}) via ${m.matchType}`,
      context: {
        beforeColumn: m.beforeColumn,
        afterColumn: m.afterColumn,
        matchType: m.matchType,
        confidence: m.confidence,
      },
    });
  }

  return cases;
}

// ─── Main Diff Function ──────────────────────────────

/**
 * Compute the structural diff between two parsed file datasets.
 *
 * This is the Phase 1 deterministic engine: it identifies column matches,
 * row changes, sort/format/reorder transformations, and generates
 * high-confidence forge steps. Cases that need AI resolution are flagged
 * as ambiguous.
 */
export function computeStructuralDiff(
  before: ParsedFileData,
  after: ParsedFileData
): StructuralDiffResult {
  // Step 1: Match columns
  const { matched, unmatchedBefore, unmatchedAfter } = matchColumns(
    before,
    after
  );

  // Step 2: Row analysis
  const beforeRowCount = before.rowCount;
  const afterRowCount = after.rowCount;
  const removedRowCount = Math.max(0, beforeRowCount - afterRowCount);

  // Step 3: Sort detection
  const sortDetected = detectSortChange(before, after, matched);

  // Step 4: Format change detection
  const formatChanges = detectFormatChanges(before, after, matched);

  // Step 5: Reorder detection
  const reorderDetected = detectReorder(before, after, matched);

  // Step 6: Generate deterministic steps
  const deterministicSteps = generateDeterministicSteps(
    unmatchedBefore,
    matched,
    reorderDetected,
    after.columns,
    formatChanges,
    sortDetected
  );

  // Step 7: Generate ambiguous cases
  const ambiguousCases = generateAmbiguousCases(
    unmatchedAfter,
    before,
    after,
    matched
  );

  return {
    matchedColumns: matched,
    removedColumns: unmatchedBefore,
    addedColumns: unmatchedAfter,
    beforeRowCount,
    afterRowCount,
    removedRowCount,
    sortDetected,
    formatChanges,
    reorderDetected,
    deterministicSteps,
    ambiguousCases,
  };
}
