import { createAnalyticsSession } from "@/lib/duckdb/engine";
import { discoverUCCs, type DiscoveredUCC } from "@/lib/ucc";
import {
  type CandidateKey,
  type DiscriminatorColumnStats,
  type KeyDiscoveryStats,
  type KeyRecommendation,
} from "./key-discovery";

export interface GateUccDiscoveryInput {
  mappedRows: Record<string, unknown>[];
  mappedColumns: string[];
  currentKeyColumns: string[];
  thorough?: boolean;
}

export interface GateUccDiscoveryResult {
  candidateKeys: Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }>;
  recommendation: (KeyRecommendation & { source: "DETERMINISTIC" }) | null;
  validationStats: KeyDiscoveryStats;
  noReliableKeyReason: string | null;
}

const STABLE_NAME_PATTERN =
  /\b(id|key|code|number|num|no|ref|sku|job|order|invoice|customer|vendor|account|line)\b/i;

export async function discoverGateKeyCandidates(
  input: GateUccDiscoveryInput
): Promise<GateUccDiscoveryResult> {
  const columns = uniqueStrings(input.mappedColumns).filter(Boolean);
  const rows = input.mappedRows.filter((row) => !isFullyBlankMappedRow(row));
  const blankRowsSkipped = input.mappedRows.length - rows.length;
  const currentKeyColumns = uniqueStrings(input.currentKeyColumns).filter(Boolean);
  const duplicateContext = analyzeCurrentKeyDuplicateGroups(rows, columns, currentKeyColumns);

  if (rows.length === 0 || columns.length === 0) {
    const stats = buildStats({
      inputRowCount: input.mappedRows.length,
      blankRowsSkipped,
      rowCount: rows.length,
      columns,
      currentKeyColumns,
      duplicateContext,
      queriesExecuted: 0,
      levelsSearched: 0,
      timedOut: false,
      durationMs: 0,
    });

    return {
      candidateKeys: [],
      recommendation: null,
      validationStats: stats,
      noReliableKeyReason: "No nonblank mapped rows were available for UCC key discovery.",
    };
  }

  const session = await createAnalyticsSession();
  try {
    await session.loadRows(rows, "staging");
    const profile = await session.profileTable("staging");
    const result = await discoverUCCs(session, "staging", profile, {
      skipPruning: input.thorough ?? true,
    });

    const uccCandidates = result.uccs
      .filter((ucc) => ucc.verified && ucc.quality.allColumnsNotNull)
      .map((ucc) => toCandidateKey(ucc, {
        rowCount: rows.length,
        currentKeyColumns,
        discriminatorColumns: duplicateContext.discriminatorColumns.map((column) => column.column),
      }))
    const targeted = await discoverCurrentKeyDiscriminatorCandidates({
      session,
      tableName: "staging",
      rowCount: rows.length,
      profileColumns: profile.columns.map((column) => ({
        name: column.name,
        nullCount: column.nullCount,
      })),
      currentKeyColumns,
      discriminatorColumns: duplicateContext.discriminatorColumns.map((column) => column.column),
      existingCandidates: uccCandidates,
    });

    const candidates = dedupeCandidates([...uccCandidates, ...targeted.candidates])
      .sort(compareCandidates);

    const stats = buildStats({
      inputRowCount: input.mappedRows.length,
      blankRowsSkipped,
      rowCount: rows.length,
      columns: result.analyzedColumns,
      excludedColumns: result.excludedColumns,
      currentKeyColumns,
      duplicateContext,
      queriesExecuted: result.stats.queriesExecuted + targeted.queriesExecuted,
      levelsSearched: result.stats.levelsSearched,
      timedOut: Boolean(result.stats.timedOut),
      durationMs: result.stats.totalDurationMs,
    });

    const top = candidates[0] ?? null;

    return {
      candidateKeys: candidates,
      recommendation: top
        ? {
            columns: top.columns,
            score: top.score,
            source: "DETERMINISTIC",
            reason: deterministicUccReason(top, currentKeyColumns),
          }
        : null,
      validationStats: stats,
      noReliableKeyReason: top ? null : buildNoReliableKeyReason(stats),
    };
  } finally {
    await session.close();
  }
}

async function discoverCurrentKeyDiscriminatorCandidates(input: {
  session: Awaited<ReturnType<typeof createAnalyticsSession>>;
  tableName: string;
  rowCount: number;
  profileColumns: Array<{ name: string; nullCount: number }>;
  currentKeyColumns: string[];
  discriminatorColumns: string[];
  existingCandidates: CandidateKey[];
}): Promise<{
  candidates: Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }>;
  queriesExecuted: number;
}> {
  if (input.currentKeyColumns.length === 0 || input.discriminatorColumns.length === 0) {
    return { candidates: [], queriesExecuted: 0 };
  }

  const nullCounts = new Map(
    input.profileColumns.map((column) => [column.name.toLowerCase(), column.nullCount])
  );
  const availableColumns = new Map(
    input.profileColumns.map((column) => [column.name.toLowerCase(), column.name])
  );
  const currentKey = input.currentKeyColumns
    .map((column) => availableColumns.get(column.toLowerCase()))
    .filter((column): column is string => Boolean(column));
  const discriminators = input.discriminatorColumns
    .map((column) => availableColumns.get(column.toLowerCase()))
    .filter((column): column is string => Boolean(column))
    .slice(0, 12);

  if (currentKey.length !== input.currentKeyColumns.length) {
    return { candidates: [], queriesExecuted: 0 };
  }

  const existing = new Set(input.existingCandidates.map((candidate) => keySignature(candidate.columns)));
  const candidates: Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }> = [];
  let queriesExecuted = 0;

  for (let width = 1; width <= Math.min(3, discriminators.length); width++) {
    for (const discriminatorSet of combinations(discriminators, width)) {
      const columns = uniqueStrings([...currentKey, ...discriminatorSet]);
      const signature = keySignature(columns);
      if (existing.has(signature)) continue;
      if (columns.some((column) => (nullCounts.get(column.toLowerCase()) ?? 0) > 0)) continue;

      const isUnique = await verifyUniqueColumns(input.session, input.tableName, columns);
      queriesExecuted++;
      if (!isUnique) continue;

      existing.add(signature);
      const candidate: CandidateKey & { unique: true; source: "UCC"; quality: unknown } = {
        columns,
        unique: true,
        nullCount: 0,
        duplicateCount: 0,
        coverage: input.rowCount > 0 ? 1 : 0,
        width: columns.length,
        score: 0,
        source: "UCC",
        quality: {
          columnCount: columns.length,
          totalNullCount: 0,
          hasIdPattern: columns.some((column) => STABLE_NAME_PATTERN.test(column)),
          allColumnsNotNull: true,
          currentKeyDiscriminator: true,
        },
      };
      candidate.score = scoreUccCandidate(candidate, {
        currentKeyColumns: input.currentKeyColumns,
        discriminatorColumns: input.discriminatorColumns,
      });
      candidates.push(candidate);
    }
  }

  return { candidates, queriesExecuted };
}

async function verifyUniqueColumns(
  session: Awaited<ReturnType<typeof createAnalyticsSession>>,
  tableName: string,
  columns: string[]
): Promise<boolean> {
  const distinctExpression = columns.length === 1
    ? quoteIdent(columns[0])
    : `(${columns.map(quoteIdent).join(", ")})`;
  const result = await session.query<Record<string, unknown>>(
    `SELECT COUNT(DISTINCT ${distinctExpression}) = COUNT(*) AS is_unique FROM ${quoteIdent(tableName)}`
  );
  return result[0]?.is_unique === true;
}

function toCandidateKey(
  ucc: DiscoveredUCC,
  context: {
    rowCount: number;
    currentKeyColumns: string[];
    discriminatorColumns: string[];
  }
): CandidateKey & { unique: true; source: "UCC"; quality: unknown } {
  const candidate: CandidateKey & { unique: true; source: "UCC"; quality: unknown } = {
    columns: ucc.columns,
    unique: true,
    nullCount: ucc.quality.totalNullCount,
    duplicateCount: 0,
    coverage: context.rowCount > 0 ? 1 : 0,
    width: ucc.columns.length,
    score: 0,
    source: "UCC",
    quality: ucc.quality,
  };

  candidate.score = scoreUccCandidate(candidate, context);
  return candidate;
}

function scoreUccCandidate(
  candidate: CandidateKey,
  context: {
    currentKeyColumns: string[];
    discriminatorColumns: string[];
  }
): number {
  const columns = candidate.columns.map((column) => column.toLowerCase());
  const currentKey = context.currentKeyColumns.map((column) => column.toLowerCase());
  const discriminators = context.discriminatorColumns.map((column) => column.toLowerCase());
  const includesCurrentKey = currentKey.length > 0 && currentKey.every((column) => columns.includes(column));
  const includesDiscriminator = discriminators.some((column) => columns.includes(column));
  const stableNameCount = candidate.columns.filter((column) => STABLE_NAME_PATTERN.test(column)).length;

  let score = 1_000;
  if (includesCurrentKey && candidate.columns.length > currentKey.length) score += 400;
  if (includesDiscriminator) score += 180;
  if (candidate.nullCount === 0) score += 100;
  score += stableNameCount * 35;
  score -= candidate.width * 25;
  score -= candidate.nullCount * 10;
  return score;
}

function compareCandidates(a: CandidateKey, b: CandidateKey): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.width !== b.width) return a.width - b.width;
  return a.columns.join("|").localeCompare(b.columns.join("|"));
}

function dedupeCandidates(
  candidates: Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }>
): Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }> {
  const seen = new Set<string>();
  const result: Array<CandidateKey & { unique: true; source: "UCC"; quality: unknown }> = [];

  for (const candidate of candidates) {
    const signature = keySignature(candidate.columns);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(candidate);
  }

  return result;
}

function deterministicUccReason(candidate: CandidateKey, currentKeyColumns: string[]): string {
  const currentKey = currentKeyColumns.map((column) => column.toLowerCase());
  const includesCurrentKey =
    currentKey.length > 0 &&
    currentKey.every((column) => candidate.columns.some((candidateColumn) => candidateColumn.toLowerCase() === column));

  if (includesCurrentKey && candidate.columns.length > currentKey.length) {
    return "UCC discovery verified this null-free key and it extends the current key with discriminator columns.";
  }

  return "UCC discovery verified this null-free unique key across the mapped upload rows.";
}

function buildStats(input: {
  inputRowCount: number;
  blankRowsSkipped: number;
  rowCount: number;
  columns: string[];
  excludedColumns?: string[];
  currentKeyColumns: string[];
  duplicateContext: ReturnType<typeof analyzeCurrentKeyDuplicateGroups>;
  queriesExecuted: number;
  levelsSearched: number;
  timedOut: boolean;
  durationMs: number;
}): KeyDiscoveryStats {
  const maxWidth = input.levelsSearched;
  return {
    rowCount: input.rowCount,
    inputRowCount: input.inputRowCount,
    blankRowsSkipped: input.blankRowsSkipped,
    columnsAnalyzed: input.columns.length,
    combinationsTested: input.queriesExecuted,
    maxWidth,
    maxColumns: input.columns.length,
    maxCombinations: input.queriesExecuted,
    truncated: input.timedOut,
    destinationValidated: false,
    destinationValidationMode: "UPLOAD_ONLY",
    discoveryMode: "UCC",
    searchExhaustive: !input.timedOut,
    columnsConsidered: input.columns,
    columnsExcluded: (input.excludedColumns ?? []).map((column) => ({
      column,
      reason: "Excluded by UCC pruning.",
    })),
    discriminatorColumns: input.duplicateContext.discriminatorColumns,
    currentKeyDuplicateGroupCount: input.duplicateContext.duplicateGroupCount,
    currentKeyColumns: input.currentKeyColumns,
    candidateSearchLimits: {
      maxWidth,
      maxColumns: input.columns.length,
      maxCombinations: input.queriesExecuted,
      combinationsTested: input.queriesExecuted,
    },
    levelsSearched: input.levelsSearched,
    timedOut: input.timedOut,
    durationMs: input.durationMs,
  };
}

function buildNoReliableKeyReason(stats: KeyDiscoveryStats): string {
  const blankNote = stats.blankRowsSkipped > 0
    ? " Fully blank mapped rows were excluded from key discovery and counted separately."
    : "";

  if (stats.timedOut || !stats.searchExhaustive) {
    return `No reliable key was found before UCC discovery completed. Hermod checked ${stats.combinationsTested} UCC query batches across ${stats.columnsAnalyzed} mapped columns.${blankNote}`;
  }

  return `No null-free unique key was found by UCC after checking ${stats.columnsAnalyzed} mapped columns up to width ${stats.levelsSearched ?? stats.maxWidth}.${blankNote}`;
}

function analyzeCurrentKeyDuplicateGroups(
  rows: Record<string, unknown>[],
  columns: string[],
  currentKeyColumns: string[]
): {
  duplicateGroupCount: number;
  discriminatorColumns: DiscriminatorColumnStats[];
} {
  if (currentKeyColumns.length === 0) {
    return { duplicateGroupCount: 0, discriminatorColumns: [] };
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (currentKeyColumns.some((column) => isBlankValue(row[column]))) continue;
    const signature = JSON.stringify(currentKeyColumns.map((column) => normalizeValue(row[column])));
    const group = groups.get(signature);
    if (group) group.push(row);
    else groups.set(signature, [row]);
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const currentKeySet = new Set(currentKeyColumns.map((column) => column.toLowerCase()));
  const discriminatorColumns = columns
    .filter((column) => !currentKeySet.has(column.toLowerCase()))
    .map((column) => {
      const distinctAllRows = new Set<string>();
      let nullCount = 0;
      let duplicateGroupsSeparated = 0;

      for (const row of rows) {
        if (isBlankValue(row[column])) nullCount++;
        else distinctAllRows.add(JSON.stringify(normalizeValue(row[column])));
      }

      for (const group of duplicateGroups) {
        const groupValues = new Set(group.map((row) => JSON.stringify(normalizeValue(row[column]))));
        if (groupValues.size > 1) duplicateGroupsSeparated++;
      }

      return {
        column,
        duplicateGroupsSeparated,
        nullCount,
        distinctCount: distinctAllRows.size,
      };
    })
    .filter((column) => column.duplicateGroupsSeparated > 0)
    .sort((a, b) => {
      if (b.duplicateGroupsSeparated !== a.duplicateGroupsSeparated) {
        return b.duplicateGroupsSeparated - a.duplicateGroupsSeparated;
      }
      if (a.nullCount !== b.nullCount) return a.nullCount - b.nullCount;
      return a.column.localeCompare(b.column);
    });

  return {
    duplicateGroupCount: duplicateGroups.length,
    discriminatorColumns,
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function keySignature(columns: string[]): string {
  return [...columns].map((column) => column.toLowerCase()).sort().join("\u0000");
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function combinations<T>(values: T[], width: number): T[][] {
  if (width === 0) return [[]];
  if (width > values.length) return [];
  if (width === values.length) return [values];

  const result: T[][] = [];
  function visit(start: number, current: T[]) {
    if (current.length === width) {
      result.push([...current]);
      return;
    }

    for (let index = start; index < values.length; index++) {
      current.push(values[index]);
      visit(index + 1, current);
      current.pop();
    }
  }

  visit(0, []);
  return result;
}

function isFullyBlankMappedRow(row: Record<string, unknown>): boolean {
  const values = Object.values(row);
  return values.length > 0 && values.every(isBlankValue);
}

function isBlankValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function normalizeValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
