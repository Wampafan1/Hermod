# Cross-Cutting 40-Bug Fix — Complete Changelog

> 27 commits, 22 unique source files modified, 755 tests passing (4 pre-existing failures in netsuite-provider.test.ts)

---

## Commit 1: `de9d98d` — fix(security): remove NetSuite debug logging that exposes OAuth credentials
**Severity:** Critical
**File:** `src/lib/providers/netsuite.provider.ts`

- **What:** Deleted `console.log` blocks that printed OAuth consumer key, consumer secret, token ID, and token secret to stdout during every NetSuite API request.
- **Why:** These credentials grant full API access to the NetSuite account. Any log aggregator, container stdout, or shared terminal would capture them in plaintext.

---

## Commit 2: `652b64b` — fix(worker): make send-report idempotent with singletonKey and duplicate check
**Severity:** Critical + High
**Files:** `src/lib/report-runner.ts`, `src/lib/worker.ts`

- **What (worker.ts):** Added `singletonKey: \`report-${schedule.reportId}\`` to `boss.send("send-report", ...)` call.
- **What (report-runner.ts):** Added idempotency guard at the start of `runReport()` — queries for a recent `SUCCESS` RunLog within the last 5 minutes and skips execution if found.
- **Why:** If the worker crashed after enqueuing a job but before advancing `nextRunAt`, the same report could be enqueued again on restart, sending duplicate emails. The singletonKey prevents pg-boss from accepting a duplicate job, and the RunLog check is a defense-in-depth guard.

---

## Commit 3: `8c67bfe` — fix(api): check BifrostRoute references before deleting Connection, add explicit onDelete
**Severity:** Critical + Low
**Files:** `prisma/schema.prisma`, `src/app/api/connections/[id]/route.ts`

- **What (schema.prisma):** Added `onDelete: Restrict` to `Report->Connection`, `BifrostRoute->source`, and `BifrostRoute->dest` relations. Previously these had no explicit onDelete behavior.
- **What (route.ts):** Added a `prisma.bifrostRoute.count({ where: { OR: [{ sourceId: id }, { destId: id }] } })` check before allowing Connection deletion. Returns 409 with a descriptive error if routes reference the connection.
- **Why:** Deleting a Connection that Bifrost routes or reports depend on would leave orphaned foreign keys, causing runtime errors on the next scheduled run.

---

## Commit 4: `76fee46` — fix(bifrost): add fieldMapping and chunkSize to destConfigSchema
**Severity:** High + Low
**File:** `src/lib/validations/bifrost.ts`

- **What:** Added `fieldMapping: z.record(z.string()).nullable().optional()` and `chunkSize: z.number().int().min(100).max(100_000).optional()` to `destConfigSchema`.
- **Why:** Zod's `.strict()` parsing was silently stripping these fields from the request body because they weren't declared in the schema. Routes saved without fieldMapping or with default chunkSize even when the user configured them.

---

## Commit 5: `de69ac6` — fix(netsuite): read last_run from config.params where engine stores it
**Severity:** High
**File:** `src/lib/providers/netsuite.provider.ts`

- **What:** Changed `last_run` read location from `config.last_run` to `config.params?.last_run` with a fallback to `config.last_run` for backwards compatibility.
- **Why:** The Bifrost engine stores the last run timestamp in `sourceConfig.params.last_run`, but the NetSuite provider was reading from `sourceConfig.last_run` (a different location). This caused incremental sync to always do a full refresh because the watermark was never found.

---

## Commit 6: `a94ddac` — fix(security): sanitize 500 error messages in withAuth wrapper
**Severity:** High
**File:** `src/lib/api.ts`

- **What:** Replaced `{ error: error.message }` in the catch block with a generic `{ error: "An internal error occurred. Please try again or contact support." }`. The raw error is still logged server-side via `console.error`.
- **Why:** Raw error messages from database drivers, HTTP clients, and internal code could contain connection strings, SQL queries, file paths, or stack traces. These were being sent directly to the browser.

---

## Commit 7: `7724f92` — fix(bifrost): clean up Promise.race timers to prevent leaks
**Severity:** High
**Files:** `src/app/api/bifrost/routes/[id]/run/route.ts`, `src/lib/worker.ts`

- **What (worker.ts):** Rewrote `withTimeout()` helper to use `.finally(() => clearTimeout(timer!))` instead of manual clearTimeout in try/catch branches.
- **What (run/route.ts):** Added try/catch/clearTimeout pattern around the `Promise.race` timeout (previously had no cleanup).
- **Why:** The `setTimeout` callback held a reference to the reject function and its closure. Without `clearTimeout`, completed promises left zombie timers that could fire after the Promise was settled, and the closures were not garbage-collected until the timer expired (up to 10 minutes).

---

## Commit 8: `e503b36` — fix(helheim): recover entries stuck in "retrying" status, bound query
**Severity:** High + Medium
**File:** `src/lib/bifrost/helheim/dead-letter.ts`

- **What:** Updated `getDueRetries()` to include a second OR branch: `{ status: "retrying", lastRetriedAt: { lte: new Date(Date.now() - 5 * 60_000) } }`. Also added `take: 100` to bound the result set.
- **Why:** If the worker crashed mid-retry, the entry stayed in "retrying" status forever — never re-queued. The 5-minute threshold recovers these stuck entries. The `take: 100` prevents a pathological case where thousands of due entries overwhelm a single scheduler tick.

---

## Commit 9: `b06133e` — fix(schedule): biweekly calculateNextRun now enforces 2-week gap
**Severity:** High
**File:** `src/lib/schedule-utils.ts`

- **What:** Changed `nextBiweekly()` to call `nextWeekly()` to find the next valid day-of-week occurrence, then add 1 week with `addWeeks(runInTz, 1)`.
- **Why:** The biweekly function was returning the same result as weekly — it found the next matching day-of-week but never added the extra week to create a 2-week gap.

---

## Commit 10: `a3b1a01` — fix(netsuite): validate recordType against SuiteQL injection, fix error status
**Severity:** Medium
**Files:** `src/lib/providers/netsuite.provider.ts`, `src/app/api/bifrost/netsuite/fields/route.ts`

- **What (netsuite.provider.ts):** Added `SAFE_SUITEQL_IDENTIFIER` regex (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) and `validateSuiteQLIdentifier()` function. Applied validation to `recordType` in `getRecordFields()` and to table/field names in `buildSuiteQL()`.
- **What (fields/route.ts):** Changed error response from `status: 200` (with error in body) to `status: 500` with a sanitized message.
- **Why:** Record type names and field names were interpolated directly into SuiteQL strings without validation. A crafted recordType like `"transaction; DROP TABLE"` could inject arbitrary SuiteQL. The fields route was also returning errors as 200 OK, confusing the frontend.

---

## Commit 11: `1bc5477` — fix(providers): include password in pool cache key to detect rotation
**Severity:** Medium
**Files:** `src/lib/providers/postgres.provider.ts`, `src/lib/providers/mssql.provider.ts`, `src/lib/providers/mysql.provider.ts`

- **What:** Added `password: creds.password` to the `PoolManager.buildKey()` call in all three SQL providers.
- **Why:** The pool cache key was based on host+port+db+user but not password. If a user rotated their database password and updated the Connection record, the pool manager would return the old pool with the stale password, causing auth failures until the pool expired or the worker restarted.

---

## Commit 12: `95a58f2` — feat(bifrost): add monthsOfYear to BifrostRoute for quarterly schedules
**Severity:** Medium
**Files:** `prisma/schema.prisma`, `src/lib/bifrost/engine.ts`, `src/lib/worker.ts`

- **What (schema.prisma):** Added `monthsOfYear Int[] @default([])` to the `BifrostRoute` model.
- **What (engine.ts):** Added `monthsOfYear` to the `advanceRouteNextRun()` function signature and the `calculateNextRun()` call.
- **What (worker.ts):** Added `monthsOfYear: true` to the Bifrost route select query in the scheduler tick.
- **Why:** Quarterly schedules need to know which months to run in (e.g., Jan/Apr/Jul/Oct). The field existed on the `Schedule` model for reports but was missing from `BifrostRoute`. Without it, `calculateNextRun` received `undefined` for `monthsOfYear`, causing quarterly Bifrost routes to never fire.

---

## Commit 13: `1afcd92` — fix(worker): advance nextRunAt before enqueue to prevent duplicates on crash
**Severity:** Medium
**File:** `src/lib/worker.ts`

- **What:** Reordered the report scheduler loop: `advanceNextRun` + `prisma.schedule.update` now happens BEFORE `boss.send()`. Previously the order was: enqueue job, then advance nextRunAt.
- **Why:** If the worker crashed after `boss.send()` but before the `prisma.schedule.update`, the schedule's `nextRunAt` would still be in the past on restart, causing the same job to be enqueued again. Advancing first means a crash loses at most one run (safer than duplicating).

---

## Commit 14: `e4decb0` — fix: add 30-min timeout and disabled-route guard to route job handler
**Severity:** Medium
**File:** `src/lib/bifrost/jobs/route-job.handler.ts` (new file)

- **What:** Created the route job handler with a 30-minute `Promise.race` timeout and a check for `route.enabled` before execution. If the route is disabled, returns a `"skipped"` result without running.
- **Why:** Scheduled route jobs had no execution timeout — a hung database connection or infinite loop would block a pg-boss worker slot forever. The disabled check prevents running routes that were turned off between enqueue and execution.

---

## Commit 15: `e7712eb` — fix: widen watermark identifier validation to support non-ASCII columns
**Severity:** Medium
**File:** `src/lib/sync/watermark.ts`

- **What:** Replaced ASCII-only allowlist regex `SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/` with denylist regex `UNSAFE_IDENTIFIER_CHARS = /[;"'\`\\\/\*\-\s\n\r]/`. Updated the `quoteIdentifier()` function to reject empty strings or strings containing unsafe characters.
- **Why:** The allowlist rejected valid non-ASCII column names (accented characters like `"Descripcion"`, CJK characters like `"売上数量"`). Since the column is double-quoted in the output SQL, only injection characters (quotes, semicolons, comments, whitespace) need to be blocked.

---

## Commit 16: `c507e59` — fix: replace regex-based floatSafeJsonLine with replacer to prevent string corruption
**Severity:** Medium
**File:** `src/lib/providers/bigquery.provider.ts`

- **What:** Replaced the regex approach (`json.replace(/(?<=[:,\[])(-?\d+)(?=[,}\]])/g, "$1.0")`) with a `JSON.stringify` replacer that tags integers with `__FLOAT__` sentinels, followed by a post-processing regex to convert them to floats.
- **Why:** The old regex matched number-like substrings inside string values. For example, a string `"1,2,3"` would become `"1,2.0,3"` because `2` was preceded by `,` and followed by `,`. The replacer approach only tags actual `typeof value === "number"` values.

---

## Commit 17: `44b8bca` — fix: use schedule timezone for report email dates and filenames
**Severity:** Medium
**File:** `src/lib/report-runner.ts`

- **What:** Replaced `format(now, ...)` (date-fns, server timezone) with `formatInTimeZone(now, tz, ...)` (date-fns-tz, schedule timezone) for: `reportDate`, `filename` date suffix, `nextScheduleStr`, and `executionDate`. Added `import { formatInTimeZone } from "date-fns-tz"`.
- **Why:** All date formatting in report emails used the server's local timezone (likely UTC in production) instead of the schedule's configured timezone (e.g., `"America/Chicago"`). A report scheduled for 7am CST would show the date as the next day if the server was UTC and the report ran after midnight UTC.

---

## Commit 18: `1c9cc73` — fix: handle Date objects and invalid strings in watermark extraction
**Severity:** Medium
**File:** `src/lib/sync/watermark.ts`

- **What:** Rewrote the `timestamp_cursor` branch of `extractNewWatermark()` to handle `Date` objects (via `instanceof Date` check) and string timestamps uniformly. Creates Date objects, filters out `NaN` results, then reduces to find max.
- **Why:** Database drivers (pg, mysql2) return `Date` objects, not strings. The old code cast values to `string` (`as string`) and called `new Date(stringValue)`, which works for actual strings but is semantically wrong for Date objects. Also, invalid date strings would silently produce `Invalid Date` without filtering.

---

## Commit 19: `592ce6a` — fix: add 10-min timeout to BigQuery extract query jobs
**Severity:** Medium
**File:** `src/lib/providers/bigquery.provider.ts`

- **What:** Added `EXTRACT_JOB_TIMEOUT_MS = 10 * 60_000` constant and `jobTimeoutMs: String(EXTRACT_JOB_TIMEOUT_MS)` to the `createQueryJob()` config in `extract()`.
- **Why:** The `query()` method already had `jobTimeoutMs` but `extract()` did not. Extract queries could run indefinitely, blocking the worker. BigQuery charges by bytes scanned regardless of timeout, so this doesn't waste money — it just prevents hung workers.

---

## Commit 20: `81eff1d` — fix: remove duplicate stale-log cleanup from engine (worker handles it)
**Severity:** Low
**Files:** `src/lib/bifrost/engine.ts`, `src/__tests__/bifrost/bifrost-engine.test.ts`

- **What (engine.ts):** Removed the `prisma.routeLog.updateMany()` block that marked stale "running" logs as "failed" at the start of every `execute()` call.
- **What (test):** Removed the corresponding test case and replaced with a comment noting that cleanup lives in worker.ts.
- **Why:** The worker already performs this exact cleanup at startup (lines 39-52). Running it on every route execution was redundant and added an unnecessary DB query to every Bifrost run.

---

## Commit 21: `d4d4510` — fix: preserve non-ASCII characters in report filenames
**Severity:** Low
**File:** `src/lib/report-runner.ts`

- **What:** Changed filename sanitization regex from `/[^a-zA-Z0-9-_ ]/g` (strip everything except ASCII alphanumeric, dash, underscore, space) to `/[\/\\:*?"<>|]/g` (strip only filesystem-unsafe characters).
- **Why:** The old regex stripped all non-ASCII characters. A report named `"Informe Financiero"` would keep its name, but `"Informe Financiero — Q1"` would lose the em dash, and `"売上レポート"` would become an empty string.

---

## Commit 22: `dc0231d` — fix(security): stop returning decrypted SFTP password in GET response
**Severity:** Low
**File:** `src/app/api/sftp-connections/[id]/route.ts`

- **What:** Removed the `decrypt(connection.sftpPassword)` call and the password field from the GET response. Replaced with `const { sftpPassword: _omit, ...safe } = connection`. Removed unused `import { decrypt } from "@/lib/crypto"`.
- **Why:** The GET endpoint decrypted and returned the raw SFTP password on every request. The password is only needed once (shown to the user on creation via the POST response). The sftp-watcher reads passwords directly from the database, not via the API.

---

## Commit 23: `9204b75` — fix: log warning when credentials fall back to plaintext parsing
**Severity:** Low
**File:** `src/lib/providers/helpers.ts`

- **What:** Added `console.warn()` when credentials are parsed as plaintext JSON (decrypt failed but JSON.parse succeeded), and `console.error()` when credentials are neither encrypted nor valid JSON.
- **Why:** The plaintext fallback was completely silent. If unencrypted credentials ended up in the database (e.g., from a migration bug), there was no way to detect it. The warning makes this visible in logs without breaking functionality.

---

## Commit 24: `fc2da6e` — fix: use async gzip in Helheim dead-letter to avoid blocking event loop
**Severity:** Low
**Files:** `src/lib/bifrost/helheim/dead-letter.ts`, `src/lib/worker.ts`, `src/app/api/bifrost/helheim/[id]/retry/route.ts`, `src/__tests__/bifrost/helheim.test.ts`

- **What (dead-letter.ts):** Replaced `gzipSync`/`gunzipSync` with `promisify(gzip)`/`promisify(gunzip)`. Changed `compressPayload` and `decompressPayload` signatures from sync to async (return `Promise`).
- **What (worker.ts):** Added `await` to `decompressPayload()` call.
- **What (retry/route.ts):** Added `await` to `decompressPayload()` call.
- **What (helheim.test.ts):** Updated all test cases to use `async`/`await` for compress/decompress calls.
- **Why:** Synchronous gzip blocks the Node.js event loop. For large payloads (thousands of rows), this could freeze the worker for hundreds of milliseconds, delaying other job processing and health checks.

---

## Commit 25: `940414f` — fix: sanitize worker error logging to prevent credential leaks
**Severity:** Low
**File:** `src/lib/worker.ts`

- **What:** Added `safeErrorMessage()` helper that extracts `error.message` for Error objects or `String(error)` for others. Replaced all `console.error(err)` and `console.error("...", error)` calls with `console.error("...", safeErrorMessage(err))`.
- **Why:** Raw error objects logged via `console.error(err)` include the full stack trace. Database driver errors can contain connection strings with passwords in their message or stack. Logging only the message string reduces the risk of credential exposure in log aggregators.

---

## Commit 26: `4e9cd85` — fix: replace nuclear schema cache clear with targeted invalidation
**Severity:** Low
**Files:** `src/lib/bifrost/engine.ts`, `src/__tests__/bifrost/bifrost-engine.test.ts`

- **What (engine.ts):** Replaced `clearSchemaCache()` (which wiped ALL cached BigQuery schemas) with a targeted `invalidateSchema(projectId, dataset, table)` call that only removes the specific failing table's cache entry. Uses `"invalidateSchema" in destProvider` runtime check since only BigQueryProvider has this method.
- **What (test):** Updated test to check `enqueueDeadLetter` was called instead of `clearSchemaCache`. Removed the `clearSchemaCache` mock and import.
- **Why:** On a fatal load error (e.g., missing dataset), the engine was clearing schemas for ALL tables across ALL routes. This forced unnecessary schema re-fetches on the next run of unrelated routes. With `teamSize: 2` in the worker, two concurrent routes could invalidate each other's caches repeatedly.

---

## Commit 27: `1ff1e65` — refactor: simplify review — extract shared utils, add indexes, fix types
**Severity:** N/A (code quality)
**Files:** `src/lib/async-utils.ts` (new), `src/lib/worker.ts`, `src/lib/bifrost/jobs/route-job.handler.ts`, `src/app/api/bifrost/routes/[id]/run/route.ts`, `src/lib/bifrost/types.ts`, `prisma/schema.prisma`, `src/lib/report-runner.ts`

- **What (async-utils.ts):** New shared module with `withTimeout()` and `safeErrorMessage()`.
- **What (worker.ts):** Replaced inline `withTimeout` and `safeErrorMessage` definitions with imports from `async-utils.ts`.
- **What (route-job.handler.ts):** Replaced 20-line inline Promise.race+setTimeout+clearTimeout with `withTimeout()` one-liner.
- **What (run/route.ts):** Same replacement — 15-line inline timeout collapsed to `withTimeout()` one-liner.
- **What (types.ts):** Added `"skipped"` to `RouteJobResult.status` union type (was `"completed" | "partial" | "failed"`, now includes `"skipped"`).
- **What (schema.prisma):** Added 7 database indexes: `BifrostRoute(sourceId)`, `BifrostRoute(destId)`, `RouteLog(routeId, status)`, `RunLog(reportId, status)`, `HelheimEntry(status, nextRetryAt)`, `HelheimEntry(status, lastRetriedAt)`.
- **What (report-runner.ts):** Removed unused `import { format } from "date-fns"` (dead import after commit 17 switched to `formatInTimeZone`).
- **Why:** Post-fix code review identified: (1) `withTimeout` pattern duplicated in 3 files, (2) `safeErrorMessage` duplicated in 14+ places, (3) `"skipped"` status was a type violation, (4) several hot-path queries lacked database indexes, (5) dead import.

---

## Files Changed Summary

| File | Commits |
|------|---------|
| `prisma/schema.prisma` | 3, 12, 27 |
| `src/lib/worker.ts` | 2, 7, 12, 13, 24, 25, 27 |
| `src/lib/providers/netsuite.provider.ts` | 1, 5, 10 |
| `src/lib/report-runner.ts` | 2, 17, 21, 27 |
| `src/lib/bifrost/engine.ts` | 12, 20, 26 |
| `src/lib/providers/bigquery.provider.ts` | 16, 19 |
| `src/lib/sync/watermark.ts` | 15, 18 |
| `src/lib/bifrost/helheim/dead-letter.ts` | 8, 24 |
| `src/__tests__/bifrost/bifrost-engine.test.ts` | 20, 26 |
| `src/app/api/bifrost/routes/[id]/run/route.ts` | 7, 27 |
| `src/lib/async-utils.ts` | 27 (new) |
| `src/lib/bifrost/jobs/route-job.handler.ts` | 14 (new), 27 |
| `src/lib/bifrost/types.ts` | 27 |
| `src/lib/api.ts` | 6 |
| `src/lib/validations/bifrost.ts` | 4 |
| `src/lib/schedule-utils.ts` | 9 |
| `src/lib/providers/helpers.ts` | 23 |
| `src/lib/providers/postgres.provider.ts` | 11 |
| `src/lib/providers/mssql.provider.ts` | 11 |
| `src/lib/providers/mysql.provider.ts` | 11 |
| `src/app/api/connections/[id]/route.ts` | 3 |
| `src/app/api/sftp-connections/[id]/route.ts` | 22 |
| `src/app/api/bifrost/netsuite/fields/route.ts` | 10 |
| `src/app/api/bifrost/helheim/[id]/retry/route.ts` | 24 |
| `src/__tests__/bifrost/helheim.test.ts` | 24 |

## Test Results

- **755 tests passing** across 35 test files
- **4 pre-existing failures** in `netsuite-provider.test.ts` (from other uncommitted changes, not introduced by these fixes)
- **1 test removed** (stale-log cleanup test, commit 20 — functionality moved to worker)
