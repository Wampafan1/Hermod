# Hermod Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Five improvements covering failure notifications, debug log cleanup, connection health testing, Bifrost pagination, and email preview.

**Architecture:** Each task is self-contained with its own commit. Tasks are ordered by impact and risk — cleanup first, features last. No schema changes required.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, Prisma, Nodemailer, Vitest

---

## Task 1: Remove 17 Debug `console.log` Statements from column-config.ts

**Files:**
- Modify: `src/lib/column-config.ts`

**Why:** 17 `console.log` calls dump internal column IDs, pixel widths, and display names on every report run and Excel generation. Pure debug noise in production.

### Step 1: Remove all console.log statements

In `src/lib/column-config.ts`, remove every `console.log(...)` call. There are 17 of them, all in two functions:

- `extractTemplatePixelWidths()` (~lines 197, 203, 212, 215)
- `syncWidthsFromTemplate()` (~lines 236-239, 242, 248, 253, 258, 264, 273, 276, 278, 283)

Remove the entire `console.log(...)` line in each case. Do NOT replace them with anything — the code is self-explanatory and the calling code handles errors.

### Step 2: Run existing tests

Run: `npx vitest run src/__tests__/column-config.test.ts`
Expected: All pass (the tests don't assert on console output)

Run: `npx vitest run`
Expected: All 829+ tests pass

### Step 3: Commit

```bash
git add src/lib/column-config.ts
git commit -m "chore: remove 17 debug console.log statements from column-config.ts"
```

---

## Task 2: Failure Notification Email When Scheduled Report Fails

**Files:**
- Create: `src/lib/failure-notification.ts`
- Modify: `src/lib/report-runner.ts` (catch block, ~line 328)
- Create: `src/__tests__/failure-notification.test.ts`

**Why:** When a scheduled report fails, the error is written to RunLog but nobody is notified. The only way to discover failures is manually visiting the History page. For a scheduled delivery tool, this is a critical gap.

### Step 1: Write the test

Create `src/__tests__/failure-notification.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFailureNotificationEmail } from "@/lib/failure-notification";

describe("buildFailureNotificationEmail", () => {
  it("builds subject with report name", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });

    expect(result.subject).toBe("[Failed] Daily Sales — 2026-03-31 08:00:00");
  });

  it("includes error message in body", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });

    expect(result.text).toContain("Connection refused");
    expect(result.text).toContain("Daily Sales");
  });

  it("includes HTML body", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });

    expect(result.html).toContain("Connection refused");
    expect(result.html).toContain("Daily Sales");
  });

  it("escapes HTML in error message", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Test",
      errorMessage: '<script>alert("xss")</script>',
      timestamp: "2026-03-31 08:00:00",
    });

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run src/__tests__/failure-notification.test.ts`
Expected: FAIL — module not found

### Step 3: Create the failure notification module

Create `src/lib/failure-notification.ts`:

```ts
import { escapeHtml } from "@/lib/email-templates";

interface FailureNotificationInput {
  reportName: string;
  errorMessage: string;
  timestamp: string;
}

interface FailureNotificationOutput {
  subject: string;
  text: string;
  html: string;
}

export function buildFailureNotificationEmail(
  input: FailureNotificationInput
): FailureNotificationOutput {
  const subject = `[Failed] ${input.reportName} — ${input.timestamp}`;

  const text = [
    `HERMOD — Report Failure`,
    ``,
    `Report: ${input.reportName}`,
    `Time: ${input.timestamp}`,
    ``,
    `Error:`,
    input.errorMessage,
    ``,
    `---`,
    `Check the Run History page for details.`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#04060f;font-family:monospace;color:#d4c4a0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="border-bottom:1px solid rgba(201,147,58,0.3);padding-bottom:16px;margin-bottom:24px;">
      <h1 style="font-family:serif;font-size:18px;color:#e85d20;letter-spacing:0.15em;text-transform:uppercase;margin:0;">
        Report Failed
      </h1>
    </div>
    <table style="width:100%;font-size:13px;line-height:2;">
      <tr>
        <td style="color:rgba(212,196,160,0.7);padding-right:16px;white-space:nowrap;">Report</td>
        <td style="color:#d4c4a0;">${escapeHtml(input.reportName)}</td>
      </tr>
      <tr>
        <td style="color:rgba(212,196,160,0.7);padding-right:16px;white-space:nowrap;">Time</td>
        <td style="color:#d4c4a0;">${escapeHtml(input.timestamp)}</td>
      </tr>
    </table>
    <div style="margin-top:24px;padding:16px;background:#080c1a;border:1px solid rgba(201,147,58,0.1);">
      <p style="font-size:11px;color:rgba(212,196,160,0.7);text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px 0;">Error</p>
      <pre style="font-size:12px;color:#e85d20;white-space:pre-wrap;word-break:break-word;margin:0;">${escapeHtml(input.errorMessage)}</pre>
    </div>
    <p style="font-size:11px;color:rgba(212,196,160,0.5);margin-top:24px;">
      Check the Run History page for full details.
    </p>
  </div>
</body>
</html>`.trim();

  return { subject, text, html };
}
```

### Step 4: Run test to verify it passes

Run: `npx vitest run src/__tests__/failure-notification.test.ts`
Expected: 4 tests PASS

### Step 5: Wire into report-runner.ts catch block

In `src/lib/report-runner.ts`, the catch block at ~line 328 currently:
```ts
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.runLog.update({
      where: { id: runLog.id },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
      },
    });
    throw error;
  }
```

Modify it to send a failure notification after updating the RunLog. The `report`, `schedule`, and `emailConfig` variables are declared in the try block and not available in catch. We need to restructure slightly:

1. Move the `report` and `schedule` fetch BEFORE the try block (they rarely fail themselves)
2. In the catch, if we have a valid `emailConfig` and `user.email`, send the notification

Actually, the simplest approach: wrap the notification send in its own try/catch so it never prevents the original error from being thrown. The `report` variable is available from the outer scope since it's fetched at line 237. But `emailConfig` is inside the try. So we should store the email config outside.

Modify the function to:

1. After `const emailConfig = toEmailConfig(schedule.emailConnection);` (line 252), also store it in a variable visible to the catch block. The cleanest way: declare `let notifyConfig: EmailConnectionConfig | null = null;` before the try, then assign it inside.

2. In the catch block, after updating RunLog, attempt to send a failure email:

```ts
    // Best-effort failure notification to the report owner
    if (notifyConfig && report.user?.email) {
      try {
        const { buildFailureNotificationEmail } = await import("./failure-notification");
        const tz = schedule?.timezone || "America/Chicago";
        const notification = buildFailureNotificationEmail({
          reportName: report.name,
          errorMessage: message,
          timestamp: formatInTimeZone(new Date(), tz, "yyyy-MM-dd HH:mm:ss"),
        });
        const { sendNotificationEmail } = await import("./email");
        await sendNotificationEmail({
          connection: notifyConfig,
          to: [report.user.email],
          subject: notification.subject,
          body: notification.text,
        });
      } catch (notifyErr) {
        console.error("[Report] Failed to send failure notification:", notifyErr instanceof Error ? notifyErr.message : notifyErr);
      }
    }
```

The key changes to report-runner.ts:
- Add `import type { EmailConnectionConfig } from "@/lib/email";` at the top (it already imports `toEmailConfig` and `sendReportEmail`)
- Declare `let notifyConfig: EmailConnectionConfig | null = null;` before the try block (around line 235)
- After `const emailConfig = toEmailConfig(schedule.emailConnection);` add `notifyConfig = emailConfig;`
- In the catch block, after the RunLog update and before `throw error`, add the notification code above

The `sendNotificationEmail` function already exists in `src/lib/email.ts` (line 124) — it takes `{ connection, to, subject, body }` and sends a plain-text email. We don't need the HTML for the notification email to work (plain text is fine as fallback), but we can enhance `sendNotificationEmail` to also accept `html` if desired. For now, plain text is sufficient.

### Step 6: Run all tests

Run: `npx vitest run`
Expected: All pass (829+ including the new 4)

### Step 7: Commit

```bash
git add src/lib/failure-notification.ts src/__tests__/failure-notification.test.ts src/lib/report-runner.ts
git commit -m "feat: send failure notification email when a scheduled report fails"
```

---

## Task 3: Test Saved Database Connections by ID

**Files:**
- Create: `src/app/api/connections/[id]/test/route.ts`
- Modify: `src/components/connections/connection-card.tsx` (or `connection-list.tsx` — check which renders the card with actions)

**Why:** Users can test credentials before saving, but there's no way to test a saved connection by ID. If a password rotated or a firewall changed, users can't verify without re-entering all credentials.

### Step 1: Create the API route

Create `src/app/api/connections/[id]/test/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getProvider, toConnectionLike } from "@/lib/providers";

// POST /api/connections/[id]/test — test a saved connection
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/connections/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const connection = await prisma.connection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const provider = getProvider(connection.type);
  const connLike = toConnectionLike(connection);

  try {
    const success = await provider.testConnection(connLike);
    return NextResponse.json({ success });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    return NextResponse.json({ success: false, error: message });
  }
});
```

### Step 2: Add "Test" button to connection cards

Read `src/components/connections/connection-card.tsx` first to understand the existing card layout. Then add a "Test" button alongside existing actions (Edit, Delete). The button should:

1. Call `POST /api/connections/${id}/test`
2. Show a loading state while testing ("Testing...")
3. Show toast on success ("Connection is healthy") or error (the error message)

Add state `const [testing, setTesting] = useState(false)` and a `handleTest` function:

```ts
async function handleTest() {
  setTesting(true);
  try {
    const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast.success("Connection is healthy");
    } else {
      toast.error(data.error || "Connection test failed");
    }
  } catch {
    toast.error("Network error");
  } finally {
    setTesting(false);
  }
}
```

Add the button in the actions area:
```tsx
<button onClick={handleTest} disabled={testing} className="btn-subtle text-frost hover:text-gold-bright">
  {testing ? "Testing..." : "Test"}
</button>
```

### Step 3: Verify type-check and tests

Run: `npx tsc --noEmit 2>&1 | grep -E "connections.*test|connection-card"`
Expected: No errors

Run: `npx vitest run`
Expected: All pass

### Step 4: Commit

```bash
git add "src/app/api/connections/[id]/test/route.ts" src/components/connections/connection-card.tsx
git commit -m "feat: add Test button for saved database connections"
```

---

## Task 4: Bifrost Route History Pagination

**Files:**
- Modify: `src/app/api/bifrost/routes/[id]/logs/route.ts`
- Modify: `src/components/bifrost/route-history.tsx`

**Why:** The route logs API returns 50 rows with no cursor. A high-frequency route will need pagination as data grows. Also brings Bifrost history inline with the report history pattern we just built.

### Step 1: Add cursor pagination to the logs API

Modify `src/app/api/bifrost/routes/[id]/logs/route.ts`:

Replace the existing `findMany` block (after the read-repair stale cleanup) with cursor-paginated query:

```ts
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const PAGE_SIZE = 50;

  const logs = await prisma.routeLog.findMany({
    where: { routeId: id },
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = logs.length > PAGE_SIZE;
  const items = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor });
```

**IMPORTANT:** The response shape changes from `logs` (array) to `{ items, nextCursor }` (object). The component must be updated to match.

### Step 2: Update RouteHistory component

In `src/components/bifrost/route-history.tsx`, the `fetchData` callback currently does:
```ts
const [logsRes, helheimRes] = await Promise.all([
  fetch(`/api/bifrost/routes/${routeId}/logs`),
  fetch(`/api/bifrost/helheim?routeId=${routeId}`),
]);
if (logsRes.ok) setLogs(await logsRes.json());
```

Change to handle the paginated response:

1. Add state: `const [logCursor, setLogCursor] = useState<string | null>(null);`
2. Add state: `const [loadingMore, setLoadingMore] = useState(false);`
3. Update `fetchData` to parse `{ items, nextCursor }`:
```ts
if (logsRes.ok) {
  const data = await logsRes.json();
  setLogs(data.items);
  setLogCursor(data.nextCursor);
}
```
4. Add a `handleLoadMore` function:
```ts
async function handleLoadMore() {
  if (!logCursor) return;
  setLoadingMore(true);
  try {
    const res = await fetch(`/api/bifrost/routes/${routeId}/logs?cursor=${logCursor}`);
    if (res.ok) {
      const data = await res.json();
      setLogs((prev) => [...prev, ...data.items]);
      setLogCursor(data.nextCursor);
    }
  } catch {
    toast.error("Failed to load more logs");
  } finally {
    setLoadingMore(false);
  }
}
```
5. Add a "Load More" button at the bottom of the logs list (before the Helheim section), visible when `logCursor !== null`:
```tsx
{logCursor && (
  <div className="flex justify-center py-4">
    <button onClick={handleLoadMore} disabled={loadingMore} className="btn-ghost text-xs">
      {loadingMore ? "Loading..." : "Load More"}
    </button>
  </div>
)}
```

### Step 3: Verify and test

Run: `npx tsc --noEmit 2>&1 | grep -E "route-history|logs/route"`
Expected: No errors

Run: `npx vitest run`
Expected: All pass

### Step 4: Commit

```bash
git add "src/app/api/bifrost/routes/[id]/logs/route.ts" src/components/bifrost/route-history.tsx
git commit -m "feat: add cursor pagination to Bifrost route history"
```

---

## Task 5: Email Template Preview Without Sending

**Files:**
- Create: `src/app/api/reports/[id]/email-preview/route.ts`
- Modify: `src/components/reports/report-editor.tsx` (add Preview button)

**Why:** The only way to see what an email looks like is to trigger a real send. A preview endpoint renders the template with the report's actual metadata (but mock data for runtime stats) and returns HTML that can be displayed in an iframe.

### Step 1: Create the preview API route

Create `src/app/api/reports/[id]/email-preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { format } from "date-fns";
import {
  renderEmailTemplate,
  formatFileSize,
  type HermodEmailModel,
} from "@/lib/email-templates";

// GET /api/reports/[id]/email-preview — render email HTML without sending
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: { connection: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const now = new Date();
  const reportDate = format(now, "MMMM d, yyyy");
  const filename = `${report.name.replace(/[\/\\:*?"<>|]/g, "")}_${format(now, "yyyy-MM-dd")}.xlsx`;

  const emailModel: HermodEmailModel = {
    reportName: report.name,
    reportDate,
    filename,
    fileSize: formatFileSize(48_128), // Mock: ~47 KB
    nextSchedule: "Tomorrow at 8:00 AM",
    recipientName: "Team",
    clientName: "Team",
    datasource: report.connection.name,
    executionDate: format(now, "yyyy-MM-dd HH:mm:ss"),
    duration: "2.3s",
    rowCount: 1250,
    sheetCount: 1,
    sqlPreview: report.sqlQuery,
    version: process.env.npm_package_version || "0.1.0",
    managedBy: session.user.name || session.user.email || "Hermod",
  };

  const html = renderEmailTemplate("enduser", emailModel);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
```

### Step 2: Add Preview button to report editor

Read `src/components/reports/report-editor.tsx` first to understand the layout. Find the area where the "Test Send" button lives. Add a "Preview Email" button nearby.

When clicked, it should open a modal with an iframe that loads `/api/reports/${reportId}/email-preview`. The iframe renders the actual HTML email.

Add state:
```ts
const [showPreview, setShowPreview] = useState(false);
```

Add the button near the Test Send button:
```tsx
<button
  onClick={() => setShowPreview(true)}
  className="btn-ghost"
>
  Preview Email
</button>
```

Add the preview modal (after the form, inside the return):
```tsx
{showPreview && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onClick={() => setShowPreview(false)}
  >
    <div
      className="bg-deep border border-border-mid w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="heading-norse text-sm">Email Preview</h3>
        <button
          onClick={() => setShowPreview(false)}
          className="text-text-dim hover:text-text text-xl"
        >
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <iframe
          src={`/api/reports/${reportId}/email-preview`}
          className="w-full h-full min-h-[60vh] border-0 bg-white"
          title="Email preview"
        />
      </div>
    </div>
  </div>
)}
```

Note: The iframe has `bg-white` because the enduser email template has a light/parchment background — it's designed to look like an email client.

### Step 3: Verify and test

Run: `npx tsc --noEmit 2>&1 | grep -E "email-preview|report-editor"`
Expected: No errors

Run: `npx vitest run`
Expected: All pass

### Step 4: Commit

```bash
git add "src/app/api/reports/[id]/email-preview/route.ts" src/components/reports/report-editor.tsx
git commit -m "feat: add email template preview without sending"
```

---

## Execution Order

1. **Task 1** — Console.log cleanup (5 min, zero risk)
2. **Task 2** — Failure notifications (20 min, TDD, new module + catch block mod)
3. **Task 3** — Test saved connections (15 min, new route + button)
4. **Task 4** — Bifrost history pagination (15 min, API + component mod)
5. **Task 5** — Email preview (15 min, new route + modal)
