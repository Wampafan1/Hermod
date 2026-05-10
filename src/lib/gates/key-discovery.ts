/**
 * Gate key discovery for KEY_DRIFT review.
 *
 * This works on already-mapped destination rows, so candidate keys are expressed
 * in destination column names and no raw source schema leaks into review data.
 */

export type KeyDiscoveryMode =
  | "QUICK"
  | "DUPLICATE_DISCRIMINATOR"
  | "THOROUGH"
  | "CAPPED"
  | "UCC";

export interface CandidateKey {
  columns: string[];
  unique: boolean;
  nullCount: number;
  duplicateCount: number;
  coverage: number;
  width: number;
  score: number;
  source?: "UCC";
  quality?: unknown;
  requiresReview?: boolean;
  reviewReason?: "KEY_HAS_NULLS";
  examples?: {
    rowIndexes: number[];
  };
}

export interface ColumnExclusion {
  column: string;
  reason: string;
}

export interface DiscriminatorColumnStats {
  column: string;
  duplicateGroupsSeparated: number;
  nullCount: number;
  distinctCount: number;
}

export interface CandidateSearchLimits {
  maxWidth: number;
  maxColumns: number;
  maxCombinations: number;
  combinationsTested: number;
}

export interface KeyDiscoveryStats {
  rowCount: number;
  inputRowCount: number;
  blankRowsSkipped: number;
  columnsAnalyzed: number;
  combinationsTested: number;
  maxWidth: number;
  maxColumns: number;
  maxCombinations: number;
  truncated: boolean;
  destinationValidated: boolean;
  destinationValidationMode: "UPLOAD_ONLY";
  discoveryMode: KeyDiscoveryMode;
  searchExhaustive: boolean;
  columnsConsidered: string[];
  columnsExcluded: ColumnExclusion[];
  discriminatorColumns: DiscriminatorColumnStats[];
  currentKeyDuplicateGroupCount: number;
  currentKeyColumns?: string[];
  candidateSearchLimits: CandidateSearchLimits;
  levelsSearched?: number;
  timedOut?: boolean;
  durationMs?: number;
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
  quickMaxColumns?: number;
  quickMaxWidth?: number;
  rejectNullable?: boolean;
  currentKeyColumns?: string[];
}

export interface SelectedGateKeyValidationResult {
  ok: boolean;
  nullCount: number;
  duplicateCount: number;
  duplicateExamples: Array<{
    keyValues: Record<string, string | number | boolean | null>;
    rowIndexes: number[];
  }>;
  nullKeyExamples: Array<{
    rowIndex: number;
    keyValues: Record<string, string | number | boolean | null>;
    missingColumns: string[];
  }>;
}

export interface SelectedGateKeyValidationOptions {
  rows: Record<string, unknown>[];
  selectedKey: string[];
  blankRowsAlreadyRemoved?: boolean;
  maxExamples?: number;
}

const DEFAULT_QUICK_MAX_WIDTH = 4;
const DEFAULT_QUICK_MAX_COLUMNS = 24;
const DEFAULT_THOROUGH_MAX_WIDTH = 6;
const DEFAULT_MAX_COMBINATIONS = 250_000;

const STABLE_NAME_PATTERN =
  /\b(id|key|code|number|num|no|ref|sku|job|order|invoice|customer|vendor|account|line)\b/i;
const VOLATILE_NAME_PATTERN =
  /\b(value|amount|price|cost|total|date|time|status|description|comment|note|name|email|phone|address)\b/i;

export function discoverUniqueColumnCombinations(
  rows: Record<string, unknown>[],
  columns: string[],
  options: KeyDiscoveryOptions = {}
): KeyDiscoveryResult {
  const normalizedColumns = uniqueStrings(columns).filter(Boolean);
  const normalizedRows = rows.filter((row) => !isFullyBlankMappedRow(row));
  const blankRowsSkipped = rows.length - normalizedRows.length;
  const maxWidth = positiveInt(
    options.maxWidth,
    positiveIntFromEnv("GATE_KEY_DISCOVERY_MAX_WIDTH", DEFAULT_THOROUGH_MAX_WIDTH)
  );
  const quickMaxWidth = Math.min(
    maxWidth,
    positiveInt(
      options.quickMaxWidth,
      positiveIntFromEnv("GATE_KEY_DISCOVERY_QUICK_MAX_WIDTH", DEFAULT_QUICK_MAX_WIDTH)
    )
  );
  const maxColumns = positiveInt(
    options.maxColumns,
    positiveIntFromEnv("GATE_KEY_DISCOVERY_MAX_COLUMNS", normalizedColumns.length || 1)
  );
  const quickMaxColumns = positiveInt(
    options.quickMaxColumns,
    positiveIntFromEnv("GATE_KEY_DISCOVERY_QUICK_MAX_COLUMNS", DEFAULT_QUICK_MAX_COLUMNS)
  );
  const maxCombinations = positiveInt(
    options.maxCombinations,
    positiveIntFromEnv("GATE_KEY_DISCOVERY_MAX_COMBINATIONS", DEFAULT_MAX_COMBINATIONS)
  );
  const rejectNullable = options.rejectNullable ?? true;
  const currentKeyColumns = uniqueStrings(options.currentKeyColumns ?? []);

  const columnsWithData = normalizedColumns.filter((column) =>
    normalizedRows.some((row) => !isBlankValue(row[column]))
  );
  const columnsExcluded: ColumnExclusion[] = normalizedColumns
    .filter((column) => !columnsWithData.includes(column))
    .map((column) => ({ column, reason: "Column has no nonblank mapped values." }));

  const cappedColumns = columnsWithData.slice(0, maxColumns);
  if (columnsWithData.length > cappedColumns.length) {
    for (const column of columnsWithData.slice(cappedColumns.length)) {
      columnsExcluded.push({
        column,
        reason: `Excluded by configured max column search limit (${maxColumns}).`,
      });
    }
  }

  const duplicateGroups = buildDuplicateGroups(normalizedRows, currentKeyColumns);
  const discriminatorColumns = currentKeyColumns.length > 0
    ? findDuplicateDiscriminatorColumns(normalizedRows, cappedColumns, currentKeyColumns, duplicateGroups)
    : [];
  const stats: KeyDiscoveryStats = {
    rowCount: normalizedRows.length,
    inputRowCount: rows.length,
    blankRowsSkipped,
    columnsAnalyzed: cappedColumns.length,
    combinationsTested: 0,
    maxWidth,
    maxColumns,
    maxCombinations,
    truncated: false,
    destinationValidated: false,
    destinationValidationMode: "UPLOAD_ONLY",
    discoveryMode: "QUICK",
    searchExhaustive: false,
    columnsConsidered: cappedColumns,
    columnsExcluded,
    discriminatorColumns,
    currentKeyDuplicateGroupCount: duplicateGroups.length,
    currentKeyColumns,
    candidateSearchLimits: {
      maxWidth,
      maxColumns,
      maxCombinations,
      combinationsTested: 0,
    },
  };

  if (normalizedRows.length === 0 || cappedColumns.length === 0) {
    stats.searchExhaustive = true;
    return {
      candidates: [],
      stats,
      noReliableKeyReason: withBlankRowNote(
        "No nonblank mapped rows or candidate columns were available.",
        blankRowsSkipped
      ),
    };
  }

  const accepted = new Map<string, CandidateKey>();
  const evaluated = new Set<string>();

  const evaluate = (combo: string[]): CandidateKey | null => {
    const normalized = normalizeCandidateColumns(combo, cappedColumns);
    if (normalized.length === 0) return null;
    const signature = columnSignature(normalized);
    if (evaluated.has(signature)) return accepted.get(signature) ?? null;
    if (stats.combinationsTested >= maxCombinations) {
      stats.truncated = true;
      return null;
    }

    evaluated.add(signature);
    stats.combinationsTested++;
    stats.candidateSearchLimits.combinationsTested = stats.combinationsTested;
    const candidate = evaluateCandidate(normalizedRows, normalized);
    if (candidate.unique && (!rejectNullable || candidate.nullCount === 0)) {
      accepted.set(signature, candidate);
    }
    return candidate;
  };

  runQuickHeuristicSearch({
    candidateColumns: cappedColumns,
    maxWidth: quickMaxWidth,
    quickMaxColumns,
    accepted,
    evaluate,
    stats,
  });

  if (!stats.truncated && duplicateGroups.length > 0) {
    runDuplicateDiscriminatorSearch({
      currentKeyColumns,
      discriminatorColumns: discriminatorColumns.map((column) => column.column),
      maxWidth,
      evaluate,
      stats,
    });
  }

  if (!stats.truncated && accepted.size === 0) {
    runThoroughSearch({
      candidateColumns: cappedColumns,
      maxWidth,
      evaluate,
      stats,
    });
  }

  const ranked = rankCandidateKeys([...accepted.values()], {
    rowCount: normalizedRows.length,
    oldKey: currentKeyColumns,
    discriminatorColumns: discriminatorColumns.map((column) => column.column),
  });
  const foundFromDiscriminator = ranked.some(
    (candidate) =>
      currentKeyColumns.length > 0 &&
      currentKeyColumns.every((column) => hasColumn(candidate.columns, column)) &&
      candidate.columns.some((column) =>
        discriminatorColumns.some((discriminator) => sameColumn(discriminator.column, column))
      )
  );

  const widthLimited = accepted.size === 0 && cappedColumns.length > maxWidth;
  const columnLimited = columnsWithData.length > cappedColumns.length;
  const capped = stats.truncated || widthLimited || columnLimited;
  stats.discoveryMode = capped && ranked.length === 0
    ? "CAPPED"
    : foundFromDiscriminator
      ? "DUPLICATE_DISCRIMINATOR"
      : ranked.length > 0
        ? "QUICK"
        : "THOROUGH";
  stats.searchExhaustive = ranked.length === 0 && !capped;
  stats.truncated = stats.truncated || widthLimited || columnLimited;

  return {
    candidates: ranked,
    stats,
    noReliableKeyReason: ranked.length === 0
      ? buildNoReliableKeyReason(stats, blankRowsSkipped)
      : null,
  };
}

export function rankCandidateKeys(
  candidates: CandidateKey[],
  context: {
    rowCount: number;
    oldKey?: string[];
    discriminatorColumns?: string[];
  }
): CandidateKey[] {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, context),
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
    oldKey: input.validationStats.currentKeyColumns,
    discriminatorColumns: (input.validationStats.discriminatorColumns ?? []).map((column) => column.column),
  });
  const top = ranked[0] ?? null;

  return {
    candidateKeys: ranked,
    recommendation: top
      ? {
          columns: top.columns,
          score: top.score,
          source: "DETERMINISTIC",
          reason: deterministicReason(top, input.validationStats),
        }
      : null,
    validationStats: input.validationStats,
    noReliableKeyReason: top
      ? null
      : input.noReliableKeyReason ?? buildNoReliableKeyReason(input.validationStats, 0),
  };
}

export function validateSelectedGateKey(
  input: SelectedGateKeyValidationOptions
): SelectedGateKeyValidationResult {
  const maxExamples = input.maxExamples ?? 5;
  const rows = input.blankRowsAlreadyRemoved
    ? input.rows
    : input.rows.filter((row) => !isFullyBlankMappedRow(row));
  const selectedKey = uniqueStrings(input.selectedKey).filter(Boolean);
  const duplicateCandidates = new Map<
    string,
    { keyValues: Record<string, string | number | boolean | null>; rowIndexes: number[] }
  >();
  const nullKeyExamples: SelectedGateKeyValidationResult["nullKeyExamples"] = [];
  let nullCount = 0;

  rows.forEach((row, index) => {
    const keyValues = buildSafeKeyValues(row, selectedKey);
    const missingColumns = selectedKey.filter((column) => isBlankValue(row[column]));

    if (missingColumns.length > 0) {
      nullCount++;
      if (nullKeyExamples.length < maxExamples) {
        nullKeyExamples.push({
          rowIndex: index + 1,
          keyValues,
          missingColumns,
        });
      }
      return;
    }

    const signature = JSON.stringify(selectedKey.map((column) => normalizeKeyValue(row[column])));
    const existing = duplicateCandidates.get(signature);
    if (existing) {
      existing.rowIndexes.push(index + 1);
    } else {
      duplicateCandidates.set(signature, {
        keyValues,
        rowIndexes: [index + 1],
      });
    }
  });

  const duplicateExamples = Array.from(duplicateCandidates.values())
    .filter((example) => example.rowIndexes.length > 1)
    .slice(0, maxExamples);
  const duplicateCount = Array.from(duplicateCandidates.values()).reduce(
    (sum, example) => sum + Math.max(0, example.rowIndexes.length - 1),
    0
  );

  return {
    ok: selectedKey.length > 0 && nullCount === 0 && duplicateCount === 0,
    nullCount,
    duplicateCount,
    duplicateExamples,
    nullKeyExamples,
  };
}

function runQuickHeuristicSearch(input: {
  candidateColumns: string[];
  maxWidth: number;
  quickMaxColumns: number;
  accepted: Map<string, CandidateKey>;
  evaluate: (combo: string[]) => CandidateKey | null;
  stats: KeyDiscoveryStats;
}): void {
  const quickColumns = [...input.candidateColumns]
    .sort((a, b) => columnPriorityScore(b) - columnPriorityScore(a))
    .slice(0, Math.min(input.quickMaxColumns, input.candidateColumns.length));

  for (let width = 1; width <= Math.min(input.maxWidth, quickColumns.length); width++) {
    for (const combo of combinationsLazy(quickColumns, width)) {
      if (input.stats.truncated) return;
      if (isSupersetOfAny(combo, [...input.accepted.values()].map((candidate) => candidate.columns))) {
        continue;
      }
      input.evaluate(combo);
    }
  }
}

function runDuplicateDiscriminatorSearch(input: {
  currentKeyColumns: string[];
  discriminatorColumns: string[];
  maxWidth: number;
  evaluate: (combo: string[]) => CandidateKey | null;
  stats: KeyDiscoveryStats;
}): void {
  if (input.currentKeyColumns.length === 0 || input.discriminatorColumns.length === 0) return;
  const remainingWidth = input.maxWidth - input.currentKeyColumns.length;
  if (remainingWidth <= 0) return;
  const maxDiscriminatorWidth = Math.min(3, remainingWidth, input.discriminatorColumns.length);

  for (let width = 1; width <= maxDiscriminatorWidth; width++) {
    for (const discriminators of combinationsLazy(input.discriminatorColumns, width)) {
      if (input.stats.truncated) return;
      input.evaluate([...input.currentKeyColumns, ...discriminators]);
    }
  }
}

function runThoroughSearch(input: {
  candidateColumns: string[];
  maxWidth: number;
  evaluate: (combo: string[]) => CandidateKey | null;
  stats: KeyDiscoveryStats;
}): void {
  for (let width = 1; width <= Math.min(input.maxWidth, input.candidateColumns.length); width++) {
    for (const combo of combinationsLazy(input.candidateColumns, width)) {
      if (input.stats.truncated) return;
      input.evaluate(combo);
    }
  }
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

function scoreCandidate(
  candidate: CandidateKey,
  context: { oldKey?: string[]; discriminatorColumns?: string[] } = {}
): number {
  if (!candidate.unique || candidate.nullCount > 0 || candidate.duplicateCount > 0) {
    return 0;
  }

  const stableBonus = candidate.columns.reduce(
    (sum, column) => sum + (STABLE_NAME_PATTERN.test(column) ? 25 : 0),
    0
  );
  const volatilePenalty = candidate.columns.reduce(
    (sum, column) => sum + (VOLATILE_NAME_PATTERN.test(column) ? 5 : 0),
    0
  );
  const oldKeyBonus =
    context.oldKey && context.oldKey.length > 0 &&
    context.oldKey.every((column) => hasColumn(candidate.columns, column))
      ? 90
      : 0;
  const discriminatorBonus = candidate.columns.reduce(
    (sum, column) =>
      sum + ((context.discriminatorColumns ?? []).some((disc) => sameColumn(disc, column)) ? 35 : 0),
    0
  );

  return Math.round(
    1000
      + candidate.coverage * 100
      - candidate.width * 120
      + stableBonus
      + oldKeyBonus
      + discriminatorBonus
      - volatilePenalty
  );
}

function deterministicReason(candidate: CandidateKey, stats: KeyDiscoveryStats): string {
  const widthText = candidate.width === 1 ? "single-column" : `${candidate.width}-column`;
  if (
    stats.discoveryMode === "DUPLICATE_DISCRIMINATOR" &&
    stats.discriminatorColumns.some((disc) =>
      candidate.columns.some((column) => sameColumn(column, disc.column))
    )
  ) {
    return `Selected the highest-ranked ${widthText} null-free unique key that separates duplicate current-key groups.`;
  }
  return `Selected the highest-ranked ${widthText} null-free unique key verified against the mapped upload rows.`;
}

function buildDuplicateGroups(rows: Record<string, unknown>[], currentKeyColumns: string[]): Record<string, unknown>[][] {
  if (currentKeyColumns.length === 0) return [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (currentKeyColumns.some((column) => isBlankValue(row[column]))) continue;
    const signature = JSON.stringify(currentKeyColumns.map((column) => normalizeKeyValue(row[column])));
    const existing = groups.get(signature) ?? [];
    existing.push(row);
    groups.set(signature, existing);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function findDuplicateDiscriminatorColumns(
  rows: Record<string, unknown>[],
  columns: string[],
  currentKeyColumns: string[],
  duplicateGroups: Record<string, unknown>[][]
): DiscriminatorColumnStats[] {
  if (duplicateGroups.length === 0) return [];

  const stats = columns
    .filter((column) => !currentKeyColumns.some((keyColumn) => sameColumn(keyColumn, column)))
    .map((column) => {
      const duplicateGroupsSeparated = duplicateGroups.reduce((count, group) => {
        const distinct = new Set(
          group
            .map((row) => normalizeKeyValue(row[column]))
            .filter((value) => value !== null && value !== "")
            .map((value) => JSON.stringify(value))
        );
        return count + (distinct.size > 1 ? 1 : 0);
      }, 0);
      const allValues = rows.map((row) => normalizeKeyValue(row[column]));
      const nullCount = allValues.filter((value) => value === null || value === "").length;
      const distinctCount = new Set(
        allValues
          .filter((value) => value !== null && value !== "")
          .map((value) => JSON.stringify(value))
      ).size;
      return {
        column,
        duplicateGroupsSeparated,
        nullCount,
        distinctCount,
      };
    })
    .filter((column) => column.duplicateGroupsSeparated > 0);

  return stats.sort((a, b) => {
    if (b.duplicateGroupsSeparated !== a.duplicateGroupsSeparated) {
      return b.duplicateGroupsSeparated - a.duplicateGroupsSeparated;
    }
    if (a.nullCount !== b.nullCount) return a.nullCount - b.nullCount;
    return b.distinctCount - a.distinctCount;
  });
}

function buildNoReliableKeyReason(stats: KeyDiscoveryStats, blankRowsSkipped: number): string {
  const base = stats.searchExhaustive
    ? `No null-free unique key was found after checking all mapped columns up to width ${stats.maxWidth}.`
    : `No reliable key was found within the current search limits. Hermod checked ${stats.combinationsTested.toLocaleString()} combinations across ${stats.columnsAnalyzed.toLocaleString()} columns. Increase search depth or select a key manually.`;
  return withBlankRowNote(base, blankRowsSkipped);
}

function withBlankRowNote(message: string, blankRowsSkipped: number): string {
  if (blankRowsSkipped <= 0) return message;
  return `${message} Fully blank mapped rows were excluded from key discovery and counted separately.`;
}

function columnPriorityScore(column: string): number {
  return (STABLE_NAME_PATTERN.test(column) ? 100 : 0)
    - (VOLATILE_NAME_PATTERN.test(column) ? 5 : 0)
    - column.length / 100;
}

function isBlankValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isFullyBlankMappedRow(row: Record<string, unknown>): boolean {
  const values = Object.values(row);
  return values.length > 0 && values.every(isBlankValue);
}

function normalizeKeyValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildSafeKeyValues(
  row: Record<string, unknown>,
  keyColumns: string[]
): Record<string, string | number | boolean | null> {
  const values: Record<string, string | number | boolean | null> = {};
  for (const column of keyColumns) {
    values[column] = toSafeKeyValue(row[column]);
  }
  return values;
}

function toSafeKeyValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeCandidateColumns(candidate: string[], allowedColumns: string[]): string[] {
  const allowed = new Map(allowedColumns.map((column) => [column.toLowerCase(), column]));
  const normalized: string[] = [];
  for (const column of candidate) {
    const actual = allowed.get(column.toLowerCase());
    if (actual && !normalized.some((existing) => sameColumn(existing, actual))) {
      normalized.push(actual);
    }
  }
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function hasColumn(columns: string[], column: string): boolean {
  return columns.some((candidate) => sameColumn(candidate, column));
}

function sameColumn(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function columnSignature(columns: string[]): string {
  return [...columns].map((column) => column.toLowerCase()).sort().join("\u0000");
}

function isSupersetOfAny(candidate: string[], sets: string[][]): boolean {
  return sets.some((set) => set.every((column) => hasColumn(candidate, column)));
}

function* combinationsLazy<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > arr.length) return;

  const current: T[] = [];

  function* recurse(start: number): Generator<T[]> {
    if (current.length === k) {
      yield [...current];
      return;
    }

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      yield* recurse(i + 1);
      current.pop();
    }
  }

  yield* recurse(0);
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
