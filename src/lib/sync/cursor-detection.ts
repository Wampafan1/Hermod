/**
 * AI Cursor Detection — analyzes a source table schema and identifies
 * the best incremental sync strategy.
 *
 * Called ONCE at pipeline creation time, never during execution.
 * Uses the existing LLM abstraction (getLlmProvider).
 */

import { getLlmProvider } from "@/lib/llm";
import type { ColumnSchema, CursorConfig } from "./types";

// ─── Detection Input ─────────────────────────────────

interface DetectionInput {
  tableName: string;
  sourceSystem: string;
  realm: string;
  columns: ColumnSchema[];
}

// ─── System Prompt ───────────────────────────────────

const SYSTEM_PROMPT = `You are a data engineering expert embedded in Hermod, a data pipeline product.

Your job is to analyze a database table schema and identify the best strategy for incremental sync — fetching only rows that changed since the last run rather than reloading the entire table.

## Strategies (in order of preference)

1. **timestamp_cursor** — A datetime column that is updated whenever a row is modified. Look for columns named like: lastModifiedDate, updated_at, UpdatedOn, ModifiedDate, DateLastModified, last_updated, modified, changed_at, record_timestamp, SystemModstamp (Salesforce), dateModified, auditModifiedDate, etc. Type must be a datetime/timestamp variant.

2. **integer_id_cursor** — A monotonically increasing integer PK. Only valid for INSERT-only tables (logs, events, transactions, audit trails). Do NOT recommend this for master data tables (items, customers, vendors, accounts) — those get updated.

3. **rowversion_cursor** — SQL Server specific. A column of type rowversion, timestamp (binary 8), or RowVer. These change on every update and can be compared as integers.

4. **full_refresh** — No usable cursor exists. The entire table must be reloaded on every sync. Use this as a last resort only.

## Scoring criteria

- Exact name matches to known patterns: +40 points
- Partial/fuzzy name matches: +20 points
- Correct data type for strategy: +30 points
- Column is indexed: +10 points
- Column is nullable (bad for cursors): -15 points
- Source system knowledge (e.g. NetSuite always has lastModifiedDate): +15 points

## Primary key detection

Also identify the best column to use as the MERGE key at the destination:
- Prefer columns named: id, internalId, externalId, record_id, entity_id, pk, primary_key, [TableName]Id
- Must be NOT NULL
- Prefer integer or UUID types

## Output format

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON. Use this exact structure:

{
  "strategy": "timestamp_cursor" | "integer_id_cursor" | "rowversion_cursor" | "full_refresh",
  "cursorColumn": "column_name" | null,
  "cursorColumnType": "raw_type_string" | null,
  "primaryKey": "column_name" | null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "One or two sentences explaining the choice in plain English. Mention the column name and why it was chosen.",
  "warnings": ["array of strings — soft delete caveat, nullable cursor caveat, etc."],
  "candidates": [
    { "column": "name", "strategy": "timestamp_cursor", "score": 85, "reason": "Brief reason" }
  ]
}

The candidates array should include ALL columns you considered for any strategy, sorted by score descending. Include at most 5 candidates.`;

// ─── Public API ──────────────────────────────────────

export async function detectCursorStrategy(input: DetectionInput): Promise<CursorConfig> {
  const userMessage = buildDetectionPrompt(input);

  try {
    const llm = getLlmProvider();
    const response = await llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 1024,
      temperature: 0,
    });

    const parsed = JSON.parse(response.content) as CursorConfig;

    if (!parsed.strategy || !parsed.confidence) {
      throw new Error("Missing required fields in AI response");
    }

    // Validate AI-returned cursorColumn exists in the actual source schema
    if (parsed.cursorColumn) {
      const columnNames = input.columns.map((c) => c.name.toLowerCase());
      if (!columnNames.includes(parsed.cursorColumn.toLowerCase())) {
        const badCol = parsed.cursorColumn;
        console.warn(
          `[CursorDetection] AI returned non-existent column "${badCol}", falling back`
        );
        parsed.warnings.push(`AI suggested column "${badCol}" which does not exist in the source schema.`);
        parsed.strategy = "full_refresh";
        parsed.cursorColumn = null;
        parsed.cursorColumnType = null;
        parsed.confidence = "low";
        parsed.reasoning += " (Original column not found in schema — reset to full refresh.)";
      }
    }

    return parsed;
  } catch (err) {
    console.error("[CursorDetection] Failed:", err instanceof Error ? err.message : err);

    return {
      strategy: "full_refresh",
      cursorColumn: null,
      cursorColumnType: null,
      primaryKey: inferPrimaryKey(input.columns),
      confidence: "low",
      reasoning:
        "Could not automatically determine an incremental strategy. Full refresh selected as safe default.",
      warnings: ["Full refresh will reload the entire table on every sync run."],
      candidates: [],
    };
  }
}

// ─── Prompt Builder ──────────────────────────────────

export function buildDetectionPrompt(input: DetectionInput): string {
  const columnList = input.columns
    .map((c) => {
      const flags = [
        c.isPrimaryKey ? "PRIMARY KEY" : null,
        c.isIndexed ? "INDEXED" : null,
        c.nullable ? "NULLABLE" : "NOT NULL",
      ]
        .filter(Boolean)
        .join(", ");
      return `  - ${c.name} (${c.type})${flags ? " [" + flags + "]" : ""}`;
    })
    .join("\n");

  return `Source system: ${input.sourceSystem}
Table: ${input.tableName}
Hermod realm: ${input.realm}

Schema (${input.columns.length} columns):
${columnList}

Identify the best incremental sync strategy for this table.`;
}

// ─── Primary Key Inference ───────────────────────────

const PK_NAMES = ["id", "internalid", "externalid", "record_id", "entity_id", "pk", "primary_key"];

export function inferPrimaryKey(columns: ColumnSchema[]): string | null {
  const flagged = columns.find((c) => c.isPrimaryKey);
  if (flagged) return flagged.name;

  const byName = columns.find((c) => PK_NAMES.includes(c.name.toLowerCase()));
  return byName?.name ?? null;
}
