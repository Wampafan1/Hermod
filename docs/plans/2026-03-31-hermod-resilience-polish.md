# Hermod Resilience & Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Five improvements that harden Hermod's runtime resilience, fix data bugs, and fill UI gaps across error handling, history, loading states, worker stability, and dashboard accuracy.

**Architecture:** Each task is self-contained with its own commit. Tasks 1 and 5 are the fastest wins. Tasks 2-4 are medium effort. No schema changes required.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, Prisma, pg-boss, Vitest

---

## Task 1: Error Boundaries (App-Wide)

**Files:**
- Create: `src/app/(app)/error.tsx`
- Create: `src/app/(app)/bifrost/error.tsx` (re-export)
- Create: `src/app/(app)/mjolnir/error.tsx` (re-export)

**Why:** Zero `error.tsx` files exist. Any server component throw shows Next.js's default white error page — completely broken in the dark Norse UI.

**Step 1: Create the shared error boundary component**

Create `src/app/(app)/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Hermod] Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24">
      <span className="text-gold/20 text-4xl font-cinzel block mb-4">ᛉ</span>
      <h2 className="heading-norse text-lg mb-2">Something Went Wrong</h2>
      <p className="text-text-dim text-xs tracking-wide max-w-md text-center leading-relaxed mb-6">
        {error.message || "An unexpected error occurred. The forge has been disrupted."}
      </p>
      <button onClick={reset} className="btn-primary">
        <span>Try Again</span>
      </button>
    </div>
  );
}
```

**Step 2: Verify it renders in the Norse design**

Run: `npm run dev`

Temporarily throw in a server page (e.g., add `throw new Error("test")` at the top of `dashboard/page.tsx`) and verify:
- Dark background, Cinzel heading, gold button
- "Try Again" button calls `reset()` and re-renders the page
- Remove the test throw after verifying

**Step 3: Add Bifrost and Mjolnir error boundaries**

These pages do heavier data loading (external connections, AI calls). Create identical files that re-export the shared component for route-level isolation:

`src/app/(app)/bifrost/error.tsx`:
```tsx
"use client";
export { default } from "../error";
```

`src/app/(app)/mjolnir/error.tsx`:
```tsx
"use client";
export { default } from "../error";
```

This means if Bifrost crashes, it doesn't take down the entire app shell — the sidebar and topbar stay rendered.

**Step 4: Commit**

```bash
git add src/app/\(app\)/error.tsx src/app/\(app\)/bifrost/error.tsx src/app/\(app\)/mjolnir/error.tsx
git commit -m "feat: add error boundaries for app shell, Bifrost, and Mjolnir pages"
```

---

## Task 2: History Page — Pagination, Report Filter, Proper Re-Run

**Files:**
- Modify: `src/app/(app)/history/page.tsx`
- Modify: `src/app/api/history/route.ts`
- Modify: `src/components/history/history-list.tsx`

**Why:** History caps at 100 runs with no pagination, no per-report filtering. The "Re-run" button calls `/api/reports/[id]/send` which uses `runReport()` — that has a 5-minute idempotency guard that silently skips recent runs. Users think it worked but nothing happened.

### Step 1: Update the API route with cursor pagination and filters

Modify `src/app/api/history/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

const PAGE_SIZE = 50;

// GET /api/history?cursor=X&status=SUCCESS&reportId=Y
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const reportId = url.searchParams.get("reportId");

  const where: Record<string, unknown> = {
    report: { userId: session.user.id },
  };
  if (status && status !== "all") where.status = status;
  if (reportId) where.reportId = reportId;

  const runs = await prisma.runLog.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1, // fetch one extra to detect "has more"
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      report: { select: { id: true, name: true } },
    },
  });

  const hasMore = runs.length > PAGE_SIZE;
  const items = hasMore ? runs.slice(0, PAGE_SIZE) : runs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor });
});
```

### Step 2: Update history page to pass initial data from server

Modify `src/app/(app)/history/page.tsx`:

```tsx
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { HistoryList } from "@/components/history/history-list";

const PAGE_SIZE = 50;

export default async function HistoryPage() {
  const session = await requireAuth();

  const runs = await prisma.runLog.findMany({
    where: { report: { userId: session.user.id } },
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    include: {
      report: { select: { id: true, name: true } },
    },
  });

  const hasMore = runs.length > PAGE_SIZE;
  const items = hasMore ? runs.slice(0, PAGE_SIZE) : runs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  // Get unique report names for filter dropdown
  const reports = await prisma.report.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const serialized = items.map((r) => ({
    id: r.id,
    status: r.status,
    rowCount: r.rowCount,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    report: r.report,
  }));

  return (
    <div className="space-y-6">
      <HistoryList
        initialRuns={serialized}
        initialCursor={nextCursor}
        reports={reports}
      />
    </div>
  );
}
```

### Step 3: Rewrite HistoryList with client-side pagination and filters

Modify `src/components/history/history-list.tsx`:

Key changes:
- Props: `initialRuns`, `initialCursor`, `reports` (for filter dropdown)
- Client-side state: `runs`, `cursor`, `statusFilter`, `reportFilter`, `loading`
- "Load More" button at the bottom that fetches `/api/history?cursor=X&status=Y&reportId=Z`
- When filters change, reset runs and fetch fresh from API with filters applied
- Replace the inline error modal with `ConfirmDialog` pattern (or keep simple — the existing error modal is read-only, not a confirmation)
- The "Re-run" button should use `/api/schedules/[scheduleId]/send-now` if the report has a schedule, or show a toast explaining "No schedule configured — use Test Send from the report editor"

The full implementation should:

1. Keep the `relativeTime` helper, `formatDuration`, and `StatusBadge` patterns as-is
2. Add a report filter `<select>` next to the existing status filter
3. Add a "Load More" button that appears when `cursor !== null`
4. When either filter changes: clear runs, fetch page 1 from API with both filters
5. Re-run button: add `scheduleId` to the RunLog serialization. If the report has a schedule, call `/api/schedules/{scheduleId}/send-now`. If not, toast with guidance.

To support re-run, the API needs to also return the schedule ID. Modify the `include` in both `route.ts` and `page.tsx`:

```ts
include: {
  report: {
    select: {
      id: true,
      name: true,
      schedule: { select: { id: true } },
    },
  },
},
```

And serialize it:
```ts
report: {
  id: r.report.id,
  name: r.report.name,
  scheduleId: r.report.schedule?.id ?? null,
},
```

### Step 4: Run existing tests, add test for paginated API

Run: `npx vitest run`

Write a test in `src/__tests__/history-api.test.ts` that mocks Prisma and verifies:
- Returns `{ items, nextCursor }` shape
- `nextCursor` is null when fewer than PAGE_SIZE results
- Status and reportId filters are applied to the where clause

### Step 5: Commit

```bash
git add src/app/api/history/route.ts src/app/\(app\)/history/page.tsx src/components/history/history-list.tsx src/__tests__/history-api.test.ts
git commit -m "feat: add pagination, report/status filters, and working re-run to history page"
```

---

## Task 3: Bifrost & Mjolnir Loading Skeletons

**Files:**
- Create: `src/app/(app)/bifrost/loading.tsx`
- Create: `src/app/(app)/bifrost/[id]/loading.tsx`
- Create: `src/app/(app)/bifrost/new/loading.tsx`
- Create: `src/app/(app)/mjolnir/loading.tsx`

**Why:** Both sections have zero `loading.tsx` files. Navigation shows a blank screen while server components fetch external data (potentially slow NetSuite/BigQuery connections).

### Step 1: Create Bifrost loading skeletons

Use the same `skeleton-norse` pattern established in `src/app/(app)/loading.tsx`.

`src/app/(app)/bifrost/loading.tsx` — route list skeleton:
```tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 skeleton-norse" />
      <div className="space-y-px">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-deep border border-border p-5 skeleton-norse h-24" />
        ))}
      </div>
    </div>
  );
}
```

`src/app/(app)/bifrost/[id]/loading.tsx` — route detail skeleton:
```tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-72 skeleton-norse" />
      <div className="bg-deep border border-border p-6 skeleton-norse h-96" />
    </div>
  );
}
```

`src/app/(app)/bifrost/new/loading.tsx` — new route form skeleton:
```tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 skeleton-norse" />
      <div className="bg-deep border border-border p-6 skeleton-norse h-64" />
    </div>
  );
}
```

### Step 2: Create Mjolnir loading skeleton

`src/app/(app)/mjolnir/loading.tsx`:
```tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 skeleton-norse" />
      <div className="space-y-px">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-deep border border-border p-5 skeleton-norse h-20" />
        ))}
      </div>
    </div>
  );
}
```

### Step 3: Verify loading states display during navigation

Run: `npm run dev`

Navigate between pages in the app. Click into Bifrost and Mjolnir routes — verify the skeleton shows briefly before content loads. If content loads instantly (local dev), add a temporary `await new Promise(r => setTimeout(r, 2000))` to a server page to verify the skeleton renders, then remove it.

### Step 4: Commit

```bash
git add src/app/\(app\)/bifrost/loading.tsx src/app/\(app\)/bifrost/\[id\]/loading.tsx src/app/\(app\)/bifrost/new/loading.tsx src/app/\(app\)/mjolnir/loading.tsx
git commit -m "feat: add loading skeletons for Bifrost and Mjolnir pages"
```

---

## Task 4: Worker Graceful Shutdown on SIGTERM/SIGINT

**Files:**
- Modify: `src/lib/worker.ts`
- Create: `src/__tests__/worker-shutdown.test.ts`

**Why:** When the worker process is killed (deploy, restart, crash), in-flight jobs sit in "RUNNING" for up to 15 minutes until the next startup cleanup. This leaves stale status in both RunLog (reports) and RouteLog (Bifrost). A SIGTERM handler can mark them failed immediately.

### Step 1: Write the failing test

Create `src/__tests__/worker-shutdown.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The shutdown handler logic will be extracted into a testable function.
// We test the logic, not the signal wiring.

describe("markInFlightJobsFailed", () => {
  const mockPrisma = {
    runLog: { updateMany: vi.fn() },
    routeLog: { updateMany: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 0 });
  });

  it("marks all RUNNING runLog entries as FAILED", async () => {
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 1 });

    // Import after mocks are set up
    const { markInFlightJobsFailed } = await import("@/lib/worker-shutdown");
    await markInFlightJobsFailed(mockPrisma as any);

    expect(mockPrisma.runLog.updateMany).toHaveBeenCalledWith({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
  });

  it("marks all running routeLog entries as failed", async () => {
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 0 });

    const { markInFlightJobsFailed } = await import("@/lib/worker-shutdown");
    await markInFlightJobsFailed(mockPrisma as any);

    expect(mockPrisma.routeLog.updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: {
        status: "failed",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run src/__tests__/worker-shutdown.test.ts`
Expected: FAIL — `@/lib/worker-shutdown` does not exist

### Step 3: Create the shutdown helper

Create `src/lib/worker-shutdown.ts`:

```ts
/**
 * Marks all currently-running jobs as failed.
 * Called on SIGTERM/SIGINT before process exit.
 */
export async function markInFlightJobsFailed(prisma: {
  runLog: { updateMany: (args: any) => Promise<{ count: number }> };
  routeLog: { updateMany: (args: any) => Promise<{ count: number }> };
}): Promise<void> {
  const now = new Date();
  const message = "Worker process shut down while job was in flight";

  const [reports, routes] = await Promise.all([
    prisma.runLog.updateMany({
      where: { status: "RUNNING" },
      data: { status: "FAILED", error: message, completedAt: now },
    }),
    prisma.routeLog.updateMany({
      where: { status: "running" },
      data: { status: "failed", error: message, completedAt: now },
    }),
  ]);

  if (reports.count > 0 || routes.count > 0) {
    console.log(
      `[Worker] Shutdown cleanup: marked ${reports.count} report(s) and ${routes.count} route(s) as failed`
    );
  }
}
```

### Step 4: Run test to verify it passes

Run: `npx vitest run src/__tests__/worker-shutdown.test.ts`
Expected: PASS

### Step 5: Wire up signal handlers in worker.ts

Add to the end of the `main()` function in `src/lib/worker.ts`, before the SFTP watcher:

```ts
  // ─── Graceful Shutdown ─────────────────────────
  async function shutdown(signal: string) {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    try {
      const { markInFlightJobsFailed } = await import("./worker-shutdown");
      await markInFlightJobsFailed(prisma);
    } catch (err) {
      console.error("[Worker] Shutdown cleanup error:", safeErrorMessage(err));
    }
    await boss.stop({ graceful: true, timeout: 10_000 });
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
```

Place this BEFORE the `startSftpWatcher(prisma)` call (line ~263).

### Step 6: Run all tests

Run: `npx vitest run`
Expected: All pass (826+ tests)

### Step 7: Commit

```bash
git add src/lib/worker-shutdown.ts src/__tests__/worker-shutdown.test.ts src/lib/worker.ts
git commit -m "feat: add graceful shutdown to worker — mark in-flight jobs as failed on SIGTERM/SIGINT"
```

---

## Task 5: Fix Dashboard "Runs (30d)" Stat

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Why:** The dashboard "Runs (30d)" card shows `recentRuns.length` which is capped at 10 (the `take: 10` limit). A user with 50 runs this month sees "10". This is a data bug.

### Step 1: Add a proper 30-day count query

In `src/app/(app)/dashboard/page.tsx`, add a fifth query to the `Promise.all`:

Change:
```ts
const [reportCount, connectionCount, recentRuns, upcomingSchedules] =
  await Promise.all([
    prisma.report.count({ where: { userId: session.user.id } }),
    prisma.connection.count({ where: { userId: session.user.id } }),
    prisma.runLog.findMany({ ... }),
    prisma.schedule.findMany({ ... }),
  ]);
```

To:
```ts
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const [reportCount, connectionCount, recentRuns, upcomingSchedules, runCount30d] =
  await Promise.all([
    prisma.report.count({ where: { userId: session.user.id } }),
    prisma.connection.count({ where: { userId: session.user.id } }),
    prisma.runLog.findMany({
      where: { report: { userId: session.user.id } },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { report: { select: { name: true } } },
    }),
    prisma.schedule.findMany({
      where: {
        enabled: true,
        report: { userId: session.user.id },
        nextRunAt: {
          lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
          gte: new Date(),
        },
      },
      orderBy: { nextRunAt: "asc" },
      take: 5,
      include: { report: { select: { name: true } } },
    }),
    prisma.runLog.count({
      where: {
        report: { userId: session.user.id },
        startedAt: { gte: thirtyDaysAgo },
      },
    }),
  ]);
```

### Step 2: Update the StatCard to use the correct value

Change:
```tsx
<StatCard label="Runs (30d)" value={recentRuns.length} rune="ᚺ" />
```

To:
```tsx
<StatCard label="Runs (30d)" value={runCount30d} rune="ᚺ" />
```

### Step 3: Verify in dev

Run: `npm run dev`

Navigate to the dashboard. The "Runs (30d)" card should now show the actual count of runs in the last 30 days, not capped at 10.

### Step 4: Run all tests

Run: `npx vitest run`
Expected: All pass

### Step 5: Commit

```bash
git add src/app/\(app\)/dashboard/page.tsx
git commit -m "fix: dashboard Runs (30d) stat now counts all runs instead of capping at 10"
```

---

## Execution Order

Recommended sequence (fastest wins first):

1. **Task 5** — Dashboard stat fix (5 min, one file, zero risk)
2. **Task 1** — Error boundaries (10 min, new files only, zero risk)
3. **Task 3** — Loading skeletons (10 min, new files only, zero risk)
4. **Task 4** — Worker graceful shutdown (20 min, new file + small worker mod, TDD)
5. **Task 2** — History pagination + filters (45 min, three files modified, most complex)
