# Hermod Code Scrub

Audit date: 2026-05-03

Scope: audit-only pass against the local checkout of `Wampafan1/Hermod`. I did not implement feature fixes or broad rewrites. The working tree was already dirty before this audit. I removed only the generated `.next` directory once to confirm the production build failure was not stale build output.

## Executive Summary

- Overall risk level: CRITICAL
- Top 5 issues:
  1. Any authenticated user can mutate the global Alfheim API catalog, then trigger a server-side `fetch()` from catalog test routes without the SSRF guard.
  2. Tenant isolation is still incomplete across credential-adjacent, schedule, history, Helheim, and Mjolnir routes. Several create routes also omit `tenantId`.
  3. `npm run build` currently fails in Next standalone packaging after static generation.
  4. PostgreSQL backup uploads can be orphaned if manifest upload fails, leaving failed runs with no object keys even though backup artifacts exist.
  5. Raven/Data Agent Bifrost resume does not apply or advance incremental watermarks, making repeated extraction likely for incremental agent-backed routes.
- Build/test status:
  - `npx prisma validate`: PASS.
  - `npx prisma generate`: PASS.
  - `npm run build`: FAIL.
  - `npm run test`: PASS, 63 files and 1005 tests.
  - `npm run lint`: DID NOT RUN; `next lint` opened the first-time ESLint configuration prompt and exited.
- Credentials or tenant isolation at risk: YES. Tenant-scoped resources are often filtered only by `userId`; some of those paths decrypt saved credentials, return Helheim payload previews, expose recipient emails, or send email through saved SMTP credentials.

## P0 Critical Issues

### P0-1. Authenticated Alfheim catalog mutation plus unguarded catalog test fetch enables SSRF and global catalog poisoning

- File: `src/app/api/alfheim/catalog/route.ts`
- Function/component: `POST /api/alfheim/catalog`
- Evidence: `POST` is wrapped only in `withAuth` and writes directly to the shared `apiCatalogConnector` table at lines 71-93. It records `createdBy: session.user.id`, but has no tenant, role, or platform-admin check.
- File: `src/app/api/alfheim/catalog/[slug]/route.ts`
- Function/component: `PUT` and `DELETE /api/alfheim/catalog/[slug]`
- Evidence: `PUT` and `DELETE` are also only `withAuth`; they update/delete by global `slug` at lines 27-66 and 69-82.
- File: `src/lib/validations/alfheim.ts`
- Function/component: `createCatalogConnectorSchema`
- Evidence: `baseUrl` is only `z.string().min(1)` at line 25, not a URL validator and not restricted to public hosts.
- File: `src/app/api/alfheim/catalog/[slug]/test/route.ts`
- Function/component: `POST /api/alfheim/catalog/[slug]/test`
- Evidence: lines 75-86 substitute request credentials into `connector.baseUrl` and build `testUrl`; line 166 calls raw `fetch(finalTestUrl, fetchInit)` instead of `fetchWithSsrfProtection`.
- Impact: Any authenticated user can create or edit a catalog connector pointing at internal services or corrupt a connector used by other tenants. The test route can then make the server call that URL with attacker-controlled headers/body fields. This is both SSRF and shared catalog integrity risk.
- Reproduction or reasoning: Create a catalog connector with a private `baseUrl` such as `http://127.0.0.1:...`, then call the catalog test endpoint. The route uses raw `fetch()` and does not call `src/lib/ssrf.ts`.
- Minimal fix plan: Restrict catalog mutation to an explicit platform-admin path or make catalog rows tenant-scoped. Validate `baseUrl` as `http`/`https` and reject private/reserved destinations. Replace raw `fetch()` in the test route with `fetchWithSsrfProtection`. Audit existing catalog rows created by non-admin users.
- Whether fix is safe to automate: Partially. The `fetchWithSsrfProtection` replacement is safe and small; access-control policy for global catalog ownership needs product confirmation.

### P0-2. Tenant isolation is incomplete across credential-adjacent and data-bearing APIs

- File: `src/app/api/connections/[id]/test/route.ts`
- Function/component: saved connection test
- Evidence: line 14 filters `where: { id, userId: session.user.id }` without `tenantId`; line 21 decrypts the saved connection via `toConnectionLike(connection)`.
- File: `src/app/api/connections/[id]/postgres/databases/route.ts` and `src/app/api/connections/[id]/mssql/databases/route.ts`
- Function/component: database discovery
- Evidence: Postgres line 22 and MSSQL line 32 filter by `id` and `userId` only; both select `credentials: true` at Postgres line 27 and MSSQL line 37 before opening provider connections.
- File: `src/app/api/bifrost/providers/schema/route.ts`
- Function/component: schema inspection
- Evidence: line 20 filters connection lookup by `id` and `userId` only, then line 26 decrypts credentials.
- File: `src/app/api/email-connections/route.ts` and `src/app/api/email-connections/[id]/route.ts`
- Function/component: SMTP connection CRUD
- Evidence: list/create omit tenant scope at lines 9-12 and 41-52. Update/delete use only `id` and `userId` at `[id]/route.ts` lines 14-15 and 73-74. Delete counts all schedules by `emailConnectionId` at lines 80-83 without tenant or user scope.
- File: `src/app/api/sftp-connections/[id]/route.ts` and `src/app/api/sftp-connections/[id]/test/route.ts`
- Function/component: SFTP connection read/update/delete/test
- Evidence: lookups filter only by `id` and `userId` at `[id]/route.ts` lines 14-15, 33-34, 94-95 and test route lines 13-14.
- File: `src/app/api/schedules/recipient-suggestions/route.ts`
- Function/component: recipient autocomplete
- Evidence: line 27 scopes recipients by `schedule.report.userId` only; line 34 returns prior recipient email addresses.
- File: `src/app/api/bifrost/helheim/[id]/route.ts`
- Function/component: Helheim detail and kill
- Evidence: GET filters by `id` and `route.userId` only at lines 10-17, then returns `errorDetails` and `payloadPreview` at lines 34-50. PATCH uses the same user-only route scope at lines 64-65.
- File: `prisma/schema.prisma`
- Function/component: tenant-scoped models
- Evidence: tenant IDs are nullable on SFTP connections at lines 192-195, email connections at lines 247-250, reports at lines 272-275, unified connections at lines 521-524, Bifrost routes at lines 968-971, and Helheim entries at line 1021.
- Impact: A user who belongs to multiple tenants can operate on resources outside the active tenant if they know or retain IDs. Affected paths can use saved DB/SMTP/SFTP credentials, return tenant data, leak recipient emails, or expose dead-letter payload samples.
- Reproduction or reasoning: The main `/api/connections` route correctly scopes by `userId` and `tenantId` at `src/app/api/connections/route.ts` lines 10-12 and writes `tenantId` at lines 47-50. The routes above diverge from that pattern.
- Minimal fix plan: For every tenant-owned lookup, add `tenantId: session.tenantId` in addition to `userId`. Write `tenantId` on create for email/SFTP/schedule-adjacent records. Backfill nullable tenant IDs before considering non-null constraints. Add API tests where the same user has two tenants and an ID from the inactive tenant.
- Whether fix is safe to automate: Partially. Many query edits are mechanical, but nullable historical data needs a migration/backfill plan.

### P0-3. Production build is broken in standalone packaging

- File: `next.config.js`
- Function/component: Next config
- Evidence: line 3 sets `output: "standalone"`.
- File: `src/middleware.ts`
- Function/component: middleware
- Evidence: middleware exists at lines 1-20, but the standalone copy phase fails looking for `.next\server\src\middleware.js`.
- Build evidence: `npm run build` first failed with `ENOENT: no such file or directory, open 'C:\Users\JDelg\Hermod\.next\server\app\_not-found\page.js.nft.json'`. After deleting only generated `.next`, rerun failed with `unhandledRejection Error: ENOENT: no such file or directory, copyfile 'C:\Users\JDelg\Hermod\.next\server\src\middleware.js' -> 'C:\Users\JDelg\Hermod\.next\standalone\.next\server\src\middleware.js'`.
- Impact: Production deploy artifacts cannot be produced reliably. This is a release blocker regardless of test status.
- Reproduction or reasoning: The failure reproduced after generated output cleanup, so it is not just stale `.next` from an earlier build.
- Minimal fix plan: Reproduce in a clean checkout and inspect Next 14.2 standalone tracing for middleware under `src/`. Check whether a Next upgrade, middleware path/output change, or standalone setting is required. Keep this as a build-system fix, not a source cleanup pass.
- Whether fix is safe to automate: No. The root cause is in build packaging and needs targeted diagnosis.

### P0-4. PostgreSQL backup artifacts can be uploaded but recorded as failed with empty object keys

- File: `src/lib/backups/postgres/postgres-backup-engine.ts`
- Function/component: `PostgresBackupEngine.runFullBackup`
- Evidence: full backup upload and manifest creation happen at lines 343-407, but `checksums.push(...)` and `objectKeys.push(...)` happen only after manifest upload at lines 410-418. If manifest upload throws, the catch at lines 419-425 treats the database as failed. If no object keys were recorded, lines 428-429 throw, and the outer catch records a failed run with `objectKeys: []`, `bytesWritten: 0`, and `checksumSha256: null` at lines 472-487.
- File: `src/lib/backups/postgres/postgres-backup-engine.ts`
- Function/component: `PostgresBackupEngine.runWalArchive`
- Evidence: WAL file uploads and `objectKeys.push(...)` happen at lines 580-609, but manifest upload is outside that per-file catch at lines 651-660. If manifest upload fails, the outer catch records `objectKeys: []`, `bytesWritten: 0`, and `checksumSha256: null` at lines 708-725.
- Impact: Storage can contain valid backup artifacts that the database no longer knows how to restore or retain. That is recovery data loss from the application point of view, and it can also leave untracked storage costs.
- Reproduction or reasoning: Simulate storage success for the dump/WAL file and failure for the manifest upload. The code paths above do not persist the already-uploaded artifact key before the manifest step fails.
- Minimal fix plan: Record primary artifact keys and bytes immediately after artifact upload, before manifest upload. Treat manifest upload as a separate artifact failure or attempt cleanup. Add tests that fail only manifest upload for full and WAL backups.
- Whether fix is safe to automate: Partially. The logic is local, but recovery semantics for partial manifest failure should be explicit.

## P1 High Issues

### P1-1. Raven/Data Agent Bifrost resume does not apply or advance incremental watermarks

- File: `src/lib/bifrost/engine.ts`
- Function/component: normal Bifrost execution and Raven job creation
- Evidence: normal execution reads watermarks and builds incremental clauses at lines 296-307, then writes watermarks and `lastCheckpoint` after successful loads at lines 824-842. The Raven branch creates a job with raw `route.sourceConfig.query` and `route.sourceConfig.params` at lines 999-1011, with no equivalent watermark handling.
- File: `src/lib/bifrost/jobs/raven-resume.handler.ts`
- Function/component: Raven resume handler
- Evidence: the resume handler loads batches at lines 129-168, finalizes the route log at lines 182-192, and deletes chunks at line 194. It never calls `setWatermark` and never updates `bifrostRoute.lastCheckpoint`.
- Impact: Incremental Data Agent routes can repeatedly extract the same window or fail to advance cursor state after successful cloud-side load. Depending on destination mode, this can duplicate rows or keep queues permanently behind.
- Reproduction or reasoning: Compare direct Bifrost route execution with Raven execution. Only the direct path has cursor read/write logic.
- Minimal fix plan: Apply the same cursor construction before creating a Raven job, include resolved parameters in the job payload, and advance the watermark/lastCheckpoint after successful resume load. Add an agent-backed incremental route test.
- Whether fix is safe to automate: No. Needs agreement on whether cursor filtering is performed by Hermod before dispatch or by Raven from explicit job fields.

### P1-2. MySQL Bifrost destination load builds parameter values but never passes them

- File: `src/lib/providers/mysql.provider.ts`
- Function/component: `MysqlProvider.load`
- Evidence: lines 223-232 build `values` and placeholder groups, but the `execute` call at lines 236-239 passes only `{ sql, timeout }`; `values` is unused.
- Impact: Any MySQL destination load with rows will execute an `INSERT ... VALUES (?, ?)` statement without bound parameters and fail at runtime. This breaks MySQL as a Bifrost destination.
- Reproduction or reasoning: The local test suite covers MySQL provider basics, but it does not assert `load()` passes values to mysql2. The code path is plainly missing the parameter array/options field.
- Minimal fix plan: Update the `MysqlPoolConnection.execute` type to accept values and pass the `values` array in the bulk insert call. Add a unit test for `load()` that asserts placeholders and values are sent together.
- Whether fix is safe to automate: Yes.

### P1-3. SSRF helper misses IPv4-mapped IPv6 and has DNS time-of-check/time-of-use exposure

- File: `src/lib/ssrf.ts`
- Function/component: `checkSsrf` and `fetchWithSsrfProtection`
- Evidence: `isPrivateIPv6` only checks `::1`, `fc`, `fd`, and `fe80` at lines 32-38. `checkSsrf` returns `null` for any other IPv6 literal at lines 56-60, so addresses such as `[::ffff:127.0.0.1]` are not reduced to IPv4 and checked by `isPrivateIPv4`. `fetchWithSsrfProtection` checks the URL before calling normal `fetch()` at lines 102-111, so DNS is resolved again during the actual request.
- Impact: REST API connections and Alfheim discovery code that do use the helper can still be pointed at private services via IPv4-mapped IPv6 or DNS rebinding.
- Reproduction or reasoning: `net.isIP("::ffff:127.0.0.1")` is an IPv6 address, so this code takes the IPv6 branch and does not run the IPv4 private range checks.
- Minimal fix plan: Normalize IPv4-mapped IPv6 before checks, cover additional reserved ranges, and add tests for literal IPs and redirects. Consider a custom lookup/agent path that connects to the verified IP rather than re-resolving.
- Whether fix is safe to automate: Yes for the literal-IP tests and normalization; the DNS rebinding mitigation needs a slightly larger design.

### P1-4. PostgreSQL PITR restore can look in the wrong WAL prefix

- File: `src/lib/backups/postgres/postgres-backup-engine.ts`
- Function/component: backup storage prefix resolution
- Evidence: `storagePrefixFromPolicy` falls back from `policy.storagePrefix` to the storage target config at lines 197-199 and is used for backup object keys at lines 311-314 and WAL keys at line 563.
- File: `src/lib/backups/postgres/postgres-restore-engine.ts`
- Function/component: `preparePhysicalPitr`
- Evidence: restore uses only `restoreJob.policy.storagePrefix` at line 351, then builds the WAL prefix at line 353.
- File: `src/lib/backups/retention.ts`
- Function/component: retention prefix resolution
- Evidence: retention has its own fallback helper at lines 25-30 and uses it for WAL retention at lines 60-68.
- Impact: If a policy relies on the storage target's default prefix, backups and retention use that prefix, but PITR restore manifest generation may search/list a different WAL prefix and miss required WAL files.
- Reproduction or reasoning: Configure `policy.storagePrefix = null` and a storage target config prefix. Backup/WAL key generation uses the target prefix; restore does not.
- Minimal fix plan: Move prefix fallback logic to one shared helper and use it in backup, restore, and retention. Add a PITR manifest test for target-level prefix fallback.
- Whether fix is safe to automate: Yes.

### P1-5. Deleting a backup storage target ignores SQL Server backup policies

- File: `prisma/schema.prisma`
- Function/component: storage target relations
- Evidence: `BackupStorageTarget` has both `policies PostgresBackupPolicy[]` and `mssqlPolicies MssqlBackupPolicy[]` at lines 649-650. `MssqlBackupPolicy.storageTargetId` is nullable with `onDelete: SetNull` at lines 784-785.
- File: `src/app/api/backups/storage-targets/[id]/route.ts`
- Function/component: `DELETE /api/backups/storage-targets/[id]`
- Evidence: delete protection counts only `postgresBackupPolicy` at lines 101-112, force-delete only deletes disabled Postgres policies at lines 124-127, then deletes the storage target at lines 127 and 132.
- Impact: A target used by SQL Server backup policies can be deleted without the API warning or blocking. Prisma will null out `storageTargetId`, leaving MSSQL policies configured in the UI but unable to upload to the intended target.
- Reproduction or reasoning: The relation exists in schema but no MSSQL policy count appears in the delete route.
- Minimal fix plan: Count active and total MSSQL policies alongside Postgres policies. Block deletion when any enabled policy references the target; define force behavior for disabled MSSQL policies.
- Whether fix is safe to automate: Yes.

### P1-6. Report execution still loads unbounded query results before truncation

- File: `src/lib/report-runner.ts`
- Function/component: `executeReportPipeline`
- Evidence: line 118 calls `provider.query(conn, input.sqlQuery)` and materializes all rows. The 500,000 row limit is enforced only afterward at lines 125-127 by slicing the already-loaded array.
- File: `src/app/api/reports/[id]/run/route.ts`
- Function/component: manual report run
- Evidence: line 33 calls `provider.query(conn, report.sqlQuery)` and returns rows without the preview limit used by `src/app/api/query/execute/route.ts`.
- Impact: A large report can exhaust server memory or produce huge responses before Hermod has a chance to truncate. Scheduled emails and manual runs are both exposed.
- Reproduction or reasoning: The limit check occurs after provider query completion, so memory use is proportional to the full result set, not the limit.
- Minimal fix plan: Add streaming or provider-level row caps for report generation. For interactive manual runs, use the same preview cap semantics as query preview. Add stress tests using mocked large providers.
- Whether fix is safe to automate: No. Needs a provider contract decision.

## P2 Medium Issues

### P2-1. New backup `storageLayout` fields are in schema but not in API validation or persistence

- File: `prisma/schema.prisma`
- Function/component: backup policy models
- Evidence: `PostgresBackupPolicy.storageLayout` exists at line 681 and `MssqlBackupPolicy.storageLayout` exists at line 817.
- File: `src/lib/validations/backups.ts`
- Function/component: Postgres backup validation
- Evidence: create/update schemas at lines 48-58 and 97-108 include `storagePrefix` and target fields but no `storageLayout`.
- File: `src/lib/validations/mssql-backups.ts`
- Function/component: MSSQL backup validation
- Evidence: base schema starts at line 22 and has no `storageLayout`.
- File: `src/app/api/backups/policies/route.ts` and `src/app/api/backups/mssql/policies/route.ts`
- Function/component: backup policy create
- Evidence: Postgres create data begins at lines 125-130 and MSSQL create data begins at lines 76-82; neither persists `storageLayout`.
- Impact: UI selections for storage layout can be silently stripped by Zod and the database default will always win. This is a correctness bug in recently changed backup layout work.
- Reproduction or reasoning: Zod object schemas strip unknown keys by default, so a `storageLayout` request property is ignored.
- Minimal fix plan: Add a shared storage-layout enum validator, persist the field in Postgres and MSSQL create/update routes, and add request tests.
- Whether fix is safe to automate: Yes.

### P2-2. `withAuth` discards App Router route params, encouraging fragile URL parsing

- File: `src/lib/api.ts`
- Function/component: `withAuth`
- Evidence: `withAuth` accepts `routeContext?: unknown` at line 30 but calls `handler(req, ctx)` at line 51. `AuthHandler` has no route-context parameter at lines 21-24.
- File examples: `src/app/api/connections/[id]/test/route.ts` parses `req.url.split("/connections/")` at line 8; `src/app/api/bifrost/helheim/[id]/route.ts` parses `req.url.split("/helheim/")` at line 8; `src/app/api/blueprints/[routeId]/versions/[version]/route.ts` parses URL parts at lines 7 and 69.
- Impact: Dynamic routes duplicate brittle parsing logic and are vulnerable to encoded-path and route-shape changes. It also makes tests noisier.
- Minimal fix plan: Extend `withAuth` to pass route params as a third argument or wrap `{ auth, params }` cleanly, then migrate dynamic routes incrementally.
- Whether fix is safe to automate: Partially. The wrapper change is small; route migration should be staged.

### P2-3. Lint script is not CI-ready

- File: `package.json`
- Function/component: scripts
- Evidence: `npm run lint` maps to `next lint` at line 14.
- Diagnostic evidence: Running `npm run lint` opened the prompt `How would you like to configure ESLint? Strict (recommended) / Base / Cancel` and exited with code 1.
- Impact: Lint cannot be used as a non-interactive quality gate. A CI job would fail or hang depending on terminal behavior.
- Minimal fix plan: Add an explicit ESLint config compatible with Next 14 or replace the script with a configured lint command. Re-run in CI-like non-interactive mode.
- Whether fix is safe to automate: Yes, but only after choosing Strict or Base.

### P2-4. Helheim stores and returns raw error details and payload previews

- File: `src/lib/bifrost/helheim/dead-letter.ts`
- Function/component: dead-letter enqueue
- Evidence: `errorMessage` and `errorDetails` are stored at lines 80-83; stack snippets are captured at lines 195-197.
- File: `src/app/api/bifrost/helheim/[id]/route.ts`
- Function/component: Helheim detail API
- Evidence: the route returns `errorDetails` and up to 10 decompressed rows in `payloadPreview` at lines 24-50.
- Impact: This is useful for debugging, but if provider errors contain SQL text, API responses, or secrets, the UI can expose them. Combined with the tenant-scope gap above, the blast radius is larger.
- Minimal fix plan: Redact known credential patterns before storing error details, cap payload fields, and require tenant scope before returning previews.
- Whether fix is safe to automate: Partially.

## P3 Low Issues

### P3-1. Plaintext credential fallback can mask unsafe test data outside production

- File: `src/lib/providers/helpers.ts`
- Function/component: `toConnectionLike`
- Evidence: if decrypt fails, non-production falls back to `JSON.parse(connection.credentials)` at lines 19-31. The guard allows fallback whenever `NODE_ENV !== "production"` at lines 40-42.
- Impact: This is intentional for unsaved/test connections, but it can hide accidental plaintext credential persistence during development and tests.
- Minimal fix plan: Keep the fallback only for explicit test objects or require `HERMOD_ALLOW_PLAINTEXT_CREDENTIALS=true` even in development.
- Whether fix is safe to automate: No. It may break existing test helpers.

### P3-2. Provider and worker logs are noisy and sometimes include route names, endpoints, and query paths

- File examples: `src/lib/bifrost/engine.ts`
- Evidence: REST route logging includes catalog/object/endpoints at lines 387, 397, 414, and 420. Worker logs route/report IDs and names throughout `src/lib/worker.ts`, for example lines 168, 230, 265, and 362.
- Impact: I did not find decrypted credentials being logged in these paths, but logs may still disclose customer route names, API endpoints, and object names.
- Minimal fix plan: Keep operational IDs, reduce customer data in logs, and use structured redaction helpers for provider error logging.
- Whether fix is safe to automate: Partially.

## Build/Test Results

- `npm install`: not run; dependencies were already present and commands were available.
- `npx prisma validate`: PASS. Output included `The schema at prisma\schema.prisma is valid`.
- `npx prisma generate`: PASS. Output included `Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 928ms`.
- `npm run build`: FAIL.
  - First run failed after compile/type/static generation with: `Error: ENOENT: no such file or directory, open 'C:\Users\JDelg\Hermod\.next\server\app\_not-found\page.js.nft.json'`.
  - I deleted only generated `.next` output and reran.
  - Second run failed after compile/type/static generation with: `unhandledRejection Error: ENOENT: no such file or directory, copyfile 'C:\Users\JDelg\Hermod\.next\server\src\middleware.js' -> 'C:\Users\JDelg\Hermod\.next\standalone\.next\server\src\middleware.js'`.
- `npm run test`: PASS. Vitest reported `63 passed (63)` test files and `1005 passed (1005)` tests in 6.08s.
- `npm run lint`: FAIL/NOT EXECUTED. `next lint` prompted for initial ESLint configuration with `Strict`, `Base`, and `Cancel` choices, then exited code 1.

## Suggested Fix Order

1. Lock down Alfheim catalog mutation and replace catalog test raw `fetch()` with SSRF-protected fetch.
2. Patch tenant filters on credential-adjacent routes first: saved connection test, DB discovery, provider schema, email connections, SFTP connections, schedules, recipient suggestions, Helheim, and blueprint/version APIs.
3. Fix the production build failure in a clean checkout and preserve the exact repro in CI.
4. Repair PostgreSQL backup artifact/manifest failure handling and add manifest-failure tests.
5. Fix MySQL provider `load()` parameter binding.
6. Fix backup storage target deletion to include MSSQL policies.
7. Share backup storage-prefix resolution between backup, retention, and restore.
8. Decide the Raven incremental cursor contract, then update job creation and resume handling.
9. Add API tests for active-tenant isolation across routes where the same user belongs to multiple tenants.
10. Make lint non-interactive and wire build, lint, Prisma validate/generate, and tests into CI.

## Do Not Touch Yet

- Do not make tenant IDs non-null until nullable rows are backfilled and migration impact is reviewed.
- Do not run `prisma db push`; schema changes here require migration review.
- Do not broadly rewrite provider interfaces just to fix MySQL. Make the smallest parameter-binding patch first.
- Do not change Raven/Data Agent resume semantics until the cursor owner is decided.
- Do not delete or rewrite backup storage layout migrations until the intended UI/API contract is confirmed.
- Do not clean up the large dirty working tree as part of this audit; many modified files predate this pass.
