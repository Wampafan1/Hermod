# Cross-Cutting 40-Bug Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 40 cross-cutting bugs found in the 14-category review, grouped by file to minimize context-switching.

**Architecture:** Fixes are ordered by severity (critical → low), then grouped by file. Each task modifies 1-2 files, writes/updates tests, and commits.

**Tech Stack:** TypeScript, Next.js 14, Prisma, Vitest, pg-boss

**Test command:** `npm run test`

---

### Task 1: Remove NetSuite debug logging (C1, H3-related)

**Severity:** Critical
**Files:**
- Modify: `src/lib/providers/netsuite.provider.ts`
- Test: `src/__tests__/providers/netsuite-provider.test.ts`

**What to do:**

1. Delete lines 407-413 (the DEBUG auth header logging block):
```typescript
// DELETE THIS ENTIRE BLOCK:
// DEBUG: log auth details (remove after debugging)
if (attempt === 0) {
  console.log("[NetSuite DEBUG] URL:", url);
  console.log("[NetSuite DEBUG] method:", method.toUpperCase());
  console.log("[NetSuite DEBUG] realm (accountId):", connection.tba.accountId);
  console.log("[NetSuite DEBUG] Auth header (full):", authHeader);
}
```

2. Delete lines 443-446 (the DEBUG error response logging):
```typescript
// DELETE THESE LINES:
console.log("[NetSuite DEBUG] Status:", response.status);
console.log("[NetSuite DEBUG] Raw error body:", errorBody);
console.log("[NetSuite DEBUG] Response headers:", Object.fromEntries(response.headers.entries()));
```

3. Keep the `console.warn` for rate limiting (line 434) — that's operational, not debug.

**Test:** Run `npm run test -- src/__tests__/providers/netsuite-provider.test.ts` — existing tests should still pass.

**Commit:** `fix(security): remove NetSuite debug logging that exposes OAuth credentials`

---

### Task 2: Make send-report jobs idempotent (C2)

**Severity:** Critical
**Files:**
- Modify: `src/lib/worker.ts`
- Modify: `src/lib/report-runner.ts`

**What to do:**

1. In `worker.ts`, add `singletonKey` to the `send-report` job (also fixes H4):

Change line 101-104:
```typescript
// BEFORE
await boss.send("send-report", {
  reportId: schedule.reportId,
  scheduleId: schedule.id,
});

// AFTER
await boss.send("send-report", {
  reportId: schedule.reportId,
  scheduleId: schedule.id,
}, {
  singletonKey: `report-${schedule.reportId}`,
});
```

2. In `report-runner.ts`'s `runReport()` function, add an idempotency check at the start. Before creating a new RunLog, check if one already exists for this schedule run that completed recently:

```typescript
// At the start of runReport(), before creating a new RunLog:
const recentRun = await prisma.runLog.findFirst({
  where: {
    reportId,
    status: "SUCCESS",
    startedAt: { gte: new Date(Date.now() - 5 * 60_000) }, // within last 5 min
  },
  select: { id: true },
});
if (recentRun) {
  console.log(`[Report] Skipping duplicate run for report ${reportId} — recent successful run exists`);
  return { status: "skipped", runLogId: recentRun.id };
}
```

**Test:** Run `npm run test` — existing tests should pass.

**Commit:** `fix(worker): make send-report idempotent with singletonKey and duplicate check`

---

### Task 3: Check BifrostRoute references before deleting Connection (C3)

**Severity:** Critical
**Files:**
- Modify: `src/app/api/connections/[id]/route.ts`
- Test: existing API tests or manual verification

**What to do:**

In the DELETE handler (line 137-147), after the report count check, add a BifrostRoute check:

```typescript
// After the existing reportCount check (line 138-143), add:
const routeCount = await prisma.bifrostRoute.count({
  where: {
    OR: [{ sourceId: id }, { destId: id }],
  },
});
if (routeCount > 0) {
  return NextResponse.json(
    { error: `Cannot delete: ${routeCount} Bifrost route(s) use this connection` },
    { status: 409 }
  );
}
```

**Also:** Add explicit `onDelete: Restrict` to schema.prisma for BifrostRoute's source and dest relations (lines 293, 298) and Report's connection relation (line 148):

```prisma
// Line 293:
source           Connection     @relation("routeSource", fields: [sourceId], references: [id], onDelete: Restrict)
// Line 298:
dest             Connection     @relation("routeDest", fields: [destId], references: [id], onDelete: Restrict)
// Line 148:
connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Restrict)
```

Run `npm run db:generate` after schema changes (NOT db:push — this is metadata only for the Prisma client).

**Commit:** `fix(api): check BifrostRoute references before deleting Connection, add explicit onDelete`

---

### Task 4: Fix fieldMapping stripped by Zod (H1)

**Severity:** High
**Files:**
- Modify: `src/lib/validations/bifrost.ts`

**What to do:**

Add `fieldMapping` to `destConfigSchema`:

```typescript
const destConfigSchema = z.object({
  dataset: z.string().min(1, "Destination dataset is required"),
  table: z.string().min(1, "Destination table is required"),
  writeDisposition: z.enum(["WRITE_APPEND", "WRITE_TRUNCATE", "WRITE_EMPTY"]),
  autoCreateTable: z.boolean().default(false),
  schema: z.record(z.unknown()).nullable().optional(),
  fieldMapping: z.record(z.string()).nullable().optional(),  // ADD THIS
  chunkSize: z.number().int().min(100).max(100_000).optional(),  // ADD THIS (fixes L1 too)
});
```

This fixes both H1 (fieldMapping silently stripped) and L1 (chunkSize dead code path).

**Test:** Run `npm run test` — existing tests should pass.

**Commit:** `fix(bifrost): add fieldMapping and chunkSize to destConfigSchema`

---

### Task 5: Fix NetSuite legacy incremental reads wrong location for last_run (H2)

**Severity:** High
**Files:**
- Modify: `src/lib/providers/netsuite.provider.ts`

**What to do:**

The engine puts `last_run` in `config.params.last_run` but the NetSuite provider reads from `config.last_run` (top level). Fix the provider to read from the correct location:

Change lines 227-235:
```typescript
// Substitute @last_run params if incremental
if (config.incrementalKey) {
  // The engine stores last_run in config.params (via effectiveSourceConfig.params)
  const lastRun = config.params?.last_run
    ?? (config as unknown as Record<string, unknown>).last_run;  // fallback for direct callers
  if (lastRun) {
    const lastRunStr =
      lastRun instanceof Date ? lastRun.toISOString() : String(lastRun);
    resolvedQuery = resolvedQuery.replace(/@last_run/g, `'${lastRunStr}'`);
  }
}
```

**Test:** Run `npm run test -- src/__tests__/providers/netsuite-provider.test.ts`

**Commit:** `fix(netsuite): read last_run from config.params (where engine puts it)`

---

### Task 6: Sanitize error messages in withAuth (H3)

**Severity:** High
**Files:**
- Modify: `src/lib/api.ts`

**What to do:**

Replace raw error forwarding with a sanitized message for 500 errors:

```typescript
export function withAuth(handler: AuthHandler) {
  return async (req: Request, context?: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      return await handler(req, session as Session & { user: { id: string } });
    } catch (error) {
      console.error("API error:", error);
      // Never forward raw error messages to the client — they may contain
      // internal details (Prisma table names, SQL fragments, connection strings).
      return NextResponse.json(
        { error: "An internal error occurred. Please try again or contact support." },
        { status: 500 }
      );
    }
  };
}
```

**Test:** Run `npm run test`

**Commit:** `fix(security): sanitize 500 error messages in withAuth wrapper`

---

### Task 7: Fix Promise.race timeout leak in manual route trigger (H5)

**Severity:** High
**Files:**
- Modify: `src/app/api/bifrost/routes/[id]/run/route.ts`

**What to do:**

Replace `Promise.race` with proper timer cleanup:

```typescript
const engine = new BifrostEngine();

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

try {
  const result = await engine.execute(loaded, "manual", lockResult.id);
  clearTimeout(timer);
  return NextResponse.json(result);
} catch (err) {
  clearTimeout(timer);
  if (controller.signal.aborted) {
    return NextResponse.json(
      { error: "Route execution timed out after 10 minutes" },
      { status: 504 }
    );
  }
  throw err;
}
```

Note: The engine doesn't accept an AbortSignal yet, so this is a partial fix — the timer is properly cleaned up on success, and the response is correct on timeout. The engine will still finish in background on timeout, but the timer no longer leaks.

**Also fix the worker's `withTimeout`** (fixes M-related issue with tick timeout):

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[Worker] ${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}
```

**Test:** Run `npm run test`

**Commit:** `fix(bifrost): clean up Promise.race timer on success, prevent leak`

---

### Task 8: Fix Helheim retry entries stuck in "retrying" (H6)

**Severity:** High
**Files:**
- Modify: `src/lib/bifrost/helheim/dead-letter.ts`
- Modify: `src/lib/worker.ts`

**What to do:**

1. In `dead-letter.ts`, change `getDueRetries()` to also fetch entries stuck in "retrying" for >5 minutes:

```typescript
export async function getDueRetries(): Promise<
  Array<{ id: string; routeId: string; payload: string; retryCount: number; maxRetries: number }>
> {
  return prisma.helheimEntry.findMany({
    where: {
      OR: [
        // Normal pending retries
        {
          status: "pending",
          nextRetryAt: { lte: new Date() },
        },
        // Stuck "retrying" entries (crashed mid-retry)
        {
          status: "retrying",
          lastRetriedAt: { lte: new Date(Date.now() - 5 * 60_000) },
        },
      ],
    },
    select: {
      id: true,
      routeId: true,
      payload: true,
      retryCount: true,
      maxRetries: true,
    },
    take: 100,  // Also fixes M12 — bound the result set
  });
}
```

**Test:** Run `npm run test -- src/__tests__/bifrost/helheim.test.ts`

**Commit:** `fix(helheim): recover entries stuck in "retrying" status, bound getDueRetries`

---

### Task 9: Fix biweekly schedule (H7)

**Severity:** High
**Files:**
- Modify: `src/lib/schedule-utils.ts`
- Test: update/add tests in `src/__tests__/schedule-utils.test.ts`

**What to do:**

Fix `nextBiweekly()` to actually skip a week after finding the next weekly occurrence:

```typescript
function nextBiweekly(
  now: Date,
  daysOfWeek: number[],
  hour: number,
  minute: number,
  tz: string
): Date {
  // Find the next weekly occurrence, then add 1 week to make it biweekly.
  // The worker's advanceNextRun() adds 2 weeks for subsequent runs,
  // so only the initial calculation needs this adjustment.
  const nextWeeklyRun = nextWeekly(now, daysOfWeek, hour, minute, tz);
  // Convert to zoned time, add 1 week, convert back
  const runInTz = toZonedTime(nextWeeklyRun, tz);
  const biweeklyRun = addWeeks(runInTz, 1);
  return toUtc(setTime(biweeklyRun, hour, minute), tz);
}
```

**Test:** Add a test that verifies biweekly returns a date at least 7 days out. Run `npm run test`

**Commit:** `fix(schedule): biweekly calculateNextRun now skips a week`

---

### Task 10: Fix NetSuite SuiteQL injection in getRecordFields and buildSuiteQL (M7)

**Severity:** Medium
**Files:**
- Modify: `src/lib/providers/netsuite.provider.ts`

**What to do:**

Add a `SAFE_SUITEQL_IDENTIFIER` regex and validate `recordType` before interpolation:

```typescript
// Add near top of file, after constants:
const SAFE_SUITEQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateRecordType(recordType: string): void {
  if (!SAFE_SUITEQL_IDENTIFIER.test(recordType)) {
    throw new Error(`Invalid record type: "${recordType}"`);
  }
}
```

1. In `getRecordFields()` (line 297-327), add validation before the query:
```typescript
validateRecordType(recordType);
```

2. In `buildSuiteQL()` (line 626-647), add validation:
```typescript
validateRecordType(config.recordType);
```

3. In the `filter` interpolation in `buildSuiteQL` (line 636-638), this is user-provided SQL. Leave as-is since the user writes the filter, but add a comment noting that SuiteQL is the backend's sandboxing layer.

**Also fix the netsuite/fields API** to return proper error status (fixes M16):

In `src/app/api/bifrost/netsuite/fields/route.ts`, change the error response from 200 to 500:
```typescript
return NextResponse.json(
  { error: "Failed to fetch fields", fields: [] },
  { status: 500 }
);
```

**Test:** Run `npm run test -- src/__tests__/providers/netsuite-provider.test.ts`

**Commit:** `fix(netsuite): validate recordType against SuiteQL injection, fix error status`

---

### Task 11: Include password in pool manager cache key (M1)

**Severity:** Medium
**Files:**
- Modify: `src/lib/providers/postgres.provider.ts` (and check mssql/mysql providers)

**What to do:**

Where `PoolManager.buildKey()` is called, include a hash of the password in the key. Find the call sites:

In each SQL provider's `connect()` method, the key is built from `{ host, port, database, user }`. Add `password` (or a hash of it):

```typescript
// Example in postgres.provider.ts:
const key = PoolManager.buildKey({
  host: cfg.host,
  port: cfg.port,
  database: cfg.database,
  user: creds.username,
  password: creds.password,  // ADD THIS
});
```

Do the same for `mssql.provider.ts` and `mysql.provider.ts`.

**Test:** Run `npm run test -- src/__tests__/providers/pool-manager.test.ts`

**Commit:** `fix(providers): include password in pool cache key to detect rotation`

---

### Task 12: Add monthsOfYear to BifrostRoute and advanceRouteNextRun (M2)

**Severity:** Medium
**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/bifrost/engine.ts`
- Modify: `src/lib/worker.ts`

**What to do:**

1. Add `monthsOfYear` to the BifrostRoute model in schema.prisma (after line 309):
```prisma
monthsOfYear     Int[]          @default([])
```

2. Run `npx prisma migrate dev --name add-months-of-year-to-bifrost-route`

3. In `engine.ts` `advanceRouteNextRun()` (line 543-570), add `monthsOfYear` to the function signature and the `calculateNextRun` call:

```typescript
export async function advanceRouteNextRun(route: {
  id: string;
  frequency: string | null;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  monthsOfYear?: number[];  // ADD
  timeHour: number;
  timeMinute: number;
  timezone: string;
}): Promise<void> {
  if (!route.frequency) return;

  const nextRun = calculateNextRun(
    {
      frequency: route.frequency as any,
      daysOfWeek: route.daysOfWeek,
      dayOfMonth: route.dayOfMonth,
      monthsOfYear: route.monthsOfYear,  // ADD
      timeHour: route.timeHour,
      timeMinute: route.timeMinute,
      timezone: route.timezone,
    },
    new Date()
  );

  await prisma.bifrostRoute.update({
    where: { id: route.id },
    data: { nextRunAt: nextRun },
  });
}
```

4. In `worker.ts`, add `monthsOfYear` to the Bifrost route select (line 138-148):
```typescript
select: {
  id: true,
  name: true,
  frequency: true,
  daysOfWeek: true,
  dayOfMonth: true,
  monthsOfYear: true,  // ADD
  timeHour: true,
  timeMinute: true,
  timezone: true,
},
```

**Test:** Run `npm run test`

**Commit:** `feat(bifrost): add monthsOfYear to BifrostRoute for quarterly schedules`

---

### Task 13: Advance nextRunAt BEFORE enqueue (M3)

**Severity:** Medium
**Files:**
- Modify: `src/lib/worker.ts`

**What to do:**

In the scheduler tick, advance `nextRunAt` BEFORE enqueueing the job. This closes the race window where a crash between enqueue and update causes re-enqueue:

```typescript
for (const schedule of dueSchedules) {
  // Advance nextRunAt FIRST to prevent re-enqueue on crash
  const nextRun = advanceNextRun(
    {
      frequency: schedule.frequency,
      daysOfWeek: schedule.daysOfWeek,
      dayOfMonth: schedule.dayOfMonth,
      monthsOfYear: schedule.monthsOfYear,
      timeHour: schedule.timeHour,
      timeMinute: schedule.timeMinute,
      timezone: schedule.timezone,
    },
    now
  );

  await prisma.schedule.update({
    where: { id: schedule.id },
    data: { nextRunAt: nextRun },
  });

  // THEN enqueue the job
  console.log(`[Worker] Enqueuing report: ${schedule.report.name} (schedule=${schedule.id})`);
  await boss.send("send-report", {
    reportId: schedule.reportId,
    scheduleId: schedule.id,
  }, {
    singletonKey: `report-${schedule.reportId}`,
  });

  console.log(`[Worker] Next run for ${schedule.report.name}: ${nextRun.toISOString()}`);
}
```

Do the same reorder for Bifrost routes — advance before enqueue.

**Test:** Run `npm run test`

**Commit:** `fix(worker): advance nextRunAt before enqueue to prevent duplicate jobs on crash`

---

### Task 14: Add execution timeout to scheduled route handler (M4)

**Severity:** Medium
**Files:**
- Modify: `src/lib/bifrost/jobs/route-job.handler.ts`

**What to do:**

Add a timeout wrapper around `engine.execute()`:

```typescript
import { BifrostEngine, loadRouteWithRelations } from "../engine";
import type { RouteJobPayload, RouteJobResult } from "../types";

const SCHEDULED_ROUTE_TIMEOUT_MS = 30 * 60_000; // 30 minutes

export async function handleRouteJob(job: {
  data: RouteJobPayload;
}): Promise<RouteJobResult> {
  const { routeId, triggeredBy } = job.data;

  console.log(
    `[Bifrost] Processing run-route: route=${routeId} triggeredBy=${triggeredBy}`
  );

  const route = await loadRouteWithRelations(routeId);

  // Skip if route was disabled after job was enqueued (fixes M15 too)
  if (!route.enabled) {
    console.log(`[Bifrost] Route ${routeId} is disabled — skipping`);
    return {
      routeLogId: "",
      status: "skipped",
      totalExtracted: 0,
      totalLoaded: 0,
      errorCount: 0,
      duration: 0,
    };
  }

  const engine = new BifrostEngine();

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Route execution timed out after ${SCHEDULED_ROUTE_TIMEOUT_MS / 60_000} minutes`)),
      SCHEDULED_ROUTE_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([
      engine.execute(route, triggeredBy),
      timeout,
    ]);
    clearTimeout(timer!);

    console.log(
      `[Bifrost] Route ${routeId} ${result.status}: ${result.totalLoaded}/${result.totalExtracted} rows`
    );

    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}
```

**Test:** Run `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`

**Commit:** `fix(bifrost): add 30-min timeout to scheduled route handler, skip disabled routes`

---

### Task 15: Widen SAFE_IDENTIFIER to support non-ASCII column names (M5)

**Severity:** Medium
**Files:**
- Modify: `src/lib/sync/watermark.ts`
- Test: `src/__tests__/sync/watermark.test.ts`

**What to do:**

Replace the strict ASCII regex with one that allows Unicode letters but still blocks SQL injection characters:

```typescript
// Old:
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// New — allow Unicode letters/digits but block dangerous characters
const SAFE_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
```

Add a test:
```typescript
it("accepts non-ASCII column names", () => {
  const clause = buildIncrementalClause("monto_año", "timestamp_cursor", "2026-01-15T08:30:00.000Z");
  expect(clause).toBe('"monto_año" > \'2026-01-15T08:30:00.000Z\'');
});
```

**Test:** Run `npm run test -- src/__tests__/sync/watermark.test.ts`

**Commit:** `fix(watermark): allow non-ASCII column names in cursor identifiers`

---

### Task 16: Fix floatSafeJsonLine regex corrupting string values (M6)

**Severity:** Medium
**Files:**
- Modify: `src/lib/providers/bigquery.provider.ts`
- Test: `src/__tests__/providers/bigquery-provider.test.ts`

**What to do:**

Replace the regex-based approach with a proper JSON walk:

```typescript
export function floatSafeJsonLine(row: Record<string, unknown>): string {
  return JSON.stringify(row, (_key, value) => {
    // Convert integer numbers to float to ensure consistent BQ FLOAT64 inference
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
      // Return as-is — we'll fix the serialization below
      return value;
    }
    return value;
  }).replace(
    // Only match top-level integer values in the serialized JSON
    // by using a replacer that marks integers
    /(?<=[:,\[])(-?\d+)(?=[,}\]])/g,
    "$1.0"
  );
}
```

Actually, the cleanest fix is to use a custom replacer that explicitly converts integers to floats:

```typescript
export function floatSafeJsonLine(row: Record<string, unknown>): string {
  // Walk the row and convert integers to floats at the value level,
  // avoiding regex on serialized JSON which can corrupt string values.
  const coerced: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    coerced[k] = typeof v === "number" && Number.isInteger(v) ? v + 0.0 : v;
  }
  // JSON.stringify(5.0) still outputs "5", so we need the regex.
  // But now string values are untouched because we only process top-level values.
  // Actually, nested objects are rare in BQ NDJSON rows (flat tables).
  // For safety, still use the regex but it's now only hitting true numeric values.
  return JSON.stringify(coerced, (_key, value) =>
    typeof value === "number" && Number.isInteger(value) ? value + Number.EPSILON : value
  );
}
```

Hmm, `JSON.stringify(5.0)` still outputs `"5"`. The simplest correct approach:

```typescript
export function floatSafeJsonLine(row: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push("{");
  const entries = Object.entries(row);
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    parts.push(JSON.stringify(key));
    parts.push(":");
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
      parts.push(value + ".0");
    } else {
      parts.push(JSON.stringify(value));
    }
    if (i < entries.length - 1) parts.push(",");
  }
  parts.push("}");
  return parts.join("");
}
```

This handles the value at the semantic level, not via regex on serialized JSON. Add test:

```typescript
it("does not corrupt string values containing numeric patterns", () => {
  const row = { notes: "value:5}", id: 42 };
  const line = floatSafeJsonLine(row);
  const parsed = JSON.parse(line);
  expect(parsed.notes).toBe("value:5}");
  expect(parsed.id).toBe(42.0);
});
```

**Test:** Run `npm run test -- src/__tests__/providers/bigquery-provider.test.ts`

**Commit:** `fix(bigquery): rewrite floatSafeJsonLine to avoid corrupting string values`

---

### Task 17: Fix report email dates using server timezone (M8)

**Severity:** Medium
**Files:**
- Modify: `src/lib/report-runner.ts`

**What to do:**

Import `toZonedTime` and `format` from `date-fns-tz`, and use the schedule's timezone for date formatting:

Find the date formatting calls (around lines 247-249, 257) and replace:

```typescript
// BEFORE
const reportDate = format(now, "MMMM d, yyyy");

// AFTER — use schedule timezone if available
import { formatInTimeZone } from "date-fns-tz";
const tz = schedule?.timezone ?? "UTC";
const reportDate = formatInTimeZone(now, tz, "MMMM d, yyyy");
```

Apply the same pattern to the `nextSchedule` date formatting.

**Test:** Run `npm run test`

**Commit:** `fix(reports): format email dates in schedule timezone, not server timezone`

---

### Task 18: Fix watermark extractNewWatermark timezone handling (M9)

**Severity:** Medium
**Files:**
- Modify: `src/lib/sync/watermark.ts`
- Test: `src/__tests__/sync/watermark.test.ts`

**What to do:**

In `extractNewWatermark` for `timestamp_cursor` (lines 116-123), instead of parsing through `new Date()` which loses timezone info, compare timestamps as strings (ISO strings are lexicographically sortable):

```typescript
if (strategy === "timestamp_cursor") {
  // ISO timestamps (and most DB timestamp formats) are lexicographically sortable.
  // Avoid new Date() parsing which assumes local timezone for naive timestamps.
  const stringValues = values.map(String);
  const max = stringValues.reduce((a, b) => (a > b ? a : b));
  // Validate the result is a parseable date
  if (isNaN(new Date(max).getTime())) return null;
  // Return the original string — preserves timezone offset if present
  return max;
}
```

Add test:
```typescript
it("preserves timezone offset in watermark", () => {
  const rows = [
    { ts: "2026-01-15T08:30:00-06:00" },
    { ts: "2026-01-15T12:30:00-06:00" },
  ];
  const result = extractNewWatermark(rows, "ts", "timestamp_cursor");
  expect(result).toBe("2026-01-15T12:30:00-06:00");
});
```

**Test:** Run `npm run test -- src/__tests__/sync/watermark.test.ts`

**Commit:** `fix(watermark): preserve original timestamp format instead of converting to UTC`

---

### Task 19: Add BigQuery extract jobTimeoutMs (M14)

**Severity:** Medium
**Files:**
- Modify: `src/lib/providers/bigquery.provider.ts`

**What to do:**

In `extract()` method, add `jobTimeoutMs` to the `createQueryJob` config (around line 148-159):

```typescript
const jobConfig: Record<string, unknown> = {
  query: config.query,
  useLegacySql: false,
  maximumBytesBilled: DEFAULT_MAX_BYTES_BILLED,
  jobTimeoutMs: String(QUERY_TIMEOUT),  // ADD THIS
};
```

**Test:** Run `npm run test -- src/__tests__/providers/bigquery-provider.test.ts`

**Commit:** `fix(bigquery): add jobTimeoutMs to extract createQueryJob`

---

### Task 20: Fix stale-log cleanup duplication (L3)

**Severity:** Low
**Files:**
- Modify: `src/lib/bifrost/engine.ts`

**What to do:**

Remove the stale-log cleanup from `engine.execute()` (lines 90-102). The worker startup already does this, and it's wasteful to run it on every execution:

Delete lines 90-102 (the `updateMany` block).

**Test:** Run `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`

**Commit:** `refactor(bifrost): remove redundant stale-log cleanup from engine (worker handles it)`

---

### Task 21: Fix report filename stripping non-ASCII (L5)

**Severity:** Low
**Files:**
- Modify: `src/lib/report-runner.ts`

**What to do:**

Replace the overly aggressive filename sanitizer. Keep Unicode letters but remove filesystem-unsafe characters:

```typescript
// BEFORE
report.name.replace(/[^a-zA-Z0-9-_ ]/g, "")

// AFTER — remove only filesystem-unsafe characters, keep Unicode letters
report.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim()
```

**Test:** Run `npm run test`

**Commit:** `fix(reports): allow non-ASCII characters in report filenames`

---

### Task 22: Fix SFTP GET endpoint perpetual password return (L6)

**Severity:** Low
**Files:**
- Modify: `src/app/api/sftp-connections/[id]/route.ts`

**What to do:**

Return a masked password instead of the decrypted one on GET:

```typescript
return NextResponse.json({
  ...connection,
  sftpPassword: rawPassword ? "••••••••" : null,
  hasPassword: !!rawPassword,
});
```

If the UI actually needs the raw password for display, add a separate `POST /api/sftp-connections/[id]/reveal` endpoint with a confirmation step.

**Test:** Run `npm run test`

**Commit:** `fix(security): mask SFTP password in GET response`

---

### Task 23: Log toConnectionLike plaintext fallback as warning (L7)

**Severity:** Low
**Files:**
- Modify: `src/lib/providers/helpers.ts`

**What to do:**

Add a warning log when the plaintext fallback is used:

```typescript
try {
  const decrypted = decrypt(connection.credentials);
  creds = JSON.parse(decrypted);
} catch {
  // May already be plaintext JSON (test connections before save)
  try {
    creds = JSON.parse(connection.credentials);
    console.warn("[Credentials] Plaintext JSON fallback used — encryption may be bypassed");
  } catch {
    /* credentials are neither encrypted nor valid JSON — leave empty */
  }
}
```

**Test:** Run `npm run test`

**Commit:** `fix(providers): warn when credentials fallback to plaintext parsing`

---

### Task 24: Use async gzip in Helheim dead-letter (L9)

**Severity:** Low
**Files:**
- Modify: `src/lib/bifrost/helheim/dead-letter.ts`

**What to do:**

Replace `gzipSync` with async `gzip`:

```typescript
import { gzip, gunzipSync } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);

export async function compressPayload(rows: Record<string, unknown>[]): Promise<string> {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const compressed = await gzipAsync(Buffer.from(ndjson, "utf8"));
  return compressed.toString("base64");
}
```

Update all callers of `compressPayload` to await the result (in `enqueueDeadLetter`).

**Test:** Run `npm run test -- src/__tests__/bifrost/helheim.test.ts`

**Commit:** `perf(helheim): use async gzip to avoid blocking event loop`

---

### Task 25: Sanitize worker error logging (L11, M-related)

**Severity:** Low
**Files:**
- Modify: `src/lib/worker.ts`

**What to do:**

Replace `console.error("[Worker] Scheduler tick error:", error)` with:
```typescript
console.error("[Worker] Scheduler tick error:", error instanceof Error ? error.message : "Unknown error");
```

Same for Helheim retry errors (lines 229, 235):
```typescript
console.error(`[Worker] Helheim retry failed for ${entry.id}:`, retryErr instanceof Error ? retryErr.message : "Unknown");
console.error(`[Worker] Helheim batch error for route ${routeId}:`, err instanceof Error ? err.message : "Unknown");
```

**Test:** Run `npm run test`

**Commit:** `fix(worker): sanitize error logging to prevent credential leakage`

---

### Task 26: Fix BigQuery schema cache nuclear clear (L2)

**Severity:** Low
**Files:**
- Modify: `src/lib/providers/bigquery.provider.ts`
- Modify: `src/lib/bifrost/engine.ts`

**What to do:**

1. In `bigquery.provider.ts`, change `clearSchemaCache()` to accept a specific key:
```typescript
export function clearSchemaCache(projectId?: string, dataset?: string, table?: string): void {
  if (projectId && dataset && table) {
    schemaCache.delete(schemaCacheKey(projectId, dataset, table));
  } else {
    schemaCache.clear();
  }
}
```

2. In `engine.ts`, pass the specific table info when clearing:
```typescript
// In the catch block where clearSchemaCache() is called:
if (route.dest.type === "BIGQUERY") {
  const bqConfig = destConnLike.config as { projectId?: string };
  clearSchemaCache(bqConfig.projectId, route.destConfig.dataset, route.destConfig.table);
}
```

**Test:** Run `npm run test`

**Commit:** `fix(bigquery): targeted schema cache invalidation instead of nuclear clear`

---

### Task 27–40: Remaining Low-Priority Fixes

These are lower-priority issues that should be addressed but have minimal runtime impact:

**Task 27 (L4):** Report DELETE should return `{ success: true, cascaded: { schedules: 1, runLogs: N } }` — read report relations before delete and include counts in response. File: `src/app/api/reports/[id]/route.ts`

**Task 28 (L8):** Add SSL toggle and BigQuery location selector to connection form. File: `src/components/connections/connection-form.tsx` — add `ssl` checkbox for SQL types, `location` dropdown for BigQuery.

**Task 29 (L10):** Test endpoints should validate that the target host is not a private IP range (basic SSRF protection). Files: `src/app/api/connections/test/route.ts`, `src/app/api/email-connections/test/route.ts` — add `isPrivateIp(host)` check using `node:net` `isIP` + range check.

**Task 30 (L12):** Already handled in Task 3 (explicit onDelete: Restrict added to schema).

**Task 31 (L13):** Replace `error.flatten()` with first error message only. Files: all API routes that return `parsed.error.flatten()` — change to `{ error: parsed.error.errors[0]?.message ?? "Validation failed" }`.

**Task 32 (M10 — DST):** In `setTime()`, after setting time, verify the result is valid. If in DST gap, shift forward by 1 hour. File: `src/lib/schedule-utils.ts`

**Task 33 (M11 — server clock):** Document that legacy `incrementalKey` path uses server clock, recommend `cursorConfig` path. No code change needed — this is a known limitation of the legacy path.

**Task 34 (M13 — report memory):** Add a `REPORT_ROW_LIMIT` constant (default 500_000) to the report runner. If query returns more rows, truncate and add a warning to the email. File: `src/lib/report-runner.ts`

**Task 35 (H8 — unbounded query):** Add `PREVIEW_ROW_LIMIT` to `/api/query/execute` — wrap user query with `SELECT * FROM (...) LIMIT 10000`. File: `src/app/api/query/execute/route.ts`. For Bifrost extract, this is by design (full extraction needed).

**Task 36 (L-misc):** Remove `as any` cast in worker line 75 and line 213. Type the pg-boss handler properly.

**Task 37 (M4-related — BigQuery extract no page timeout):** Add page-level timeout to BigQuery `extract()` pagination loop. File: `src/lib/providers/bigquery.provider.ts` — wrap `getQueryResults` in a timeout.

**Task 38 (M6-related — gzipSync):** Already handled in Task 24.

**Task 39 (M3-related — report send-report order):** Already handled in Task 13.

**Task 40 (L-misc — Zod flatten):** Already handled in Task 31.

---

## Execution Order Summary

| Task | Severity | Issue(s) | File(s) |
|------|----------|----------|---------|
| 1 | Critical | C1 | netsuite.provider.ts |
| 2 | Critical | C2, H4 | worker.ts, report-runner.ts |
| 3 | Critical | C3, L12 | connections/[id]/route.ts, schema.prisma |
| 4 | High | H1, L1 | validations/bifrost.ts |
| 5 | High | H2 | netsuite.provider.ts |
| 6 | High | H3 | api.ts |
| 7 | High | H5 | routes/[id]/run/route.ts, worker.ts |
| 8 | High | H6, M12 | dead-letter.ts, worker.ts |
| 9 | High | H7 | schedule-utils.ts |
| 10 | Medium | M7, M16 | netsuite.provider.ts, netsuite/fields/route.ts |
| 11 | Medium | M1 | postgres/mssql/mysql.provider.ts |
| 12 | Medium | M2 | schema.prisma, engine.ts, worker.ts |
| 13 | Medium | M3 | worker.ts |
| 14 | Medium | M4, M15 | route-job.handler.ts |
| 15 | Medium | M5 | watermark.ts |
| 16 | Medium | M6 | bigquery.provider.ts |
| 17 | Medium | M8 | report-runner.ts |
| 18 | Medium | M9 | watermark.ts |
| 19 | Medium | M14 | bigquery.provider.ts |
| 20 | Low | L3 | engine.ts |
| 21 | Low | L5 | report-runner.ts |
| 22 | Low | L6 | sftp-connections/[id]/route.ts |
| 23 | Low | L7 | helpers.ts |
| 24 | Low | L9 | dead-letter.ts |
| 25 | Low | L11 | worker.ts |
| 26 | Low | L2 | bigquery.provider.ts, engine.ts |
| 27-40 | Low | remaining | various |
