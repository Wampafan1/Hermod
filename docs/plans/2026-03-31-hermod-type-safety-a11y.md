# Hermod Type Safety & Accessibility Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Five improvements covering database indexes, Zod validation fixes, type safety cleanup, accessibility gaps, and DST schedule test coverage.

**Architecture:** Each task is self-contained with its own commit. All are low-risk mechanical changes. Task 1 requires a Prisma migration. Tasks 2-5 are code-only.

**Tech Stack:** Next.js 14 App Router, Prisma, Zod, Tailwind CSS, Vitest

---

## Task 1: Add Missing Database Indexes

**Files:**
- Modify: `prisma/schema.prisma`

**Why:** Four high-frequency query patterns hit unindexed columns: RunLog.startedAt (history page ORDER BY), Schedule.nextRunAt (worker polling), BifrostRoute.nextRunAt (worker polling), RouteLog.startedAt (Bifrost history ORDER BY).

### Step 1: Add indexes to Prisma schema

In `prisma/schema.prisma`, add `@@index` directives to four models:

**RunLog** (around line 214, after the existing `@@index([reportId, status])`):
```prisma
  @@index([startedAt])
```

**Schedule** (around line 181, at the end of the model before the closing `}`):
```prisma
  @@index([enabled, nextRunAt])
```

**BifrostRoute** (around line 333, after the existing `@@index([destId])`):
```prisma
  @@index([enabled, nextRunAt])
```

**RouteLog** (around line 351, after the existing `@@index([routeId, status])`):
```prisma
  @@index([routeId, startedAt])
```

Note: Schedule and BifrostRoute get composite indexes on `[enabled, nextRunAt]` because the worker always filters `WHERE enabled = true AND nextRunAt <= now`. The composite index serves both conditions in a single B-tree scan.

### Step 2: Generate a migration

Run: `npx prisma migrate dev --name add_performance_indexes`

This creates a SQL migration that adds the 4 indexes. It's purely additive — no data loss risk.

### Step 3: Verify

Run: `npx prisma generate` (regenerate client)
Run: `npx vitest run 2>&1 | tail -5` — all pass

### Step 4: Commit

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "perf: add indexes for RunLog.startedAt, Schedule.nextRunAt, BifrostRoute.nextRunAt, RouteLog.startedAt"
```

---

## Task 2: Fix Bifrost Routes Using Throwing `.parse()` Instead of `.safeParse()`

**Files:**
- Modify: `src/app/api/bifrost/routes/route.ts` (line 30)
- Modify: `src/app/api/bifrost/routes/[id]/route.ts` (line 39)
- Modify: `src/app/api/bifrost/providers/schema/route.ts` (line 10)

**Why:** These three routes call Zod's `.parse()` which throws a raw `ZodError` on bad input, resulting in an unhandled 500. Every other route in the codebase correctly uses `.safeParse()` to return a clean 400.

### Step 1: Fix `src/app/api/bifrost/routes/route.ts`

Change line 30 from:
```ts
  const data = createRouteSchema.parse(body);
```

To:
```ts
  const parsed = createRouteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
```

### Step 2: Fix `src/app/api/bifrost/routes/[id]/route.ts`

Change line 39 from:
```ts
  const data = updateRouteSchema.parse(body);
```

To the same `.safeParse()` pattern as above, using `updateRouteSchema`.

### Step 3: Fix `src/app/api/bifrost/providers/schema/route.ts`

Change line 10 from:
```ts
  const data = fetchSchemaSchema.parse(body);
```

To the same `.safeParse()` pattern using `fetchSchemaSchema`.

### Step 4: Verify

Run: `npx tsc --noEmit 2>&1 | grep -E "bifrost/routes|bifrost/providers"` — no errors
Run: `npx vitest run 2>&1 | tail -5` — all pass

### Step 5: Commit

```bash
git add src/app/api/bifrost/routes/route.ts "src/app/api/bifrost/routes/[id]/route.ts" src/app/api/bifrost/providers/schema/route.ts
git commit -m "fix: replace throwing .parse() with .safeParse() in Bifrost API routes"
```

---

## Task 3: Replace 12 `as any` Casts with `Prisma.InputJsonValue`

**Files:**
- Modify: `src/app/api/bifrost/routes/route.ts` (lines 75, 90, 92, 102)
- Modify: `src/app/api/bifrost/routes/[id]/route.ts` (lines 47, 64, 66, 75)
- Modify: `src/app/api/reports/route.ts` (lines 65-66)
- Modify: `src/app/api/reports/[id]/route.ts` (lines 84-85)

**Why:** 12 instances of `as any` are used to pass Zod-parsed objects into Prisma's `Json` fields. The correct Prisma type is `Prisma.InputJsonValue`, which accepts `string | number | boolean | JsonObject | JsonArray | null`.

### Step 1: Fix Bifrost routes/route.ts

Add import at top of file:
```ts
import { Prisma } from "@prisma/client";
```

Replace each `as any` with `as Prisma.InputJsonValue`:
- Line 75: `frequency: data.frequency as any` → `frequency: data.frequency as Prisma.InputJsonValue`
- Line 90: `sourceConfig: data.sourceConfig as any` → `sourceConfig: data.sourceConfig as Prisma.InputJsonValue`
- Line 92: `destConfig: data.destConfig as any` → `destConfig: data.destConfig as Prisma.InputJsonValue`
- Line 102: `(data.cursorConfig ?? null) as any` → `(data.cursorConfig ?? null) as Prisma.InputJsonValue`

NOTE: The `frequency` field on line 75 might actually be a Prisma enum, not a Json field. Read the schema first — if `frequency` is `ScheduleFrequency` enum, just remove the cast entirely (Zod already validates it as the correct string union). Only cast Json fields.

### Step 2: Fix Bifrost routes/[id]/route.ts

Same pattern — add `Prisma` import, replace `as any` with `as Prisma.InputJsonValue` on lines 47, 64, 66, 75. Same note about `frequency` — if it's an enum, remove the cast.

### Step 3: Fix reports/route.ts

Add `Prisma` import, replace lines 65-66:
```ts
formatting: parsed.data.formatting as Prisma.InputJsonValue ?? undefined,
columnConfig: parsed.data.columnConfig as Prisma.InputJsonValue ?? undefined,
```

### Step 4: Fix reports/[id]/route.ts

Same pattern for lines 84-85.

### Step 5: Verify

Run: `npx tsc --noEmit 2>&1 | grep -E "bifrost/routes|reports/route|reports/\[id\]"` — no errors
Run: `npx vitest run 2>&1 | tail -5` — all pass

### Step 6: Commit

```bash
git add src/app/api/bifrost/routes/route.ts "src/app/api/bifrost/routes/[id]/route.ts" src/app/api/reports/route.ts "src/app/api/reports/[id]/route.ts"
git commit -m "fix: replace 12 'as any' casts with Prisma.InputJsonValue in API routes"
```

---

## Task 4: Fix Accessibility — Hand-Rolled Modals + Table Scopes

**Files:**
- Modify: `src/components/history/history-list.tsx` (modal ~line 216)
- Modify: `src/components/reports/report-editor.tsx` (modal ~line 503)
- Modify: `src/components/bifrost/route-history.tsx` (th elements, lines 138-144)
- Modify: `src/components/bifrost/route-list.tsx` (th elements, lines 154-160)
- Modify: `src/components/mjolnir/validation-report.tsx` (th elements, lines 198-207)

### Step 1: Fix history-list.tsx error modal

The error details modal at ~line 216 needs:
- Add `role="dialog"` and `aria-modal="true"` to the inner panel div
- Add `aria-label="Error details"` to the close `&times;` button
- Add `onClick={dismissModal}` to the backdrop (it already has `onClick={() => setErrorModal(null)}` on the backdrop — good)

### Step 2: Fix report-editor.tsx email preview modal

The preview modal at ~line 503 needs:
- Add `role="dialog"` and `aria-modal="true"` to the inner panel div
- Add `aria-label="Close preview"` to the close `&times;` button

### Step 3: Add `scope="col"` to Bifrost and Mjolnir table headers

In `route-history.tsx` lines 138-144, add `scope="col"` to each `<th>`:
```tsx
<th scope="col" className="px-4 py-3 text-left font-normal">Status</th>
```

Same for `route-list.tsx` lines 154-160 — add `scope="col"` to each `<th>`.

Same for `validation-report.tsx` lines 198-207 — add `scope="col"` to each `<th>`.

### Step 4: Verify

Run: `npx tsc --noEmit 2>&1 | grep -E "history-list|report-editor|route-history|route-list|validation-report"` — no errors
Run: `npx vitest run 2>&1 | tail -5` — all pass

### Step 5: Commit

```bash
git add src/components/history/history-list.tsx src/components/reports/report-editor.tsx src/components/bifrost/route-history.tsx src/components/bifrost/route-list.tsx src/components/mjolnir/validation-report.tsx
git commit -m "fix: add ARIA attributes to hand-rolled modals and scope to table headers"
```

---

## Task 5: Add DST Regression Tests for Schedule Calculations

**Files:**
- Modify: `src/__tests__/schedule-utils.test.ts`

**Why:** The `nextBiweekly` and `advanceNextRun` functions correctly apply `setTime` after date arithmetic (protecting against DST shifts), but there are zero tests verifying this. If someone removes the `setTime` call, the regression would be invisible. Lock in the behavior with explicit DST tests.

### Step 1: Add DST tests

Add a new `describe("DST transitions")` block to `src/__tests__/schedule-utils.test.ts`:

```ts
describe("DST transitions", () => {
  // US DST 2026: spring forward March 8, fall back November 1
  // America/Chicago: CST (UTC-6) → CDT (UTC-5) on Mar 8 at 2:00 AM

  it("calculateNextRun preserves time across spring-forward DST", () => {
    // March 7, 2026 at 8:00 AM CST (UTC-6) = 14:00 UTC
    const before = new Date("2026-03-07T14:00:00Z");
    const result = calculateNextRun(
      {
        frequency: "DAILY",
        daysOfWeek: [],
        dayOfMonth: null,
        monthsOfYear: [],
        timeHour: 8,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      before
    );
    // March 8 is spring-forward day. 8:00 AM CDT (UTC-5) = 13:00 UTC
    expect(result.getUTCHours()).toBe(13);
    expect(result.getUTCDate()).toBe(8);
  });

  it("advanceNextRun biweekly preserves time across spring-forward DST", () => {
    // Feb 22 at 8:00 AM CST (UTC-6) = 14:00 UTC
    const lastRun = new Date("2026-02-22T14:00:00Z");
    const result = advanceNextRun(
      {
        frequency: "BIWEEKLY",
        daysOfWeek: [0], // Sunday
        dayOfMonth: null,
        monthsOfYear: [],
        timeHour: 8,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      lastRun
    );
    // 2 weeks later = March 8 (spring-forward day)
    // 8:00 AM CDT (UTC-5) = 13:00 UTC — NOT 14:00 UTC (which would be wrong)
    expect(result.getUTCHours()).toBe(13);
    expect(result.getUTCDate()).toBe(8);
  });

  it("calculateNextRun preserves time across fall-back DST", () => {
    // Oct 31, 2026 at 8:00 AM CDT (UTC-5) = 13:00 UTC
    const before = new Date("2026-10-31T13:00:00Z");
    const result = calculateNextRun(
      {
        frequency: "DAILY",
        daysOfWeek: [],
        dayOfMonth: null,
        monthsOfYear: [],
        timeHour: 8,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      before
    );
    // Nov 1 is fall-back day. 8:00 AM CST (UTC-6) = 14:00 UTC
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCDate()).toBe(1);
  });
});
```

### Step 2: Run tests

Run: `npx vitest run src/__tests__/schedule-utils.test.ts`
Expected: All pass (existing 14 + 3 new = 17)

Run: `npx vitest run 2>&1 | tail -5` — all pass

### Step 3: Commit

```bash
git add src/__tests__/schedule-utils.test.ts
git commit -m "test: add DST regression tests for schedule calculations"
```

---

## Execution Order

1. **Task 2** — SafeParse fix (5 min, mechanical, zero risk)
2. **Task 3** — InputJsonValue type fix (5 min, mechanical, zero risk)
3. **Task 4** — Accessibility fixes (10 min, HTML attributes only)
4. **Task 5** — DST test coverage (5 min, test-only, zero risk)
5. **Task 1** — Database indexes (10 min, requires migration — last because it touches the DB)
