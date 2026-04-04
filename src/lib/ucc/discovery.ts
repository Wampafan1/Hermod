/**
 * UCC Discovery Engine — lattice search for minimal unique column combinations.
 *
 * Uses DuckDB SQL against the FULL dataset. No sampling, no confidence scores.
 * A column set is either unique across every row, or it isn't. Period.
 *
 * Algorithm: level-wise lattice search with pigeonhole + minimality pruning.
 *   Level 1: single columns (one query for all)
 *   Level 2: 2-column pairs (batched, pigeonhole-pruned)
 *   Level 3: 3-column triples (batched, minimality-pruned)
 *   Level 4: 4-column quads (max depth — 5+ column keys are not real keys)
 */

import type { AnalyticsSession, ColumnProfile } from "@/lib/duckdb/engine";
import { pruneColumns } from "./column-pruner";
import type { ColumnSummary } from "./column-pruner";

// ─── Types ──────────────────────────────────────────

export interface UCCResult {
  uccs: DiscoveredUCC[];
  noKeyExists: boolean;
  analyzedColumns: string[];
  excludedColumns: string[];
  stats: UCCStats;
}

export interface UCCStats {
  totalRows: number;
  totalColumns: number;
  candidateColumns: number;
  levelsSearched: number;
  queriesExecuted: number;
  totalDurationMs: number;
  pruningDurationMs: number;
  discoveryDurationMs: number;
  timedOut?: boolean;
}

export interface DiscoveredUCC {
  columns: string[];
  type: "single" | "composite";
  verified: true;
  rowCount: number;
  quality: {
    columnCount: number;
    totalNullCount: number;
    hasIdPattern: boolean;
    allColumnsNotNull: boolean;
  };
}

// ─── Helpers ────────────────────────────────────────

const ID_PATTERN = /id|key|code|number|sku|ref|num|no\b/i;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Check if a set is a superset of any set in the collection */
function isSupersetOfAny(
  candidate: string[],
  minimalSets: string[][]
): boolean {
  return minimalSets.some((minimal) =>
    minimal.every((col) => candidate.includes(col))
  );
}

/** Generate all k-sized combinations from an array */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr];

  const result: T[][] = [];

  function recurse(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      recurse(i + 1, current);
      current.pop();
    }
  }

  recurse(0, []);
  return result;
}

// ─── Discovery Engine ───────────────────────────────

interface ProfileData {
  rowCount: number;
  columns: ColumnProfile[];
}

/**
 * Discover all minimal unique column combinations in a DuckDB table.
 *
 * @param session - An active DuckDB AnalyticsSession with data loaded in `tableName`
 * @param tableName - The table to analyze
 * @param allColumns - All column names available (from profile or table info)
 */
export async function discoverUCCs(
  session: AnalyticsSession,
  tableName: string,
  profile: ProfileData
): Promise<UCCResult> {
  const totalStart = Date.now();
  const TIMEOUT_MS = 30_000;
  let queriesExecuted = 0;
  let levelsSearched = 0;
  let timedOut = false;

  const rowCount = profile.rowCount;

  // Early exit for empty or single-row tables
  if (rowCount <= 1) {
    const allCols = profile.columns.map((c) => c.name);
    return {
      uccs: allCols.map((col) => ({
        columns: [col],
        type: "single" as const,
        verified: true as const,
        rowCount,
        quality: {
          columnCount: 1,
          totalNullCount: 0,
          hasIdPattern: ID_PATTERN.test(col),
          allColumnsNotNull: true,
        },
      })),
      noKeyExists: false,
      analyzedColumns: allCols,
      excludedColumns: [],
      stats: {
        totalRows: rowCount,
        totalColumns: allCols.length,
        candidateColumns: allCols.length,
        levelsSearched: 0,
        queriesExecuted: 0,
        totalDurationMs: Date.now() - totalStart,
        pruningDurationMs: 0,
        discoveryDurationMs: 0,
      },
    };
  }

  // Build column summaries for AI pruner
  const columnSummaries: ColumnSummary[] = profile.columns.map((c) => ({
    name: c.name,
    type: c.duckdbType,
    distinctCount: c.distinctCount,
    totalRows: rowCount,
    nullPct: Math.round(c.nullPercentage * 100) / 100,
    samples: c.sampleValues.slice(0, 3),
  }));

  // Run AI pruning
  const pruneStart = Date.now();
  const pruning = await pruneColumns(columnSummaries);
  const pruningDurationMs = Date.now() - pruneStart;

  const candidates = pruning.candidateColumns;
  const excludedColumns = pruning.excludedColumns;

  // Reduce max depth for huge datasets
  const maxDepth =
    profile.columns.length > 500 || rowCount > 1_000_000 ? 3 : 4;

  // Build cardinality map for pigeonhole pruning
  const cardMap = new Map<string, number>();
  for (const col of profile.columns) {
    cardMap.set(col.name, col.distinctCount);
  }

  // Build null count map
  const nullMap = new Map<string, number>();
  for (const col of profile.columns) {
    nullMap.set(col.name, col.nullCount);
  }

  const discoveryStart = Date.now();
  const allFoundUCCs: DiscoveredUCC[] = [];
  const foundMinimalSets: string[][] = []; // for minimality pruning

  function isTimedOut(): boolean {
    if (Date.now() - totalStart > TIMEOUT_MS) {
      timedOut = true;
      return true;
    }
    return false;
  }

  function makeUCC(cols: string[]): DiscoveredUCC {
    const totalNullCount = cols.reduce(
      (sum, c) => sum + (nullMap.get(c) ?? 0),
      0
    );
    return {
      columns: cols,
      type: cols.length === 1 ? "single" : "composite",
      verified: true,
      rowCount,
      quality: {
        columnCount: cols.length,
        totalNullCount,
        hasIdPattern: cols.some((c) => ID_PATTERN.test(c)),
        allColumnsNotNull: totalNullCount === 0,
      },
    };
  }

  // ─── Level 1: Single columns ──────────────────────
  if (!isTimedOut() && candidates.length > 0) {
    levelsSearched = 1;

    const checkParts = candidates.map(
      (col, idx) =>
        `COUNT(DISTINCT ${quoteIdent(col)}) = COUNT(*) AS col_${idx}`
    );

    const sql = `SELECT ${checkParts.join(", ")} FROM ${quoteIdent(tableName)}`;
    const results = await session.query<Record<string, unknown>>(sql);
    queriesExecuted++;

    const row = results[0] ?? {};
    const nonUniqueSingles: string[] = [];

    for (let ci = 0; ci < candidates.length; ci++) {
      const col = candidates[ci];
      const isUnique = row[`col_${ci}`];
      if (isUnique === true) {
        allFoundUCCs.push(makeUCC([col]));
        foundMinimalSets.push([col]);
      } else {
        nonUniqueSingles.push(col);
      }
    }

    // ─── Level 2: Two-column pairs ────────────────────
    if (!isTimedOut() && nonUniqueSingles.length >= 2) {
      levelsSearched = 2;

      const pairs = combinations(nonUniqueSingles, 2).filter((pair) => {
        // Pigeonhole pruning
        const cardA = cardMap.get(pair[0]) ?? 0;
        const cardB = cardMap.get(pair[1]) ?? 0;
        return cardA * cardB >= rowCount;
      });

      // Batch queries (20 pairs per query)
      const BATCH_SIZE = 20;
      for (let i = 0; i < pairs.length && !isTimedOut(); i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        const parts = batch.map((pair, idx) => {
          const tupleExpr = `(${pair.map(quoteIdent).join(", ")})`;
          return `COUNT(DISTINCT ${tupleExpr}) = COUNT(*) AS ${quoteIdent(`pair_${idx}`)}`;
        });

        const sql = `SELECT ${parts.join(", ")} FROM ${quoteIdent(tableName)}`;
        const results = await session.query<Record<string, unknown>>(sql);
        queriesExecuted++;

        const row = results[0] ?? {};
        for (let j = 0; j < batch.length; j++) {
          if (row[`pair_${j}`] === true) {
            allFoundUCCs.push(makeUCC(batch[j]));
            foundMinimalSets.push(batch[j]);
          }
        }
      }

      // ─── Level 3: Three-column triples ────────────────
      if (!isTimedOut() && nonUniqueSingles.length >= 3 && maxDepth >= 3) {
        levelsSearched = 3;

        const triples = combinations(nonUniqueSingles, 3).filter((triple) => {
          // Minimality: skip if superset of already-found UCC
          if (isSupersetOfAny(triple, foundMinimalSets)) return false;
          // Pigeonhole: product of cardinalities must >= rowCount
          const product = triple.reduce(
            (p, c) => p * (cardMap.get(c) ?? 0),
            1
          );
          return product >= rowCount;
        });

        const BATCH_SIZE = 15;
        for (let i = 0; i < triples.length && !isTimedOut(); i += BATCH_SIZE) {
          const batch = triples.slice(i, i + BATCH_SIZE);
          const parts = batch.map((triple, idx) => {
            const tupleExpr = `(${triple.map(quoteIdent).join(", ")})`;
            return `COUNT(DISTINCT ${tupleExpr}) = COUNT(*) AS ${quoteIdent(`tri_${idx}`)}`;
          });

          const sql = `SELECT ${parts.join(", ")} FROM ${quoteIdent(tableName)}`;
          const results = await session.query<Record<string, unknown>>(sql);
          queriesExecuted++;

          const row = results[0] ?? {};
          for (let j = 0; j < batch.length; j++) {
            if (row[`tri_${j}`] === true) {
              allFoundUCCs.push(makeUCC(batch[j]));
              foundMinimalSets.push(batch[j]);
            }
          }
        }

        // ─── Level 4: Four-column quads ───────────────────
        if (!isTimedOut() && nonUniqueSingles.length >= 4 && maxDepth >= 4) {
          levelsSearched = 4;

          const quads = combinations(nonUniqueSingles, 4).filter((quad) => {
            if (isSupersetOfAny(quad, foundMinimalSets)) return false;
            const product = quad.reduce(
              (p, c) => p * (cardMap.get(c) ?? 0),
              1
            );
            return product >= rowCount;
          });

          const BATCH_SIZE = 10;
          for (
            let i = 0;
            i < quads.length && !isTimedOut();
            i += BATCH_SIZE
          ) {
            const batch = quads.slice(i, i + BATCH_SIZE);
            const parts = batch.map((quad, idx) => {
              const tupleExpr = `(${quad.map(quoteIdent).join(", ")})`;
              return `COUNT(DISTINCT ${tupleExpr}) = COUNT(*) AS ${quoteIdent(`quad_${idx}`)}`;
            });

            const sql = `SELECT ${parts.join(", ")} FROM ${quoteIdent(tableName)}`;
            const results = await session.query<Record<string, unknown>>(sql);
            queriesExecuted++;

            const row = results[0] ?? {};
            for (let j = 0; j < batch.length; j++) {
              if (row[`quad_${j}`] === true) {
                allFoundUCCs.push(makeUCC(batch[j]));
                foundMinimalSets.push(batch[j]);
              }
            }
          }
        }
      }
    }
  }

  // ─── Rank results ─────────────────────────────────
  allFoundUCCs.sort((a, b) => {
    // 1. Fewer columns first
    if (a.quality.columnCount !== b.quality.columnCount)
      return a.quality.columnCount - b.quality.columnCount;
    // 2. All not-null preferred
    if (a.quality.allColumnsNotNull !== b.quality.allColumnsNotNull)
      return a.quality.allColumnsNotNull ? -1 : 1;
    // 3. ID-like pattern preferred
    if (a.quality.hasIdPattern !== b.quality.hasIdPattern)
      return a.quality.hasIdPattern ? -1 : 1;
    // 4. Fewer total nulls
    return a.quality.totalNullCount - b.quality.totalNullCount;
  });

  return {
    uccs: allFoundUCCs,
    noKeyExists: allFoundUCCs.length === 0,
    analyzedColumns: candidates,
    excludedColumns,
    stats: {
      totalRows: rowCount,
      totalColumns: profile.columns.length,
      candidateColumns: candidates.length,
      levelsSearched,
      queriesExecuted,
      totalDurationMs: Date.now() - totalStart,
      pruningDurationMs,
      discoveryDurationMs: Date.now() - discoveryStart,
      timedOut,
    },
  };
}
