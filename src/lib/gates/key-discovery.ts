/**
 * Gate key discovery for KEY_DRIFT review.
 *
 * This works on already-mapped destination rows, so candidate keys are expressed
 * in destination column names and no raw source schema leaks into review data.
 */

export interface CandidateKey {
  columns: string[];
  unique: boolean;
  nullCount: number;
  duplicateCount: number;
  coverage: number;
  width: number;
  score: number;
  examples?: {
    rowIndexes: number[];
  };
}

export interface KeyDiscoveryStats {
  rowCount: number;
  columnsAnalyzed: number;
  combinationsTested: number;
  maxWidth: number;
  maxCombinations: number;
  truncated: boolean;
  destinationValidated: boolean;
  destinationValidationMode: "UPLOAD_ONLY";
}

export interface KeyDiscoveryResult {
  candidates: CandidateKey[];
  stats: KeyDiscoveryStats;
  noReliableKeyReason: string | null;
}

export interface KeyRecommendation {
  columns: string[];
  score: number;
  source: "DETERMINISTIC" | "AI";
  reason: string;
}

export interface KeyDriftRecommendationBuild {
  candidateKeys: CandidateKey[];
  recommendation: KeyRecommendation | null;
  validationStats: KeyDiscoveryStats;
  noReliableKeyReason: string | null;
}

export interface KeyDiscoveryOptions {
  maxWidth?: number;
  maxColumns?: number;
  maxCombinations?: number;
  rejectNullable?: boolean;
}

const DEFAULT_MAX_WIDTH = 4;
const DEFAULT_MAX_COLUMNS = 24;
const DEFAULT_MAX_COMBINATIONS = 25_000;

const STABLE_NAME_PATTERN =
  /\b(id|key|code|number|num|no|ref|sku|job|order|invoice|customer|vendor|account|line)\b/i;
const VOLATILE_NAME_PATTERN =
  /\b(value|amount|price|cost|total|date|time|status|description|comment|note|name|email|phone|address)\b/i;

export function discoverUniqueColumnCombinations(
  rows: Record<string, unknown>[],
  columns: string[],
  options: KeyDiscoveryOptions = {}
): KeyDiscoveryResult {
  const maxWidth = Math.max(1, Math.min(options.maxWidth ?? DEFAULT_MAX_WIDTH, 6));
  const maxColumns = Math.max(1, options.maxColumns ?? DEFAULT_MAX_COLUMNS);
  const maxCombinations = Math.max(1, options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS);
  const rejectNullable = options.rejectNullable ?? true;
  const candidateColumns = columns
    .filter((column, index, all) => column && all.indexOf(column) === index)
    .filter((column) => rows.some((row) => !isBlankValue(row[column])))
    .sort((a, b) => columnPriorityScore(b) - columnPriorityScore(a))
    .slice(0, maxColumns);

  const stats: KeyDiscoveryStats = {
    rowCount: rows.length,
    columnsAnalyzed: candidateColumns.length,
    combinationsTested: 0,
    maxWidth,
    maxCombinations,
    truncated: false,
    destinationValidated: false,
    destinationValidationMode: "UPLOAD_ONLY",
  };

  if (rows.length === 0 || candidateColumns.length === 0) {
    return {
      candidates: [],
      stats,
      noReliableKeyReason: "No nonblank mapped rows or candidate columns were available.",
    };
  }

  const accepted: CandidateKey[] = [];
  const acceptedSets: string[][] = [];

  for (let width = 1; width <= Math.min(maxWidth, candidateColumns.length); width++) {
    for (const combo of combinations(candidateColumns, width)) {
      if (stats.combinationsTested >= maxCombinations) {
        stats.truncated = true;
        break;
      }
      if (isSupersetOfAny(combo, acceptedSets)) {
        continue;
      }

      stats.combinationsTested++;
      const candidate = evaluateCandidate(rows, combo);
      if (candidate.unique && (!rejectNullable || candidate.nullCount === 0)) {
        accepted.push(candidate);
        acceptedSets.push(combo);
      }
    }
    if (stats.truncated) break;
  }

  const ranked = rankCandidateKeys(accepted, { rowCount: rows.length });
  return {
    candidates: ranked,
    stats,
    noReliableKeyReason: ranked.length === 0
      ? "No null-free unique column combination was found in the mapped upload rows."
      : null,
  };
}

export function rankCandidateKeys(
  candidates: CandidateKey[],
  _context: { rowCount: number }
): CandidateKey[] {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.width !== b.width) return a.width - b.width;
      return a.columns.join("|").localeCompare(b.columns.join("|"));
    });
}

export function buildKeyDriftRecommendation(input: {
  candidateKeys: CandidateKey[];
  validationStats: KeyDiscoveryStats;
  noReliableKeyReason?: string | null;
}): KeyDriftRecommendationBuild {
  const ranked = rankCandidateKeys(input.candidateKeys, {
    rowCount: input.validationStats.rowCount,
  });
  const top = ranked[0] ?? null;

  return {
    candidateKeys: ranked,
    recommendation: top
      ? {
          columns: top.columns,
          score: top.score,
          source: "DETERMINISTIC",
          reason: deterministicReason(top),
        }
      : null,
    validationStats: input.validationStats,
    noReliableKeyReason: top
      ? null
      : input.noReliableKeyReason ?? "No reliable null-free unique key was found.",
  };
}

function evaluateCandidate(rows: Record<string, unknown>[], columns: string[]): CandidateKey {
  const seen = new Map<string, number>();
  let nullCount = 0;
  let duplicateCount = 0;
  let coveredRows = 0;
  const exampleRows: number[] = [];

  rows.forEach((row, index) => {
    const hasBlank = columns.some((column) => isBlankValue(row[column]));
    if (hasBlank) {
      nullCount++;
      return;
    }

    coveredRows++;
    if (exampleRows.length < 3) exampleRows.push(index + 1);
    const signature = JSON.stringify(columns.map((column) => normalizeKeyValue(row[column])));
    const existingCount = seen.get(signature) ?? 0;
    if (existingCount > 0) duplicateCount++;
    seen.set(signature, existingCount + 1);
  });

  const unique = nullCount === 0 && duplicateCount === 0 && coveredRows === rows.length;
  const width = columns.length;
  const coverage = rows.length === 0 ? 0 : coveredRows / rows.length;

  const candidate: CandidateKey = {
    columns,
    unique,
    nullCount,
    duplicateCount,
    coverage,
    width,
    score: 0,
  };
  if (unique) {
    candidate.examples = { rowIndexes: exampleRows };
  }
  candidate.score = scoreCandidate(candidate);
  return candidate;
}

function scoreCandidate(candidate: CandidateKey): number {
  if (!candidate.unique || candidate.nullCount > 0 || candidate.duplicateCount > 0) {
    return 0;
  }

  const stableBonus = candidate.columns.reduce(
    (sum, column) => sum + (STABLE_NAME_PATTERN.test(column) ? 25 : 0),
    0
  );
  const volatilePenalty = candidate.columns.reduce(
    (sum, column) => sum + (VOLATILE_NAME_PATTERN.test(column) ? 15 : 0),
    0
  );

  return Math.round(
    1000
      + candidate.coverage * 100
      - candidate.width * 120
      + stableBonus
      - volatilePenalty
  );
}

function deterministicReason(candidate: CandidateKey): string {
  const widthText = candidate.width === 1 ? "single-column" : `${candidate.width}-column`;
  return `Selected the highest-ranked ${widthText} null-free unique key verified against the mapped upload rows.`;
}

function columnPriorityScore(column: string): number {
  return (STABLE_NAME_PATTERN.test(column) ? 100 : 0)
    - (VOLATILE_NAME_PATTERN.test(column) ? 15 : 0)
    - column.length / 100;
}

function isBlankValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function normalizeKeyValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isSupersetOfAny(candidate: string[], sets: string[][]): boolean {
  return sets.some((set) => set.every((column) => candidate.includes(column)));
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr];

  const result: T[][] = [];
  const current: T[] = [];

  function recurse(start: number): void {
    if (current.length === k) {
      result.push([...current]);
      return;
    }

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      recurse(i + 1);
      current.pop();
    }
  }

  recurse(0);
  return result;
}
