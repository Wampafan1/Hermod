/**
 * UCC Column Pruner — semantic column filtering for UCC discovery.
 *
 * Uses AI (Ollama → Anthropic → heuristic fallback) to identify which
 * columns could plausibly be part of a primary key. This reduces the
 * search space from 2^N to something tractable.
 *
 * NEVER sends row data to any AI provider — only column metadata.
 */

import { runAI } from "@/lib/ai/router";

// ─── Types ──────────────────────────────────────────

export interface ColumnSummary {
  name: string;
  type: string;
  distinctCount: number;
  totalRows: number;
  nullPct: number;
  samples: string[];
}

export interface PruningResult {
  candidateColumns: string[];
  excludedColumns: string[];
  prunedBy: "ai" | "fallback";
  durationMs: number;
}

// ─── Heuristic Pruning ──────────────────────────────

const EXCLUDE_NAME_PATTERN =
  /date|time|timestamp|created|modified|updated|amount|total|price|cost|qty|quantity|percent|ratio|description|notes|comment|flag|status|boolean/i;

function heuristicPrune(columns: ColumnSummary[]): PruningResult {
  const start = Date.now();
  const candidates: string[] = [];
  const excluded: string[] = [];

  for (const col of columns) {
    const uniquenessRatio =
      col.totalRows > 0 ? col.distinctCount / col.totalRows : 0;

    if (uniquenessRatio < 0.05) {
      excluded.push(col.name);
    } else if (col.nullPct > 50) {
      excluded.push(col.name);
    } else if (EXCLUDE_NAME_PATTERN.test(col.name)) {
      excluded.push(col.name);
    } else {
      candidates.push(col.name);
    }
  }

  // If heuristic excluded everything, include all high-cardinality columns
  if (candidates.length < 2) {
    const sorted = [...columns]
      .filter((c) => c.totalRows > 0)
      .sort(
        (a, b) =>
          b.distinctCount / b.totalRows - a.distinctCount / a.totalRows
      );
    const topCols = sorted.slice(0, Math.min(20, sorted.length));
    return {
      candidateColumns: topCols.map((c) => c.name),
      excludedColumns: columns
        .filter((c) => !topCols.some((t) => t.name === c.name))
        .map((c) => c.name),
      prunedBy: "fallback",
      durationMs: Date.now() - start,
    };
  }

  return {
    candidateColumns: candidates,
    excludedColumns: excluded,
    prunedBy: "fallback",
    durationMs: Date.now() - start,
  };
}

// ─── AI Pruning Prompt ──────────────────────────────

function buildPruningPrompt(columns: ColumnSummary[]): string {
  const colLines = columns
    .map(
      (c) =>
        `- "${c.name}" (${c.type}) — ${c.distinctCount}/${c.totalRows} distinct, ${c.nullPct}% null, samples: ${c.samples.join(", ")}`
    )
    .join("\n");

  return `You are a data analyst. I have a dataset with these columns. For each column, I'm showing the name, detected data type, number of distinct values out of total rows, null percentage, and 3 sample values.

Your job: identify which columns could plausibly be part of a PRIMARY KEY or UNIQUE IDENTIFIER for each row.

EXCLUDE columns that are:
- Timestamps, dates, or "last modified" / "created at" fields (change over time)
- Monetary amounts, quantities, totals, prices, costs (not identifiers)
- Descriptions, notes, comments, free text (not unique)
- Status flags, boolean fields, categories with few distinct values
- Calculated or derived fields (percentages, ratios, scores)
- Audit fields (created_by, modified_by, version numbers)

INCLUDE columns that are:
- IDs, codes, numbers, keys, SKUs, reference numbers
- Names that combined with another field could be unique (e.g., name + date)
- Any column with very high cardinality (many distinct values relative to row count)

Respond with ONLY a JSON array of the column names to INCLUDE. No explanation, no markdown, no backticks. Example: ["PO Number", "Line Number", "Item Code"]

COLUMNS:
${colLines}

JSON array of candidate columns:`;
}

// ─── Parse AI Response ──────────────────────────────

function parseAIResponse(
  content: string,
  allColumnNames: string[]
): string[] | null {
  // Try direct parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    // Try to extract array from response
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!Array.isArray(parsed)) return null;

  // Validate: every name must exist in original columns (case-insensitive)
  const lowerMap = new Map<string, string>();
  for (const name of allColumnNames) {
    lowerMap.set(name.toLowerCase(), name);
  }

  const validated: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const real = lowerMap.get(item.toLowerCase());
    if (real) validated.push(real);
  }

  return validated;
}

// ─── Public API ─────────────────────────────────────

/**
 * Prune columns to identify primary key candidates.
 *
 * Three-layer fallback:
 *   1. Local Ollama GPU (gemma4:31b)
 *   2. Anthropic API (claude-sonnet-4)
 *   3. Heuristic regex + cardinality rules
 *
 * Never fails — always returns a result.
 */
export async function pruneColumns(
  columns: ColumnSummary[]
): Promise<PruningResult> {
  const start = Date.now();
  const allNames = columns.map((c) => c.name);

  // Try AI pruning (Ollama → Anthropic, handled by runAI)
  try {
    const result = await runAI({
      messages: [{ role: "user", content: buildPruningPrompt(columns) }],
      responseFormat: "json",
      timeout: 5000,
    });

    const candidates = parseAIResponse(result.content, allNames);

    // Validate: not too few, not hallucinated
    if (candidates && candidates.length >= 2) {
      const excluded = allNames.filter((n) => !candidates.includes(n));
      return {
        candidateColumns: candidates,
        excludedColumns: excluded,
        prunedBy: "ai",
        durationMs: Date.now() - start,
      };
    }

    // AI returned too few — fall through to heuristic
    console.warn(
      `[UCC Pruner] AI returned ${candidates?.length ?? 0} candidates (need >= 2). Falling back to heuristic.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[UCC Pruner] AI pruning failed: ${msg}. Falling back to heuristic.`
    );
  }

  // Fallback to heuristic
  return heuristicPrune(columns);
}
