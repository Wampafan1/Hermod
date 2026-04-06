# Incremental Sync — AI Cursor Detection & Watermark Tracking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add incremental sync support to Bifrost routes — AI detects the best cursor column at setup time, watermarks track progress at execution time.

**Architecture:** Extend `BifrostRoute` with a `cursorConfig` JSON field and a related `PipelineWatermark` model. The AI cursor detection service uses the existing `getLlmProvider()` factory (not direct Anthropic SDK). Detection runs once at pipeline creation via a new API route. The engine reads the cursor config and watermarks during execution, appending WHERE clauses and updating watermarks on success. `lastCheckpoint` remains as a convenience timestamp; `PipelineWatermark` provides per-table granularity.

**Tech Stack:** Prisma ORM, Next.js API routes (withAuth), LLM abstraction (`src/lib/llm/`), Vitest, React (sync-builder UI panel)

---

## Task 1: TypeScript Types — `src/lib/sync/types.ts`

**Files:**
- Create: `src/lib/sync/types.ts`

**Step 1: Create the types file**

```typescript
// src/lib/sync/types.ts

/**
 * Incremental sync types — cursor strategies and watermark tracking.
 */

export type CursorStrategy =
  | "timestamp_cursor"
  | "integer_id_cursor"
  | "rowversion_cursor"   // SQL Server rowversion/timestamp binary column
  | "full_refresh";        // No usable cursor — truncate and reload

export type CursorConfidence = "high" | "medium" | "low";

export interface ColumnSchema {
  name: string;
  type: string;           // raw type string from source: "datetime2", "TIMESTAMP", "NUMBER(10)", etc.
  nullable: boolean;
  isPrimaryKey?: boolean;
  isIndexed?: boolean;
}

export interface CursorConfig {
  strategy: CursorStrategy;
  cursorColumn: string | null;      // null only for full_refresh
  cursorColumnType: string | null;  // raw source type
  primaryKey: string | null;        // column to MERGE on at destination
  confidence: CursorConfidence;
  reasoning: string;                // human-readable explanation shown in UI
  warnings: string[];               // e.g. "Soft deletes will not be detected"
  candidates: CursorCandidate[];    // all columns AI considered, ranked
}

export interface CursorCandidate {
  column: string;
  strategy: CursorStrategy;
  score: number;          // 0-100
  reason: string;
}

export interface WatermarkRecord {
  routeId: string;
  tableName: string;
  watermark: string;
  watermarkType: CursorStrategy;
  rowsSynced?: number;
}
```

**Step 2: Commit**

```bash
git add src/lib/sync/types.ts
git commit -m "feat(sync): add incremental sync types — cursor strategies, watermark records"
```

---

## Task 2: Prisma Schema — `PipelineWatermark` model + `cursorConfig` field

**Files:**
- Modify: `prisma/schema.prisma` (lines 286-325, BifrostRoute model)

**Step 1: Add `cursorConfig` to BifrostRoute and create PipelineWatermark model**

In `prisma/schema.prisma`, add `cursorConfig` field to `BifrostRoute` (after `lastCheckpoint` on line 314) and add the `watermarks` relation:

```prisma
  lastCheckpoint   DateTime?      // Incremental: last successful run timestamp
  cursorConfig     Json?          // CursorConfig: AI-detected cursor strategy (setup-time only)

  // Relations
  routeLogs        RouteLog[]
  helheimEntries   HelheimEntry[]
  watermarks       PipelineWatermark[]
```

Then add the new model at the end of the file (before no other model, just at the bottom):

```prisma
// ─── Pipeline Watermarks (Incremental Sync) ─────────

model PipelineWatermark {
  id            String       @id @default(cuid())
  routeId       String
  route         BifrostRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)
  tableName     String
  watermark     String       // serialized: ISO timestamp, integer ID, or hex hash
  watermarkType String       // "timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh"
  rowsSynced    Int?
  runAt         DateTime     @default(now())

  @@unique([routeId, tableName])
  @@index([routeId])
}
```

**Step 2: Generate Prisma client**

```bash
npm run db:generate
```

Expected: Prisma client regenerates with `PipelineWatermark` model and `cursorConfig` field on `BifrostRoute`.

If EPERM on Windows: `mv node_modules/.prisma node_modules/.prisma_old` then retry.

**Step 3: Push schema (additive only — safe for db push)**

```bash
npx prisma db push
```

This is safe because we're only adding a new model and a new nullable column — no renames or removals.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(sync): add PipelineWatermark model and cursorConfig field to BifrostRoute"
```

---

## Task 3: AI Cursor Detection Service — `src/lib/sync/cursor-detection.ts`

**Files:**
- Create: `src/lib/sync/cursor-detection.ts`
- Create: `src/__tests__/sync/cursor-detection.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/sync/cursor-detection.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ColumnSchema } from "@/lib/sync/types";

// Mock the LLM provider
const mockChat = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLlmProvider: () => ({ chat: mockChat, name: "mock" }),
}));

// Import AFTER mock setup
const { detectCursorStrategy, inferPrimaryKey, buildDetectionPrompt } = await import(
  "@/lib/sync/cursor-detection"
);

describe("cursor-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const NETSUITE_COLUMNS: ColumnSchema[] = [
    { name: "internalid", type: "NUMBER(10)", nullable: false, isPrimaryKey: true },
    { name: "entityid", type: "VARCHAR2(100)", nullable: true },
    { name: "companyname", type: "VARCHAR2(200)", nullable: true },
    { name: "lastmodifieddate", type: "TIMESTAMP", nullable: false },
    { name: "datecreated", type: "TIMESTAMP", nullable: true },
    { name: "isinactive", type: "VARCHAR2(1)", nullable: false },
  ];

  const SQLSERVER_COLUMNS: ColumnSchema[] = [
    { name: "Id", type: "int", nullable: false, isPrimaryKey: true },
    { name: "Name", type: "nvarchar(100)", nullable: true },
    { name: "UpdatedAt", type: "datetime2", nullable: false, isIndexed: true },
    { name: "RowVer", type: "rowversion", nullable: false },
  ];

  const LOG_COLUMNS: ColumnSchema[] = [
    { name: "log_id", type: "bigint", nullable: false, isPrimaryKey: true, isIndexed: true },
    { name: "event_type", type: "varchar(50)", nullable: false },
    { name: "created_at", type: "timestamp", nullable: false },
    { name: "payload", type: "jsonb", nullable: true },
  ];

  describe("detectCursorStrategy", () => {
    it("parses valid AI response into CursorConfig", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: "timestamp_cursor",
          cursorColumn: "lastmodifieddate",
          cursorColumnType: "TIMESTAMP",
          primaryKey: "internalid",
          confidence: "high",
          reasoning: "lastmodifieddate is a non-nullable timestamp updated on every modification.",
          warnings: ["Soft deletes will not be detected"],
          candidates: [
            { column: "lastmodifieddate", strategy: "timestamp_cursor", score: 95, reason: "Perfect cursor" },
            { column: "datecreated", strategy: "timestamp_cursor", score: 40, reason: "Only tracks creation" },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "customer",
        sourceSystem: "NetSuite",
        realm: "alfheim",
        columns: NETSUITE_COLUMNS,
      });

      expect(result.strategy).toBe("timestamp_cursor");
      expect(result.cursorColumn).toBe("lastmodifieddate");
      expect(result.primaryKey).toBe("internalid");
      expect(result.confidence).toBe("high");
      expect(result.candidates).toHaveLength(2);
      expect(result.warnings).toContain("Soft deletes will not be detected");
    });

    it("falls back to full_refresh on invalid JSON response", async () => {
      mockChat.mockResolvedValueOnce({
        content: "I cannot determine a strategy for this table",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "unknown_table",
        sourceSystem: "Generic",
        realm: "alfheim",
        columns: [{ name: "col1", type: "text", nullable: true }],
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.cursorColumn).toBeNull();
      expect(result.confidence).toBe("low");
    });

    it("falls back to full_refresh on missing required fields", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({ cursorColumn: "foo" }), // missing strategy + confidence
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "test",
      });

      const result = await detectCursorStrategy({
        tableName: "broken",
        sourceSystem: "Generic",
        realm: "alfheim",
        columns: [{ name: "foo", type: "text", nullable: true }],
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.confidence).toBe("low");
    });

    it("falls back to full_refresh on LLM error", async () => {
      mockChat.mockRejectedValueOnce(new Error("API rate limit"));

      const result = await detectCursorStrategy({
        tableName: "items",
        sourceSystem: "NetSuite",
        realm: "alfheim",
        columns: NETSUITE_COLUMNS,
      });

      expect(result.strategy).toBe("full_refresh");
      expect(result.confidence).toBe("low");
      expect(result.primaryKey).toBe("internalid"); // should still infer PK
    });

    it("sends correct system and user messages to LLM", async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: "full_refresh",
          cursorColumn: null,
          cursorColumnType: null,
          primaryKey: null,
          confidence: "low",
          reasoning: "No cursor found",
          warnings: [],
          candidates: [],
        }),
        usage: { inputTokens: 100, outputTokens: 100 },
        model: "test",
      });

      await detectCursorStrategy({
        tableName: "audit_log",
        sourceSystem: "PostgreSQL",
        realm: "alfheim",
        columns: LOG_COLUMNS,
      });

      expect(mockChat).toHaveBeenCalledOnce();
      const req = mockChat.mock.calls[0][0];
      expect(req.messages).toHaveLength(2); // system + user
      expect(req.messages[0].role).toBe("system");
      expect(req.messages[0].content).toContain("timestamp_cursor");
      expect(req.messages[1].role).toBe("user");
      expect(req.messages[1].content).toContain("audit_log");
      expect(req.messages[1].content).toContain("PostgreSQL");
      expect(req.messages[1].content).toContain("log_id");
      expect(req.responseFormat).toEqual({ type: "json_object" });
    });
  });

  describe("inferPrimaryKey", () => {
    it("returns column marked as isPrimaryKey", () => {
      expect(inferPrimaryKey(NETSUITE_COLUMNS)).toBe("internalid");
    });

    it("falls back to known PK name patterns", () => {
      const cols: ColumnSchema[] = [
        { name: "entity_id", type: "int", nullable: false },
        { name: "name", type: "text", nullable: true },
      ];
      expect(inferPrimaryKey(cols)).toBe("entity_id");
    });

    it("returns null when no PK can be inferred", () => {
      const cols: ColumnSchema[] = [
        { name: "value", type: "text", nullable: true },
        { name: "description", type: "text", nullable: true },
      ];
      expect(inferPrimaryKey(cols)).toBeNull();
    });
  });

  describe("buildDetectionPrompt", () => {
    it("formats column list with flags", () => {
      const prompt = buildDetectionPrompt({
        tableName: "items",
        sourceSystem: "SQL Server",
        realm: "alfheim",
        columns: SQLSERVER_COLUMNS,
      });

      expect(prompt).toContain("Source system: SQL Server");
      expect(prompt).toContain("Table: items");
      expect(prompt).toContain("Id (int) [PRIMARY KEY, NOT NULL]");
      expect(prompt).toContain("UpdatedAt (datetime2) [INDEXED, NOT NULL]");
      expect(prompt).toContain("RowVer (rowversion) [NOT NULL]");
      expect(prompt).toContain("Name (nvarchar(100)) [NULLABLE]");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/sync/cursor-detection.test.ts
```

Expected: FAIL — module `@/lib/sync/cursor-detection` does not exist.

**Step 3: Implement cursor-detection.ts**

Create `src/lib/sync/cursor-detection.ts`:

```typescript
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
  sourceSystem: string;       // e.g. "NetSuite", "SQL Server", "PostgreSQL"
  realm: string;              // Hermod realm name
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

    // Validate required fields
    if (!parsed.strategy || !parsed.confidence) {
      throw new Error("Missing required fields in AI response");
    }

    return parsed;
  } catch (err) {
    console.error("[CursorDetection] Failed:", err instanceof Error ? err.message : err);

    // Safe fallback — never let detection failure block pipeline creation
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
  // 1. Explicit PK flag
  const flagged = columns.find((c) => c.isPrimaryKey);
  if (flagged) return flagged.name;

  // 2. Known name patterns (case-insensitive)
  const byName = columns.find((c) => PK_NAMES.includes(c.name.toLowerCase()));
  return byName?.name ?? null;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/sync/cursor-detection.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add src/lib/sync/cursor-detection.ts src/__tests__/sync/cursor-detection.test.ts
git commit -m "feat(sync): AI cursor detection service with LLM abstraction"
```

---

## Task 4: Watermark Service — `src/lib/sync/watermark.ts`

**Files:**
- Create: `src/lib/sync/watermark.ts`
- Create: `src/__tests__/sync/watermark.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/sync/watermark.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
const mockFindFirst = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineWatermark: {
      findFirst: mockFindFirst,
      upsert: mockUpsert,
    },
  },
}));

const { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } = await import(
  "@/lib/sync/watermark"
);

describe("watermark service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWatermark", () => {
    it("returns watermark string when found", async () => {
      mockFindFirst.mockResolvedValueOnce({ watermark: "2026-01-15T08:30:00.000Z" });
      const result = await getWatermark("route-1", "customers");
      expect(result).toBe("2026-01-15T08:30:00.000Z");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { routeId_tableName: { routeId: "route-1", tableName: "customers" } },
        select: { watermark: true },
      });
    });

    it("returns null when no watermark exists", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      const result = await getWatermark("route-1", "new_table");
      expect(result).toBeNull();
    });
  });

  describe("setWatermark", () => {
    it("upserts watermark record", async () => {
      mockUpsert.mockResolvedValueOnce({});
      await setWatermark({
        routeId: "route-1",
        tableName: "customers",
        watermark: "2026-01-15T10:00:00.000Z",
        watermarkType: "timestamp_cursor",
        rowsSynced: 42,
      });

      expect(mockUpsert).toHaveBeenCalledOnce();
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where.routeId_tableName).toEqual({
        routeId: "route-1",
        tableName: "customers",
      });
      expect(call.create.watermark).toBe("2026-01-15T10:00:00.000Z");
      expect(call.update.watermark).toBe("2026-01-15T10:00:00.000Z");
    });
  });

  describe("buildIncrementalClause", () => {
    it("returns null for full_refresh", () => {
      expect(buildIncrementalClause("col", "full_refresh", "2026-01-01")).toBeNull();
    });

    it("returns null when watermark is null (first run)", () => {
      expect(buildIncrementalClause("updated_at", "timestamp_cursor", null)).toBeNull();
    });

    it("builds timestamp comparison", () => {
      const clause = buildIncrementalClause(
        "lastmodifieddate",
        "timestamp_cursor",
        "2026-01-15T08:30:00.000Z"
      );
      expect(clause).toBe("lastmodifieddate > '2026-01-15T08:30:00.000Z'");
    });

    it("builds integer ID comparison", () => {
      const clause = buildIncrementalClause("log_id", "integer_id_cursor", "98765");
      expect(clause).toBe("log_id > 98765");
    });

    it("builds rowversion comparison", () => {
      const clause = buildIncrementalClause("RowVer", "rowversion_cursor", "00000000000007D1");
      expect(clause).toBe("RowVer > 0x00000000000007D1");
    });
  });

  describe("extractNewWatermark", () => {
    it("returns null for empty rows", () => {
      expect(extractNewWatermark([], "col", "timestamp_cursor")).toBeNull();
    });

    it("returns null for full_refresh", () => {
      const rows = [{ id: 1, col: "2026-01-01" }];
      expect(extractNewWatermark(rows, "col", "full_refresh")).toBeNull();
    });

    it("extracts max timestamp", () => {
      const rows = [
        { lastmod: "2026-01-10T00:00:00.000Z" },
        { lastmod: "2026-01-15T12:00:00.000Z" },
        { lastmod: "2026-01-12T06:00:00.000Z" },
      ];
      const result = extractNewWatermark(rows, "lastmod", "timestamp_cursor");
      expect(result).toBe("2026-01-15T12:00:00.000Z");
    });

    it("extracts max integer ID", () => {
      const rows = [{ log_id: 100 }, { log_id: 250 }, { log_id: 200 }];
      const result = extractNewWatermark(rows, "log_id", "integer_id_cursor");
      expect(result).toBe("250");
    });

    it("extracts max rowversion as hex", () => {
      const rows = [
        { RowVer: "00000000000007D0" },
        { RowVer: "00000000000007D1" },
        { RowVer: "00000000000007CF" },
      ];
      const result = extractNewWatermark(rows, "RowVer", "rowversion_cursor");
      expect(result).toBe("00000000000007D1");
    });

    it("skips null cursor values", () => {
      const rows = [
        { updated_at: null },
        { updated_at: "2026-01-15T12:00:00.000Z" },
        { updated_at: null },
      ];
      const result = extractNewWatermark(rows, "updated_at", "timestamp_cursor");
      expect(result).toBe("2026-01-15T12:00:00.000Z");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/sync/watermark.test.ts
```

Expected: FAIL — module `@/lib/sync/watermark` does not exist.

**Step 3: Implement watermark.ts**

Create `src/lib/sync/watermark.ts`:

```typescript
/**
 * Watermark Service — reads and writes per-table watermarks for incremental sync.
 *
 * Called by the BifrostEngine during execution, NOT by detection.
 */

import { prisma } from "@/lib/db";
import type { WatermarkRecord, CursorStrategy } from "./types";

// ─── Read ────────────────────────────────────────────

export async function getWatermark(
  routeId: string,
  tableName: string
): Promise<string | null> {
  const row = await prisma.pipelineWatermark.findFirst({
    where: { routeId_tableName: { routeId, tableName } },
    select: { watermark: true },
  });
  return row?.watermark ?? null;
}

// ─── Write ───────────────────────────────────────────

export async function setWatermark(record: WatermarkRecord): Promise<void> {
  const key = { routeId: record.routeId, tableName: record.tableName };
  await prisma.pipelineWatermark.upsert({
    where: { routeId_tableName: key },
    create: {
      routeId: record.routeId,
      tableName: record.tableName,
      watermark: record.watermark,
      watermarkType: record.watermarkType,
      rowsSynced: record.rowsSynced ?? null,
    },
    update: {
      watermark: record.watermark,
      watermarkType: record.watermarkType,
      rowsSynced: record.rowsSynced ?? null,
      runAt: new Date(),
    },
  });
}

// ─── Query Helpers ───────────────────────────────────

/**
 * Build the WHERE clause fragment for incremental extraction.
 * Returns null for full_refresh or first run (no watermark).
 */
export function buildIncrementalClause(
  cursorColumn: string,
  strategy: CursorStrategy,
  watermark: string | null
): string | null {
  if (strategy === "full_refresh" || !watermark) return null;

  if (strategy === "timestamp_cursor") {
    return `${cursorColumn} > '${watermark}'`;
  }
  if (strategy === "integer_id_cursor") {
    return `${cursorColumn} > ${watermark}`;
  }
  if (strategy === "rowversion_cursor") {
    return `${cursorColumn} > 0x${watermark}`;
  }
  return null;
}

/**
 * Extract the new watermark value from a result set.
 * Returns null if result set is empty or strategy is full_refresh.
 */
export function extractNewWatermark(
  rows: Record<string, unknown>[],
  cursorColumn: string,
  strategy: CursorStrategy
): string | null {
  if (!rows.length || strategy === "full_refresh") return null;

  const values = rows.map((r) => r[cursorColumn]).filter((v) => v != null);
  if (!values.length) return null;

  if (strategy === "timestamp_cursor") {
    const max = values.reduce((a, b) =>
      new Date(a as string) > new Date(b as string) ? a : b
    );
    return new Date(max as string).toISOString();
  }

  if (strategy === "integer_id_cursor") {
    return String(Math.max(...values.map(Number)));
  }

  if (strategy === "rowversion_cursor") {
    const max = values.reduce((a, b) =>
      BigInt(`0x${a}`) > BigInt(`0x${b}`) ? a : b
    );
    return String(max);
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/sync/watermark.test.ts
```

Expected: All 11 tests PASS.

**Step 5: Commit**

```bash
git add src/lib/sync/watermark.ts src/__tests__/sync/watermark.test.ts
git commit -m "feat(sync): watermark service — read, write, clause builder, extractor"
```

---

## Task 5: Barrel Export — `src/lib/sync/index.ts`

**Files:**
- Create: `src/lib/sync/index.ts`

**Step 1: Create barrel file**

```typescript
// src/lib/sync/index.ts
export { detectCursorStrategy, inferPrimaryKey } from "./cursor-detection";
export { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } from "./watermark";
export type {
  CursorStrategy,
  CursorConfidence,
  CursorConfig,
  CursorCandidate,
  ColumnSchema,
  WatermarkRecord,
} from "./types";
```

**Step 2: Commit**

```bash
git add src/lib/sync/index.ts
git commit -m "feat(sync): barrel export for sync module"
```

---

## Task 6: API Route — `src/app/api/bifrost/routes/detect-cursor/route.ts`

**Files:**
- Create: `src/app/api/bifrost/routes/detect-cursor/route.ts`

**Step 1: Create the API route**

```typescript
// src/app/api/bifrost/routes/detect-cursor/route.ts

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { detectCursorStrategy } from "@/lib/sync/cursor-detection";
import type { ColumnSchema } from "@/lib/sync/types";

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const { tableName, sourceSystem, realm, columns } = body as {
    tableName: string;
    sourceSystem: string;
    realm: string;
    columns: ColumnSchema[];
  };

  if (!tableName || !columns?.length) {
    return NextResponse.json(
      { error: "tableName and columns are required" },
      { status: 400 }
    );
  }

  const config = await detectCursorStrategy({
    tableName,
    sourceSystem: sourceSystem || "Unknown",
    realm: realm || "alfheim",
    columns,
  });

  return NextResponse.json(config);
});
```

**Step 2: Commit**

```bash
git add src/app/api/bifrost/routes/detect-cursor/route.ts
git commit -m "feat(sync): detect-cursor API route with withAuth"
```

---

## Task 7: Extend Route Creation — Accept `cursorConfig`

**Files:**
- Modify: `src/lib/validations/bifrost.ts` (line 28-42, createRouteSchema)
- Modify: `src/app/api/bifrost/routes/route.ts` (line 86-104, POST handler)

**Step 1: Add cursorConfig to Zod schema**

In `src/lib/validations/bifrost.ts`, add after `timezone` field (line 41):

```typescript
  timezone: z.string().default("America/Chicago"),
  cursorConfig: z.object({
    strategy: z.enum(["timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh"]),
    cursorColumn: z.string().nullable(),
    cursorColumnType: z.string().nullable(),
    primaryKey: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    reasoning: z.string(),
    warnings: z.array(z.string()),
    candidates: z.array(z.object({
      column: z.string(),
      strategy: z.enum(["timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh"]),
      score: z.number(),
      reason: z.string(),
    })),
  }).nullable().optional(),
```

Also add it to `updateRouteSchema` (after `timezone` on line 60):

```typescript
  timezone: z.string().optional(),
  cursorConfig: z.object({
    strategy: z.enum(["timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh"]),
    cursorColumn: z.string().nullable(),
    cursorColumnType: z.string().nullable(),
    primaryKey: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    reasoning: z.string(),
    warnings: z.array(z.string()),
    candidates: z.array(z.object({
      column: z.string(),
      strategy: z.enum(["timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh"]),
      score: z.number(),
      reason: z.string(),
    })),
  }).nullable().optional(),
```

**Step 2: Persist cursorConfig in POST handler**

In `src/app/api/bifrost/routes/route.ts`, add `cursorConfig` to the `prisma.bifrostRoute.create` data (after line 101, `nextRunAt`):

```typescript
      nextRunAt,
      cursorConfig: data.cursorConfig ?? null,
      userId: session.user.id,
```

**Step 3: Run existing bifrost tests**

```bash
npx vitest run src/__tests__/bifrost/
```

Expected: All existing tests still PASS.

**Step 4: Commit**

```bash
git add src/lib/validations/bifrost.ts src/app/api/bifrost/routes/route.ts
git commit -m "feat(sync): accept cursorConfig in route create/update schemas"
```

---

## Task 8: Wire Watermarks into BifrostEngine

**Files:**
- Modify: `src/lib/bifrost/engine.ts` (lines 109-246, execute method)
- Modify: `src/lib/bifrost/engine.ts` (line 27-46, LoadedRoute interface)

**Step 1: Update LoadedRoute to include cursorConfig**

In `src/lib/bifrost/engine.ts`, add to the `LoadedRoute` interface (after `lastCheckpoint` on line 39):

```typescript
  lastCheckpoint: Date | null;
  cursorConfig: CursorConfig | null;
```

Add the import at the top of the file:

```typescript
import type { CursorConfig } from "@/lib/sync/types";
import { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } from "@/lib/sync/watermark";
```

Update `loadRouteWithRelations` return (line 57-62) — it already spreads `route` so `cursorConfig` will be included, but we need to cast it:

```typescript
  return {
    ...route,
    sourceConfig: route.sourceConfig as unknown as SourceConfig,
    destConfig: route.destConfig as unknown as DestConfig,
    cursorConfig: route.cursorConfig as CursorConfig | null,
  };
```

**Step 2: Replace buildQueryParams with watermark-aware logic**

Replace the `buildQueryParams` method (lines 413-424) and update the execute method.

In `execute()`, replace lines 109-172 (params building + effective source config) with:

```typescript
      // 2. Build incremental WHERE clause from watermark
      const cursorConfig = route.cursorConfig;
      const tableName = route.destConfig.table; // watermark keyed by dest table
      let priorWatermark: string | null = null;

      if (cursorConfig && cursorConfig.strategy !== "full_refresh" && cursorConfig.cursorColumn) {
        priorWatermark = await getWatermark(route.id, tableName);
      }

      const incrementalClause = cursorConfig?.cursorColumn
        ? buildIncrementalClause(cursorConfig.cursorColumn, cursorConfig.strategy, priorWatermark)
        : null;

      // 3. Create route log
      routeLog = await prisma.routeLog.create({
        data: {
          routeId: route.id,
          status: "running",
          triggeredBy,
        },
      });

      // ... (blueprint fetch stays the same at step 4)

      // Build effective source config with incremental params
      const effectiveSourceConfig: SourceConfig = {
        ...route.sourceConfig,
      };

      // Legacy path: incrementalKey + lastCheckpoint (backward compat)
      if (!cursorConfig && route.sourceConfig.incrementalKey && route.lastCheckpoint) {
        const lastRunValue = route.lastCheckpoint.toISOString();
        effectiveSourceConfig.params = {
          ...effectiveSourceConfig.params,
          last_run: lastRunValue,
        };
      } else if (!cursorConfig && route.sourceConfig.incrementalKey) {
        effectiveSourceConfig.params = {
          ...effectiveSourceConfig.params,
          last_run: new Date(0).toISOString(),
        };
      }

      // New path: cursorConfig + watermark — append WHERE clause to query
      if (incrementalClause && effectiveSourceConfig.query) {
        const q = effectiveSourceConfig.query.trimEnd().replace(/;$/, "");
        const hasWhere = /\bWHERE\b/i.test(q);
        effectiveSourceConfig.query = hasWhere
          ? `${q} AND ${incrementalClause}`
          : `${q} WHERE ${incrementalClause}`;
      }
```

Then after the successful load (replace the checkpoint update on lines 240-246):

```typescript
      // 6. Update watermark + legacy checkpoint
      if (totalLoaded > 0) {
        // New watermark path
        if (cursorConfig?.cursorColumn && cursorConfig.strategy !== "full_refresh") {
          // Collect all extracted rows to find max watermark
          // (allExtractedRows is accumulated during the loop — see below)
          const newWatermark = extractNewWatermark(
            allExtractedRows,
            cursorConfig.cursorColumn,
            cursorConfig.strategy
          );
          if (newWatermark) {
            await setWatermark({
              routeId: route.id,
              tableName,
              watermark: newWatermark,
              watermarkType: cursorConfig.strategy,
              rowsSynced: totalLoaded,
            });
          }
        }

        // Legacy checkpoint (always update for backward compat)
        if (route.sourceConfig.incrementalKey || cursorConfig) {
          await prisma.bifrostRoute.update({
            where: { id: route.id },
            data: { lastCheckpoint: new Date() },
          });
        }
      }
```

**Important:** To extract the new watermark, the engine needs to track all successfully loaded rows' cursor column values. Add an accumulator before the extract loop:

```typescript
      // Track cursor values for watermark extraction (only the cursor column)
      const allExtractedRows: Record<string, unknown>[] = [];
```

And inside the extract loop, after a successful `flushBatch()`, push the cursor values:

```typescript
        // Track cursor column values for watermark (memory-efficient: only store cursor col)
        if (cursorConfig?.cursorColumn) {
          for (const row of transformed) {
            const val = row[cursorConfig.cursorColumn];
            if (val != null) {
              allExtractedRows.push({ [cursorConfig.cursorColumn]: val });
            }
          }
        }
```

**NOTE:** The exact line edits will be handled by the implementer. The key changes are:
1. Import watermark functions + CursorConfig type
2. Add `cursorConfig` to LoadedRoute
3. Read watermark before extraction
4. Build WHERE clause from watermark
5. Track cursor values during extraction
6. Write watermark after successful load
7. Keep legacy `buildQueryParams`/`lastCheckpoint` as fallback

Delete the now-unused `buildQueryParams` method since the new inline logic replaces it.

**Step 3: Run engine tests**

```bash
npx vitest run src/__tests__/bifrost/bifrost-engine.test.ts
```

Expected: Existing tests still PASS. Some may need `cursorConfig: null` added to mock LoadedRoute objects.

**Step 4: Commit**

```bash
git add src/lib/bifrost/engine.ts
git commit -m "feat(sync): wire watermark read/write into BifrostEngine execution"
```

---

## Task 9: CursorConfigPanel UI Component

**Files:**
- Create: `src/components/bifrost/cursor-config-panel.tsx`

**Step 1: Create the panel component**

This panel is shown in the Source panel of sync-builder after the user selects a source table. It calls the detection endpoint, displays the result, and lets the user confirm or override.

```typescript
// src/components/bifrost/cursor-config-panel.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { CursorConfig, CursorCandidate, ColumnSchema, CursorStrategy } from "@/lib/sync/types";

interface CursorConfigPanelProps {
  tableName: string;
  sourceSystem: string;
  columns: ColumnSchema[];
  onConfirm: (config: CursorConfig) => void;
  /** Cache key — if unchanged, skip re-detection */
  cacheKey: string;
}

const STRATEGY_LABELS: Record<CursorStrategy, string> = {
  timestamp_cursor: "Timestamp Cursor",
  integer_id_cursor: "Integer ID",
  rowversion_cursor: "Rowversion",
  full_refresh: "Full Refresh",
};

const STRATEGY_COLORS: Record<CursorStrategy, string> = {
  timestamp_cursor: "#4caf50",
  integer_id_cursor: "#2196f3",
  rowversion_cursor: "#ff9800",
  full_refresh: "#ef5350",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#4caf50",
  medium: "#ff9800",
  low: "#ef5350",
};

export function CursorConfigPanel({
  tableName,
  sourceSystem,
  columns,
  onConfirm,
  cacheKey,
}: CursorConfigPanelProps) {
  const [config, setConfig] = useState<CursorConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideColumn, setOverrideColumn] = useState("");
  const [overrideStrategy, setOverrideStrategy] = useState<CursorStrategy>("timestamp_cursor");
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, CursorConfig>>(new Map());

  const detect = useCallback(async () => {
    // Check cache
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setConfig(cached);
      return;
    }

    // Abort previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setConfig(null);

    try {
      const res = await fetch("/api/bifrost/routes/detect-cursor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName, sourceSystem, realm: "alfheim", columns }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Detection failed");

      const result: CursorConfig = await res.json();
      cacheRef.current.set(cacheKey, result);
      setConfig(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setLoading(false);
    }
  }, [tableName, sourceSystem, columns, cacheKey]);

  useEffect(() => {
    if (tableName && columns.length > 0) {
      detect();
    }
    return () => abortRef.current?.abort();
  }, [detect]);

  function handleOverrideConfirm() {
    if (!overrideColumn) return;
    const col = columns.find((c) => c.name === overrideColumn);
    const overrideConfig: CursorConfig = {
      strategy: overrideStrategy,
      cursorColumn: overrideStrategy === "full_refresh" ? null : overrideColumn,
      cursorColumnType: col?.type ?? null,
      primaryKey: config?.primaryKey ?? null,
      confidence: "high",
      reasoning: "Manually configured by user.",
      warnings: [],
      candidates: [],
    };
    setConfig(overrideConfig);
    setOverrideMode(false);
    onConfirm(overrideConfig);
  }

  // ─── Loading State ───
  if (loading) {
    return (
      <div className="border border-[#ce93d8]/20 bg-void/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[#ce93d8]/40 text-sm animate-pulse font-cinzel">&#x16BE;</span>
          <span className="text-text-dim text-[0.65rem] tracking-wider">
            Analysing schema...
          </span>
        </div>
        <div className="h-1 bg-[#ce93d8]/10 overflow-hidden">
          <div className="h-full bg-[#ce93d8]/30 animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  // ─── Error State ───
  if (error) {
    return (
      <div className="border border-ember/30 bg-void/50 p-3">
        <p className="text-ember text-[0.65rem] tracking-wider">{error}</p>
        <button onClick={detect} className="text-[#ce93d8] text-[0.55rem] tracking-widest uppercase mt-1 hover:text-[#ce93d8]/80 cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  if (!config) return null;

  const strategyColor = STRATEGY_COLORS[config.strategy];
  const confidenceColor = CONFIDENCE_COLORS[config.confidence];

  // ─── Result Display ───
  return (
    <div className="border border-[#ce93d8]/20 bg-void/50 p-3 space-y-3">
      {/* Header: Strategy Badge + Confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[0.55rem] tracking-[0.25em] uppercase px-2 py-0.5 border font-semibold"
            style={{ color: strategyColor, borderColor: `${strategyColor}40` }}
          >
            {STRATEGY_LABELS[config.strategy]}
          </span>
          {config.cursorColumn && (
            <span className="text-text text-[0.65rem] font-mono tracking-wider">
              {config.cursorColumn}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full inline-block"
            style={{ backgroundColor: confidenceColor }}
          />
          <span
            className="text-[0.5rem] tracking-[0.3em] uppercase"
            style={{ color: confidenceColor }}
          >
            {config.confidence}
          </span>
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-text-dim text-[0.6rem] tracking-wider leading-relaxed">
        {config.reasoning}
      </p>

      {/* Warnings */}
      {config.warnings.length > 0 && (
        <div className="space-y-1">
          {config.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-ember text-[0.55rem] mt-px">&#x26A0;</span>
              <span className="text-ember/80 text-[0.55rem] tracking-wider leading-relaxed">
                {w}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Low confidence warning */}
      {config.confidence === "low" && (
        <div className="border border-ember/20 bg-ember/5 px-2 py-1.5">
          <p className="text-ember text-[0.55rem] tracking-wider">
            Low confidence — verify the selected strategy is correct before proceeding.
          </p>
        </div>
      )}

      {/* Candidates (collapsible) */}
      {config.candidates.length > 0 && (
        <div>
          <button
            onClick={() => setShowCandidates(!showCandidates)}
            className="text-[#ce93d8] text-[0.55rem] tracking-widest uppercase hover:text-[#ce93d8]/80 cursor-pointer"
          >
            {showCandidates ? "Hide" : "Show"} Candidates ({config.candidates.length})
          </button>
          {showCandidates && (
            <div className="mt-2 space-y-1">
              {config.candidates.map((c: CursorCandidate, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-1 border border-border/20 bg-deep/50"
                >
                  <span className="text-text text-[0.6rem] font-mono w-32 truncate">
                    {c.column}
                  </span>
                  <div className="flex-1 h-1 bg-border/20 overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${c.score}%`,
                        backgroundColor: STRATEGY_COLORS[c.strategy],
                        opacity: 0.6,
                      }}
                    />
                  </div>
                  <span className="text-text-dim text-[0.5rem] w-6 text-right">
                    {c.score}
                  </span>
                  <span
                    className="text-[0.45rem] tracking-widest uppercase w-20 text-right"
                    style={{ color: STRATEGY_COLORS[c.strategy] }}
                  >
                    {STRATEGY_LABELS[c.strategy]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Override Section */}
      {overrideMode ? (
        <div className="border border-border/30 bg-deep/50 p-2 space-y-2">
          <div>
            <label className="label-norse">Column</label>
            <select
              value={overrideColumn}
              onChange={(e) => setOverrideColumn(e.target.value)}
              className="select-norse"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-norse">Strategy</label>
            <select
              value={overrideStrategy}
              onChange={(e) => setOverrideStrategy(e.target.value as CursorStrategy)}
              className="select-norse"
            >
              {(Object.keys(STRATEGY_LABELS) as CursorStrategy[]).map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleOverrideConfirm}
              disabled={!overrideColumn}
              className="btn-ghost text-[0.55rem] px-3 disabled:opacity-40"
            >
              Apply Override
            </button>
            <button
              onClick={() => setOverrideMode(false)}
              className="text-text-dim text-[0.55rem] tracking-widest uppercase hover:text-text cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(config)}
            className="btn-ghost text-[0.55rem] px-3 border-[#ce93d8]/30 text-[#ce93d8] hover:bg-[#ce93d8]/5"
          >
            Confirm Strategy
          </button>
          <button
            onClick={() => setOverrideMode(true)}
            className="text-text-dim text-[0.55rem] tracking-widest uppercase hover:text-text cursor-pointer"
          >
            Override
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/bifrost/cursor-config-panel.tsx
git commit -m "feat(sync): CursorConfigPanel UI — detection display, override, caching"
```

---

## Task 10: Integrate CursorConfigPanel into SyncBuilder

**Files:**
- Modify: `src/components/bifrost/sync-builder.tsx`

**Step 1: Add imports and state**

At the top of `sync-builder.tsx`, add import:

```typescript
import { CursorConfigPanel } from "./cursor-config-panel";
import type { CursorConfig, ColumnSchema } from "@/lib/sync/types";
```

In the state section (around line 77), add:

```typescript
  // ── Cursor detection state ──
  const [cursorConfig, setCursorConfig] = useState<CursorConfig | null>(null);
```

**Step 2: Build column schema from NS fields for detection**

Add a memo after `derivedFieldMappings` (around line 177):

```typescript
  // ── Derive column schemas for cursor detection ──
  const detectionColumns: ColumnSchema[] = useMemo(() => {
    if (!isNetSuiteSource || nsFields.length === 0) return [];
    return nsFields.map((name) => {
      const meta = nsFieldMap.get(name);
      return {
        name,
        type: meta?.type ?? "STRING",
        nullable: !meta?.mandatory,
        isPrimaryKey: name.toLowerCase() === "internalid",
      };
    });
  }, [nsFields, nsFieldMap, isNetSuiteSource]);

  const cursorCacheKey = useMemo(
    () => `${sourceId}:${nsRecordType || "sql"}:${isNetSuiteSource ? nsFields.join(",") : query.slice(0, 100)}`,
    [sourceId, nsRecordType, nsFields, query, isNetSuiteSource]
  );
```

**Step 3: Add CursorConfigPanel to Source panel**

In the Source panel, after the Incremental Key input for NetSuite (around line 650, after the `incrementalKey` input), add:

```tsx
                {/* Cursor Detection */}
                {nsRecordType && nsFields.length > 0 && detectionColumns.length > 0 && (
                  <div>
                    <label className="label-norse">Sync Strategy</label>
                    <CursorConfigPanel
                      tableName={nsRecordType}
                      sourceSystem="NetSuite"
                      columns={detectionColumns}
                      cacheKey={cursorCacheKey}
                      onConfirm={(config) => {
                        setCursorConfig(config);
                        // Also set incrementalKey for backward compat
                        if (config.cursorColumn) {
                          setIncrementalKey(config.cursorColumn);
                        }
                      }}
                    />
                  </div>
                )}
```

Similarly, for the non-NetSuite source (after the incrementalKey input around line 446):

```tsx
                {/* Note: For SQL sources, cursor detection requires column metadata
                    which isn't available until the query is run. The user configures
                    incrementalKey manually for SQL sources. */}
```

**Step 4: Include cursorConfig in save payload**

In `handleSave()` (around line 271), add `cursorConfig` to the payload:

```typescript
      const payload = {
        name,
        sourceId,
        sourceConfig,
        destId,
        destConfig: { ... },
        transformEnabled,
        blueprintId: transformEnabled ? blueprintId : null,
        cursorConfig,  // <-- ADD THIS
        frequency: frequency || null,
        ...
      };
```

**Step 5: Reset cursorConfig on source change**

In `resetSourceState()` (around line 328), add:

```typescript
    setCursorConfig(null);
```

**Step 6: Commit**

```bash
git add src/components/bifrost/sync-builder.tsx
git commit -m "feat(sync): integrate CursorConfigPanel into SyncBuilder"
```

---

## Task 11: Run Full Test Suite + Manual Verification

**Step 1: Run all tests**

```bash
npm run test
```

Expected: All tests pass (existing + new sync tests).

**Step 2: Run lint**

```bash
npm run lint
```

Expected: No new lint errors.

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds — no TypeScript errors.

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(sync): test/lint/build fixes"
```

---

## Summary of Files

| Action | Path |
|--------|------|
| CREATE | `src/lib/sync/types.ts` |
| CREATE | `src/lib/sync/cursor-detection.ts` |
| CREATE | `src/lib/sync/watermark.ts` |
| CREATE | `src/lib/sync/index.ts` |
| CREATE | `src/__tests__/sync/cursor-detection.test.ts` |
| CREATE | `src/__tests__/sync/watermark.test.ts` |
| CREATE | `src/app/api/bifrost/routes/detect-cursor/route.ts` |
| CREATE | `src/components/bifrost/cursor-config-panel.tsx` |
| MODIFY | `prisma/schema.prisma` — add `cursorConfig`, `PipelineWatermark` |
| MODIFY | `src/lib/validations/bifrost.ts` — add `cursorConfig` to schemas |
| MODIFY | `src/app/api/bifrost/routes/route.ts` — persist `cursorConfig` |
| MODIFY | `src/lib/bifrost/engine.ts` — watermark read/write in execution |
| MODIFY | `src/components/bifrost/sync-builder.tsx` — integrate panel |

## Test Coverage

- **cursor-detection.test.ts**: 7 tests — valid parse, invalid JSON fallback, missing fields fallback, LLM error fallback, message structure, inferPrimaryKey (3 cases), buildDetectionPrompt
- **watermark.test.ts**: 11 tests — getWatermark (found/not found), setWatermark, buildIncrementalClause (5 strategies), extractNewWatermark (5 strategies + null handling)
- **Existing bifrost-engine tests**: Must still pass with `cursorConfig: null` on mock routes
