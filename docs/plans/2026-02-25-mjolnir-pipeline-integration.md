# Mjolnir Pipeline Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Mjolnir from a standalone analysis tool into a live data pipeline engine integrated with Hermod's report runner, schedule worker, and Bifrost routing — so blueprints actually DO something.

**Architecture:** Blueprints get wired to Reports via a FK. When the worker runs a scheduled report, it loads the blueprint, validates the input schema, executes the transformation pipeline (with metrics), then hands the result to Excel generation. The same path runs for test-sends. The DRY violation between `report-runner.ts` and `test-send/route.ts` gets fixed by extracting a shared `executeReportPipeline()` function.

**Tech Stack:** Prisma (schema migration), Vitest (TDD), TypeScript, existing Mjolnir engine (`executeBlueprint`, `validateInputSchema` new)

---

## Phase 1: Schema Enforcement (P0 — Safety Gate)

Before blueprints can run in production, we need a safety check that catches schema drift between when a blueprint was created and when it's executed against live query data.

### Task 1: Add `validateInputSchema` Function

**Files:**
- Create: `src/lib/mjolnir/engine/schema-guard.ts`
- Test: `src/__tests__/mjolnir/schema-guard.test.ts`
- Modify: `src/lib/mjolnir/index.ts` (re-export)

**Context:** `BlueprintData.sourceSchema` stores `{ columns: string[], types: Record<string, InferredDataType> }`. When a blueprint is applied to query results, columns may have been renamed, added, or removed since blueprint creation. This function catches that before `executeBlueprint()` runs.

**Step 1: Write the failing tests**

```typescript
// src/__tests__/mjolnir/schema-guard.test.ts
import { describe, it, expect } from "vitest";
import { validateInputSchema } from "@/lib/mjolnir/engine/schema-guard";
import type { InferredDataType } from "@/lib/mjolnir/types";

function schema(cols: string[], types?: Record<string, InferredDataType>) {
  return {
    columns: cols,
    types: types ?? Object.fromEntries(cols.map(c => [c, "string" as InferredDataType])),
  };
}

describe("validateInputSchema", () => {
  it("passes when input matches schema exactly", () => {
    const result = validateInputSchema(
      schema(["Name", "Age", "City"]),
      ["Name", "Age", "City"]
    );
    expect(result.valid).toBe(true);
    expect(result.missingColumns).toEqual([]);
    expect(result.extraColumns).toEqual([]);
  });

  it("passes with extra columns (superset is OK)", () => {
    const result = validateInputSchema(
      schema(["Name", "Age"]),
      ["Name", "Age", "City"]
    );
    expect(result.valid).toBe(true);
    expect(result.extraColumns).toEqual(["City"]);
  });

  it("fails when required columns are missing", () => {
    const result = validateInputSchema(
      schema(["Name", "Age", "City"]),
      ["Name", "Age"]
    );
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toEqual(["City"]);
  });

  it("matches columns case-insensitively", () => {
    const result = validateInputSchema(
      schema(["Name", "AGE"]),
      ["name", "age"]
    );
    expect(result.valid).toBe(true);
  });

  it("returns null schema when sourceSchema is null", () => {
    const result = validateInputSchema(null, ["Name", "Age"]);
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("detects multiple missing columns", () => {
    const result = validateInputSchema(
      schema(["A", "B", "C", "D"]),
      ["A"]
    );
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toEqual(["B", "C", "D"]);
  });

  it("provides a human-readable error message", () => {
    const result = validateInputSchema(
      schema(["Name", "Revenue"]),
      ["Name"]
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Revenue");
  });
});
```

**Step 2: Run tests — verify they fail**
```bash
npx vitest run src/__tests__/mjolnir/schema-guard.test.ts
```

**Step 3: Implement `validateInputSchema`**

```typescript
// src/lib/mjolnir/engine/schema-guard.ts
import type { BlueprintData } from "../types";

export interface SchemaValidationResult {
  valid: boolean;
  skipped?: boolean;
  missingColumns: string[];
  extraColumns: string[];
  error?: string;
}

/**
 * Validate that input columns satisfy a blueprint's expected source schema.
 *
 * Rules:
 * - All schema columns must be present in input (case-insensitive)
 * - Extra columns in input are allowed (superset OK)
 * - Null schema = skip validation (blueprint created without schema info)
 */
export function validateInputSchema(
  sourceSchema: BlueprintData["sourceSchema"],
  inputColumns: string[]
): SchemaValidationResult {
  if (!sourceSchema) {
    return { valid: true, skipped: true, missingColumns: [], extraColumns: [] };
  }

  const inputLower = new Set(inputColumns.map(c => c.toLowerCase()));
  const schemaLower = new Map(sourceSchema.columns.map(c => [c.toLowerCase(), c]));

  const missingColumns: string[] = [];
  for (const [lower, original] of schemaLower) {
    if (!inputLower.has(lower)) {
      missingColumns.push(original);
    }
  }

  const extraColumns: string[] = [];
  for (const col of inputColumns) {
    if (!schemaLower.has(col.toLowerCase())) {
      extraColumns.push(col);
    }
  }

  const valid = missingColumns.length === 0;
  const error = valid
    ? undefined
    : `Blueprint expects columns not found in input: ${missingColumns.join(", ")}`;

  return { valid, missingColumns, extraColumns, error };
}
```

**Step 4: Run tests — verify they pass**
```bash
npx vitest run src/__tests__/mjolnir/schema-guard.test.ts
```

**Step 5: Re-export from barrel**
Add to `src/lib/mjolnir/index.ts`:
```typescript
export { validateInputSchema } from "./engine/schema-guard";
export type { SchemaValidationResult } from "./engine/schema-guard";
```

**Step 6: Commit**
```bash
git add src/lib/mjolnir/engine/schema-guard.ts src/__tests__/mjolnir/schema-guard.test.ts src/lib/mjolnir/index.ts
git commit -m "feat(mjolnir): add validateInputSchema for pre-execution safety"
```

---

## Phase 2: Execution Metrics (P2 — Observability)

### Task 2: Add Step-Level Metrics to ExecutionResult

**Files:**
- Modify: `src/lib/mjolnir/engine/blueprint-executor.ts`
- Modify: `src/lib/mjolnir/types.ts` (add `StepMetric` type)
- Modify: `src/lib/mjolnir/index.ts` (re-export type)
- Test: `src/__tests__/mjolnir/blueprint-executor.test.ts` (add metrics tests)

**Context:** Every step in the pipeline should report: step type, duration in ms, rows in, rows out. This is zero-cost observability that's immediately useful for debugging slow/broken transforms.

**Step 1: Add `StepMetric` type to `types.ts`**

```typescript
// Add to src/lib/mjolnir/types.ts
export interface StepMetric {
  order: number;
  type: ForgeStepType;
  durationMs: number;
  rowsIn: number;
  rowsOut: number;
  columnsIn: number;
  columnsOut: number;
}
```

**Step 2: Write failing tests**

Add to `src/__tests__/mjolnir/blueprint-executor.test.ts`:

```typescript
describe("step metrics", () => {
  it("returns metrics for each step", () => {
    const result = executeBlueprint(
      [
        step(0, "filter_rows", { column: "City", operator: "eq", value: "NYC" }),
        step(1, "remove_columns", { columns: ["Score"] }),
      ],
      sampleInput()
    );

    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0].type).toBe("filter_rows");
    expect(result.metrics[0].rowsIn).toBe(4);
    expect(result.metrics[0].rowsOut).toBe(2);
    expect(result.metrics[0].columnsIn).toBe(4);
    expect(result.metrics[0].columnsOut).toBe(4);
    expect(result.metrics[1].type).toBe("remove_columns");
    expect(result.metrics[1].columnsOut).toBe(3);
    expect(typeof result.metrics[0].durationMs).toBe("number");
  });

  it("returns empty metrics for empty steps", () => {
    const result = executeBlueprint([], sampleInput());
    expect(result.metrics).toEqual([]);
  });

  it("reports totalDurationMs", () => {
    const result = executeBlueprint(
      [step(0, "sort", { column: "Age" })],
      sampleInput()
    );
    expect(typeof result.totalDurationMs).toBe("number");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 3: Run tests — verify they fail**

**Step 4: Modify `ExecutionResult` and `executeBlueprint`**

In `blueprint-executor.ts`, update:
```typescript
import type { ForgeStep, ForgeStepType, StepMetric } from "../types";

export interface ExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
  metrics: StepMetric[];
  totalDurationMs: number;
}
```

In the main `executeBlueprint` function, wrap each step with timing:
```typescript
const pipelineStart = performance.now();
const metrics: StepMetric[] = [];

for (const step of sorted) {
  const rowsIn = state.rows.length;
  const columnsIn = state.columns.length;
  const stepStart = performance.now();

  const handler = STEP_HANDLERS[step.type];
  if (handler) {
    handler(state, step.config);
  } else {
    state.warnings.push(`Unknown step type: ${step.type}`);
  }

  metrics.push({
    order: step.order,
    type: step.type,
    durationMs: Math.round((performance.now() - stepStart) * 100) / 100,
    rowsIn,
    rowsOut: state.rows.length,
    columnsIn,
    columnsOut: state.columns.length,
  });
}

return {
  columns: state.columns,
  rows: state.rows,
  warnings: state.warnings,
  metrics,
  totalDurationMs: Math.round((performance.now() - pipelineStart) * 100) / 100,
};
```

**Step 5: Run tests — verify they pass**

**Step 6: Update re-exports in `index.ts`**
```typescript
export type { StepMetric } from "./types";
```

**Step 7: Commit**
```bash
git commit -m "feat(mjolnir): add step-level execution metrics to ExecutionResult"
```

---

## Phase 3: Pipeline Plumbing (Connect Blueprint → Report → Worker)

This is the "throughput" phase. After this, blueprints actually run.

### Task 3: Schema Migration — Add `blueprintId` to Report

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add FK to Report model**

```prisma
model Report {
  // ... existing fields ...
  blueprintId  String?
  blueprint    Blueprint? @relation(fields: [blueprintId], references: [id], onDelete: SetNull)
}

model Blueprint {
  // ... existing fields ...
  reports      Report[]
}
```

**Step 2: Push schema**
```bash
npx prisma db push
npx prisma generate
```

**Step 3: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat: add blueprintId FK from Report to Blueprint"
```

### Task 4: Extract Shared Report Pipeline Function (DRY)

**Files:**
- Modify: `src/lib/report-runner.ts` — extract `executeReportPipeline()`
- Modify: `src/app/api/reports/[id]/test-send/route.ts` — use shared function
- Test: `src/__tests__/report-runner.test.ts` — existing tests still pass

**Context:** `report-runner.ts:runReport()` and `test-send/route.ts` duplicate the entire query → columnConfig → applyColumnConfig → generateExcel pipeline. We need to extract this into a shared function that BOTH call, and that function is where blueprint execution gets injected.

**Step 1: Define the shared pipeline function signature**

```typescript
// In src/lib/report-runner.ts (new export)
export interface PipelineInput {
  report: {
    name: string;
    sqlQuery: string;
    formatting: unknown;
    columnConfig: unknown;
    blueprintId?: string | null;
    dataSource: Parameters<typeof getConnector>[0];
  };
}

export interface PipelineResult {
  excelBuffer: Buffer;
  rowCount: number;
  columns: string[];
  runTimeMs: number;
  forgeWarnings: string[];
  forgeMetrics: StepMetric[];
}

export async function executeReportPipeline(input: PipelineInput): Promise<PipelineResult> {
  // 1. Execute query
  // 2. Apply column config
  // 3. If blueprintId: load blueprint, validate schema, execute, collect metrics
  // 4. Generate Excel
  // Returns buffer + metadata
}
```

**Step 2: Implement — move shared logic from runReport() into executeReportPipeline()**

The key addition is the blueprint execution block between column config and Excel:

```typescript
let finalCols = mappedCols;
let finalRows = mappedRows;
const forgeWarnings: string[] = [];
let forgeMetrics: StepMetric[] = [];

if (input.report.blueprintId) {
  const blueprint = await prisma.blueprint.findUnique({
    where: { id: input.report.blueprintId },
  });

  if (blueprint && blueprint.status !== "ARCHIVED") {
    const steps = blueprint.steps as ForgeStep[];
    const sourceSchema = blueprint.sourceSchema as BlueprintData["sourceSchema"];

    // P0: Schema enforcement
    const schemaCheck = validateInputSchema(sourceSchema, mappedCols);
    if (!schemaCheck.valid) {
      throw new Error(`Blueprint schema mismatch: ${schemaCheck.error}`);
    }

    // Execute pipeline with metrics
    const forgeResult = executeBlueprint(steps, {
      columns: mappedCols,
      rows: mappedRows,
    });

    finalCols = forgeResult.columns;
    finalRows = forgeResult.rows;
    forgeWarnings.push(...forgeResult.warnings);
    forgeMetrics = forgeResult.metrics;
  }
}
```

**Step 3: Refactor `runReport()` to call `executeReportPipeline()`**

**Step 4: Refactor `test-send/route.ts` to call `executeReportPipeline()`**

**Step 5: Run existing tests — verify nothing broke**
```bash
npx vitest run src/__tests__/report-runner.test.ts
```

**Step 6: Add integration-style tests for blueprint execution in pipeline**

```typescript
describe("executeReportPipeline with blueprint", () => {
  // These tests mock prisma and connector — focus on the blueprint integration point
  it("applies blueprint transformation to query results", ...);
  it("throws on schema mismatch", ...);
  it("skips blueprint if blueprintId is null", ...);
  it("skips archived blueprints", ...);
  it("collects forge warnings and metrics", ...);
});
```

**Step 7: Commit**
```bash
git commit -m "refactor: extract shared executeReportPipeline, integrate blueprint execution"
```

### Task 5: Blueprint Selector API

**Files:**
- Modify: existing blueprint list endpoint or add query param support

**Context:** The report editor needs to list ACTIVE/VALIDATED blueprints for the user to attach to a report. The existing `GET /api/mjolnir/blueprints` lists all blueprints — we need a way to filter by status.

**Step 1: Add status filter to GET /api/mjolnir/blueprints**

Support `?status=ACTIVE,VALIDATED` query parameter.

**Step 2: Add PATCH /api/reports/[id] support for blueprintId**

The existing report update route needs to accept `blueprintId` in its update payload.

**Step 3: Tests**

**Step 4: Commit**

---

## Phase 4: Aggregate Step (P1 — Capability)

### Task 6: Add `aggregate` Step Type

**Files:**
- Modify: `src/lib/mjolnir/types.ts` — add `"aggregate"` to `ForgeStepType`
- Modify: `src/lib/mjolnir/engine/blueprint-executor.ts` — add handler
- Modify: `src/lib/validations/mjolnir.ts` — add to valid types
- Test: `src/__tests__/mjolnir/blueprint-executor.test.ts`

**Config shape:**
```typescript
{
  groupBy: string[],           // columns to group by
  aggregations: Array<{
    column: string,            // source column to aggregate
    function: "sum" | "count" | "avg" | "min" | "max" | "count_distinct",
    outputColumn?: string,     // output column name (defaults to "function_column")
  }>
}
```

**Step 1: Write failing tests**

```typescript
describe("aggregate", () => {
  it("groups and sums", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "sum", outputColumn: "Total Score" },
          { column: "Name", function: "count", outputColumn: "Count" },
        ],
      })],
      sampleInput()
    );

    expect(result.columns).toEqual(["City", "Total Score", "Count"]);
    expect(result.rows).toHaveLength(3); // NYC, LA, SF
    const nyc = result.rows.find(r => r.City === "NYC");
    expect(nyc?.["Total Score"]).toBe(163); // 85 + 78
    expect(nyc?.Count).toBe(2);
  });

  it("computes avg", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "avg", outputColumn: "Avg Score" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find(r => r.City === "NYC");
    expect(nyc?.["Avg Score"]).toBeCloseTo(81.5, 1);
  });

  it("computes min and max", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "min", outputColumn: "Min" },
          { column: "Score", function: "max", outputColumn: "Max" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find(r => r.City === "NYC");
    expect(nyc?.Min).toBe(78);
    expect(nyc?.Max).toBe(85);
  });

  it("computes count_distinct", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Name", function: "count_distinct", outputColumn: "Unique Names" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find(r => r.City === "NYC");
    expect(nyc?.["Unique Names"]).toBe(2);
  });

  it("defaults outputColumn to function_column", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [{ column: "Score", function: "sum" }],
      })],
      sampleInput()
    );

    expect(result.columns).toContain("sum_Score");
  });

  it("handles empty groupBy (global aggregate)", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: [],
        aggregations: [
          { column: "Score", function: "sum", outputColumn: "Total" },
          { column: "Name", function: "count", outputColumn: "N" },
        ],
      })],
      sampleInput()
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].Total).toBe(350);
    expect(result.rows[0].N).toBe(4);
  });

  it("handles null values in aggregation", () => {
    const input = {
      columns: ["Group", "Value"],
      rows: [
        { Group: "A", Value: 10 },
        { Group: "A", Value: null },
        { Group: "A", Value: 20 },
      ],
    };
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["Group"],
        aggregations: [{ column: "Value", function: "sum", outputColumn: "Total" }],
      })],
      input
    );

    expect(result.rows[0].Total).toBe(30); // nulls skipped
  });
});
```

**Step 2: Run tests — verify they fail**

**Step 3: Add `"aggregate"` to `ForgeStepType` in `types.ts`**

**Step 4: Implement `handleAggregate` in `blueprint-executor.ts`**

```typescript
function handleAggregate(state: PipelineState, config: Record<string, unknown>): void {
  const groupBy = (config.groupBy as string[]) ?? [];
  const aggregations = config.aggregations as Array<{
    column: string;
    function: string;
    outputColumn?: string;
  }>;
  if (!Array.isArray(aggregations)) return;

  // Build groups
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of state.rows) {
    const key = groupBy.map(col => JSON.stringify(row[col] ?? null)).join("\x00");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Compute aggregations per group
  const resultRows: Record<string, unknown>[] = [];
  for (const [, groupRows] of groups) {
    const row: Record<string, unknown> = {};

    // Copy group-by column values from first row
    for (const col of groupBy) {
      row[col] = groupRows[0][col];
    }

    // Compute each aggregation
    for (const agg of aggregations) {
      const outputCol = agg.outputColumn ?? `${agg.function}_${agg.column}`;
      const values = groupRows
        .map(r => r[agg.column])
        .filter(v => v !== null && v !== undefined);
      const nums = values.map(v => typeof v === "number" ? v : Number(v)).filter(n => !isNaN(n));

      switch (agg.function) {
        case "sum":
          row[outputCol] = nums.reduce((a, b) => a + b, 0);
          break;
        case "count":
          row[outputCol] = groupRows.length;
          break;
        case "avg":
          row[outputCol] = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          break;
        case "min":
          row[outputCol] = nums.length > 0 ? Math.min(...nums) : null;
          break;
        case "max":
          row[outputCol] = nums.length > 0 ? Math.max(...nums) : null;
          break;
        case "count_distinct":
          row[outputCol] = new Set(values.map(v => String(v))).size;
          break;
        default:
          row[outputCol] = null;
      }
    }

    resultRows.push(row);
  }

  // Update columns: groupBy columns + aggregation output columns
  state.columns = [
    ...groupBy,
    ...aggregations.map(a => a.outputColumn ?? `${a.function}_${a.column}`),
  ];
  state.rows = resultRows;
}
```

**Step 5: Register in `STEP_HANDLERS` and update Zod schema**

**Step 6: Run tests — verify they pass**

**Step 7: Commit**
```bash
git commit -m "feat(mjolnir): add aggregate step type (sum, count, avg, min, max, count_distinct)"
```

---

## Phase 5: Validation Improvements (P3 — Quality Gates)

### Task 7: Add Completeness Check to Pattern Validation

**Files:**
- Modify: `src/lib/mjolnir/engine/validation.ts`
- Test: `src/__tests__/mjolnir/validation.test.ts`

**Context:** Pattern validation currently doesn't check NULL rates. If a blueprint produces mostly-null values for a column that should have data, it passes anyway. Add a check: "columns that are non-null in AFTER should be mostly non-null in executed output."

**Step 1: Write failing test**

```typescript
it("flags completeness issue when blueprint produces mostly nulls for non-null column", () => {
  // Create BEFORE/AFTER where AFTER has a computed column with values
  // Blueprint has a broken formula that produces nulls
  // Pattern validation should flag the completeness issue
  ...
});
```

**Step 2: Implement completeness check in `validatePattern()`**

Add between Check 3 and Check 4:

```typescript
// ─── Check 3b: Completeness (NULL rates) ─────────
if (keyPair && matchedPairs.length > 0) {
  for (const pair of matchedPairs) {
    const afterNullRate = after.rows.filter(r =>
      r[pair.refCol] === null || r[pair.refCol] === undefined
    ).length / Math.max(after.rows.length, 1);

    const execNullRate = execution.rows.filter(r =>
      r[pair.execCol] === null || r[pair.execCol] === undefined
    ).length / Math.max(execution.rows.length, 1);

    // If AFTER column is mostly non-null but executed is mostly null → problem
    if (afterNullRate < 0.1 && execNullRate > 0.5) {
      totalChecks++;
      checks.push({
        category: "completeness" as PatternCheck["category"],
        status: "fail",
        description: `Column "${pair.refCol}" is ${Math.round(execNullRate * 100)}% null in output but ${Math.round(afterNullRate * 100)}% null in expected`,
      });
    }
  }
}
```

**Step 3: Add `"completeness"` to PatternCheck category union**

**Step 4: Run tests — verify they pass**

**Step 5: Commit**

---

## Phase 6: Split/Merge Column Steps (P4 — Ergonomics)

### Task 8: Add `split_column` and `merge_columns` Steps

**Files:**
- Modify: `src/lib/mjolnir/types.ts`
- Modify: `src/lib/mjolnir/engine/blueprint-executor.ts`
- Modify: `src/lib/validations/mjolnir.ts`
- Test: `src/__tests__/mjolnir/blueprint-executor.test.ts`

**`split_column` config:**
```typescript
{
  column: string,        // source column
  delimiter: string,     // split on this (e.g., ", " or " - ")
  outputColumns: string[], // names for each split part
  keepOriginal?: boolean,  // default false
}
```

**`merge_columns` config:**
```typescript
{
  columns: string[],      // columns to merge
  delimiter: string,      // join with this
  outputColumn: string,   // name for merged column
  keepOriginals?: boolean, // default false
}
```

**Tests:**
```typescript
describe("split_column", () => {
  it("splits column by delimiter", () => {
    const input = {
      columns: ["FullName", "Age"],
      rows: [
        { FullName: "John Doe", Age: 30 },
        { FullName: "Jane Smith", Age: 25 },
      ],
    };
    const result = executeBlueprint(
      [step(0, "split_column", {
        column: "FullName",
        delimiter: " ",
        outputColumns: ["FirstName", "LastName"],
      })],
      input
    );

    expect(result.columns).toEqual(["Age", "FirstName", "LastName"]);
    expect(result.rows[0].FirstName).toBe("John");
    expect(result.rows[0].LastName).toBe("Doe");
    expect(result.rows[0]).not.toHaveProperty("FullName");
  });

  it("keeps original when keepOriginal is true", () => { ... });
  it("pads with null when split produces fewer parts", () => { ... });
  it("drops excess parts beyond outputColumns length", () => { ... });
});

describe("merge_columns", () => {
  it("merges columns with delimiter", () => {
    const result = executeBlueprint(
      [step(0, "merge_columns", {
        columns: ["City", "Score"],
        delimiter: " - ",
        outputColumn: "CityScore",
      })],
      sampleInput()
    );

    expect(result.columns).toContain("CityScore");
    expect(result.rows[0].CityScore).toBe("NYC - 85");
    // originals removed by default
    expect(result.columns).not.toContain("City");
    expect(result.columns).not.toContain("Score");
  });

  it("keeps originals when keepOriginals is true", () => { ... });
  it("skips null values in merge", () => { ... });
});
```

**Step 1: Write tests, Step 2: verify fail, Step 3: implement, Step 4: verify pass, Step 5: commit**

---

## Phase 7: Top-N Value Profiling (P5 — Intelligence)

### Task 9: Add topValues to ColumnFingerprint

**Files:**
- Modify: `src/lib/mjolnir/types.ts` — add `topValues` to `ColumnFingerprint`
- Modify: `src/lib/mjolnir/engine/fingerprint.ts` — compute top-N
- Test: `src/__tests__/mjolnir/fingerprint.test.ts`

**Type addition:**
```typescript
interface ColumnFingerprint {
  // ... existing fields ...
  topValues?: Array<{ value: string; count: number }>; // top 10 most frequent
}
```

**Implementation:** In `fingerprintColumn`, after computing cardinality:
```typescript
// Top-N values (for categorical columns — cardinality < 100)
if (cardinality < 100 && nonNullValues.length > 0) {
  const freq = new Map<string, number>();
  for (const v of nonNullValues) {
    const key = String(v);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  topValues = sorted.map(([value, count]) => ({ value, count }));
}
```

**Tests:**
```typescript
it("computes topValues for low-cardinality columns", () => {
  const fp = fingerprintColumn("Status", ["Active", "Inactive", "Active", "Active", "Inactive"]);
  expect(fp.topValues).toEqual([
    { value: "Active", count: 3 },
    { value: "Inactive", count: 2 },
  ]);
});

it("omits topValues for high-cardinality columns", () => {
  const values = Array.from({ length: 200 }, (_, i) => `unique_${i}`);
  const fp = fingerprintColumn("ID", values);
  expect(fp.topValues).toBeUndefined();
});
```

**Commit:**
```bash
git commit -m "feat(mjolnir): add top-N value profiling to column fingerprints"
```

---

## Phase 8: Report Editor UI — Blueprint Selector

### Task 10: Blueprint Selector in Report Editor

**Files:**
- Modify: `src/components/reports/report-editor.tsx`
- Modify: report update API route

**Context:** The report editor needs a dropdown/selector to attach a blueprint to the report. Design follows Hermod aesthetic (dark theme, gold accents, Cinzel headings).

**UI Design:**
- New section in the editor below the SQL editor, above the schedule
- Header: "ᚠ FORGE BLUEPRINT" (Cinzel, gold-bright, uppercase, 0.25em spacing)
- Dropdown listing ACTIVE + VALIDATED blueprints for the user
- "None" option to detach
- Shows blueprint name, step count, status badge
- Small info text: "Blueprint transforms query results before Excel generation"

**Step 1: Add `blueprintId` state to report editor**
**Step 2: Fetch blueprints on mount (from /api/mjolnir/blueprints?status=ACTIVE,VALIDATED)**
**Step 3: Render selector component**
**Step 4: Save blueprintId on report update**

---

## Execution Order Summary

| # | Task | Phase | Dependencies |
|---|------|-------|-------------|
| 1 | `validateInputSchema` | P0 Safety | None |
| 2 | Step metrics in executor | P2 Observability | None |
| 3 | Schema migration: `Report.blueprintId` | P3 Plumbing | None |
| 4 | Extract `executeReportPipeline` + blueprint execution | P3 Plumbing | Tasks 1, 2, 3 |
| 5 | Blueprint selector API (status filter) | P3 Plumbing | Task 3 |
| 6 | `aggregate` step type | P1 Capability | None |
| 7 | Completeness check in validation | P3 Quality | None |
| 8 | `split_column` + `merge_columns` steps | P4 Ergonomics | None |
| 9 | Top-N value profiling | P5 Intelligence | None |
| 10 | Report editor UI: blueprint selector | P8 UI | Tasks 3, 5 |

Tasks 1, 2, 3, 6, 7, 8, 9 are fully independent and can be parallelized.
Task 4 depends on 1+2+3.
Task 5 depends on 3.
Task 10 depends on 3+5.
