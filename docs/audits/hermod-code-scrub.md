# Hermod Code Scrub

Audit date: 2026-05-03

Scope: audit-only pass against the local checkout of `Wampafan1/Hermod`. I did not implement feature fixes or broad rewrites. The working tree was already heavily dirty before the audit, including the new backup/MSSQL backup surface, so findings below describe the current local code rather than a clean `origin/master` baseline.

## Executive Summary

- Overall risk level: CRITICAL
- Top 5 issues:
  1. Tenant isolation is incomplete: many core APIs still scope by `userId` only and several create routes do not write `tenantId`.
  2. Authenticated SSRF is possible through API discovery and REST API test/discovery flows.
  3. Bifrost full reload can drop the destination table before extraction/load succeeds.
  4. Retry/resume paths can cause data loss: Helheim manual retry can reuse `WRITE_TRUNCATE`, and Raven resume deletes chunks before downstream load succeeds.
  5. Gate push SQL generation concatenates unescaped identifiers and raw SQL literals for destination writes.
- Build/test status:
  - `npx prisma validate`: PASS.
  - `npx prisma generate`: FAIL, Windows `EPERM` rename of Prisma query engine DLL.
  - `npm run build`: PASS on rerun after the user's parallel build finished.
  - `npm run test`: PASS, 55 test files and 972 tests.
  - `npm run lint`: FAIL, `next lint` prompts for interactive ESLint setup.
- Credentials or tenant isolation appear at risk:
  - Tenant isolation: YES. `withAuth` guarantees `tenantId` (`src/lib/api.ts:35-48`), but many business routes ignore it.
  - Credentials: direct connection credential responses are mostly excluded from `select`s, but REST provider logs full URLs and auth failure bodies (`src/lib/providers/rest-api.provider.ts:127-131`, `src/lib/providers/rest-api.provider.ts:320`), plaintext credential fallback is accepted (`src/lib/providers/helpers.ts:16-25`), and unsaved REST targets bypass SSRF checks.
- Auth wrapper status: I did not find an obvious unauthenticated business API route in the inventory sweep. Human routes generally use `withAuth`; Raven agent routes use `withRavenAuth` (`src/lib/raven/auth.ts:25-86`); public/session exceptions are intentional-looking. The high-risk auth problem is scoping, not total absence of authentication.
- Recent-change context: `git status` showed 56 modified tracked files plus many untracked backup-related files/directories. An initial build attempt failed while another build was running, but a rerun after that process finished passed.

## P0 Critical Issues

### P0-1 Tenant isolation is incomplete across core resources

- File: `src/app/api/connections/route.ts:9-12`, `src/app/api/connections/route.ts:43-50`, `src/app/api/reports/route.ts:9-20`, `src/app/api/reports/route.ts:49-69`, `src/app/api/bifrost/routes/route.ts:10-12`, `src/app/api/bifrost/routes/route.ts:52-62`, `src/app/api/bifrost/routes/route.ts:106-125`, `prisma/schema.prisma:515-518`, `prisma/schema.prisma:269-272`, `prisma/schema.prisma:960-963`
- Function/component: core list/create/read/update paths for connections, reports, and Bifrost routes
- Evidence:
  - `withAuth` requires an active tenant and exposes `ctx.tenantId` (`src/lib/api.ts:35-48`).
  - Connections list by `userId` only (`src/app/api/connections/route.ts:9-12`) and create records with `userId` but no `tenantId` (`src/app/api/connections/route.ts:43-50`).
  - Reports list by `userId` only (`src/app/api/reports/route.ts:9-20`), validate connection ownership by `userId` only (`src/app/api/reports/route.ts:49-52`), and create reports without `tenantId` (`src/app/api/reports/route.ts:60-69`).
  - Bifrost routes list by `userId` only (`src/app/api/bifrost/routes/route.ts:10-12`), validate source/destination connections by `userId` only (`src/app/api/bifrost/routes/route.ts:52-62`), and create routes without `tenantId` (`src/app/api/bifrost/routes/route.ts:106-125`).
  - The schema has nullable tenant ownership columns on these models (`prisma/schema.prisma:515-518`, `prisma/schema.prisma:269-272`, `prisma/schema.prisma:960-963`), indicating a partial tenant retrofit.
- Impact: A user who belongs to multiple tenants can see or operate on resources from the wrong active tenant. Because new records are created without `tenantId`, they become detached from tenant-scoped features and can leak across a user's tenant contexts.
- Reproduction or reasoning: Create two tenants for one user, switch active tenant, then call `/api/connections`, `/api/reports`, or `/api/bifrost/routes`. Current filters do not include `session.tenantId`, so all same-user records are eligible regardless of active tenant.
- Minimal fix plan: For tenant-scoped resources, create with `tenantId: ctx.tenantId` and read/update/delete using both `id` and `tenantId`. Cross-resource validations must check referenced rows in the same tenant, not only the same user. Backfill legacy `NULL tenantId` rows with an explicit migration before making tenant columns non-null where appropriate.
- Whether fix is safe to automate: Partially. API filter/create changes are surgical, but schema nullability/backfill is data-impacting and should not be automated without a reviewed migration and backup.

### P0-2 Authenticated SSRF exists in API discovery and REST connection testing

- File: `src/app/api/alfheim/discover/openapi/route.ts:18-24`, `src/lib/alfheim/discovery/openapi-parser.ts:35-47`, `src/app/api/alfheim/discover/probe/route.ts:18-23`, `src/lib/alfheim/discovery/probe-endpoints.ts:56-68`, `src/lib/alfheim/discovery/probe-endpoints.ts:92-102`, `src/lib/alfheim/discovery/doc-search.ts:99-112`, `src/app/api/connections/test/route.ts:21-28`, `src/lib/validations/alfheim.ts:74-91`
- Function/component: Alfheim discovery routes and connection test route
- Evidence:
  - OpenAPI import accepts `specUrl: z.string().url()` (`src/lib/validations/alfheim.ts:74-82`) and passes it to `SwaggerParser.validate(input.specUrl)` (`src/lib/alfheim/discovery/openapi-parser.ts:35-47`).
  - Probe discovery accepts any `baseUrl: z.string().url()` (`src/lib/validations/alfheim.ts:86-91`) and fetches normalized URLs (`src/lib/alfheim/discovery/probe-endpoints.ts:92-102`).
  - Document discovery fetches `${baseUrl}${specPath}` without private-network checks (`src/lib/alfheim/discovery/doc-search.ts:99-112`).
  - Connection test SSRF protection only inspects `config.host` (`src/app/api/connections/test/route.ts:21-28`). REST API configs use `baseUrl`, so the guard does not run for REST targets.
- Impact: Any authenticated user with access to these flows can make the server request internal/private network URLs, metadata services, localhost admin ports, or cloud control-plane endpoints.
- Reproduction or reasoning: Submit `http://127.0.0.1:...`, `http://169.254.169.254/...`, or an internal hostname as an Alfheim `specUrl`/`baseUrl` or a REST API `baseUrl`. Current zod validation only verifies URL shape.
- Minimal fix plan: Add one URL-level SSRF guard used before every outbound user-supplied URL fetch, including all redirects. It should resolve DNS, reject private/reserved/link-local/multicast ranges, enforce `http`/`https`, and apply to `specUrl`, `baseUrl`, REST extraction/test URLs, and doc search.
- Whether fix is safe to automate: Mostly. The guard is a focused security patch, but it needs tests for IPv4, IPv6, DNS rebinding-ish hostnames, redirects, localhost aliases, and cloud metadata IPs.

### P0-3 Bifrost full reload drops the destination table before a successful reload is proven

- File: `src/lib/bifrost/engine.ts:453-472`
- Function/component: `BifrostEngine.execute`, `needsFullReload` path
- Evidence:
  - When `route.needsFullReload` is true, the engine drops the destination table immediately if it exists (`src/lib/bifrost/engine.ts:456-466`).
  - It then deletes the watermark (`src/lib/bifrost/engine.ts:469-472`) before source extraction and destination load have completed.
- Impact: A transient source, transform, destination, schema, auth, or network failure after the drop leaves the destination table missing or empty. This is direct data loss in production pipelines.
- Reproduction or reasoning: Mark a route `needsFullReload`, then make extraction or load fail after the drop. The table has already been removed and the watermark cleared.
- Minimal fix plan: Use staging-table reload and atomic swap/rename where supported. At minimum, extract and load into staging first, validate row counts/schema, then swap/truncate/drop the old target only after the new table is ready.
- Whether fix is safe to automate: No. This touches destructive write semantics and needs provider-specific design, tests, and rollback behavior.

### P0-4 Helheim manual retry can truncate a destination during single-chunk retry

- File: `src/app/api/bifrost/helheim/[id]/retry/route.ts:45-56`, `src/lib/worker.ts:500-505`
- Function/component: manual Helheim retry route
- Evidence:
  - Manual retry loads a failed chunk using `{ ...destConfig, schema }` from the original route (`src/app/api/bifrost/helheim/[id]/retry/route.ts:49-56`).
  - The scheduled worker retry path explicitly avoids this by forcing retry write disposition away from truncate (`src/lib/worker.ts:500-505`).
- Impact: If the original route uses `WRITE_TRUNCATE`, manually retrying one failed chunk can wipe the destination and load only that chunk.
- Reproduction or reasoning: Create a route with truncate semantics, force one batch into Helheim, then retry it manually. The manual endpoint passes the original destructive disposition to the provider.
- Minimal fix plan: Mirror the worker retry behavior in the manual endpoint: force `writeDisposition: "WRITE_APPEND"` or provider-equivalent non-destructive retry mode. Add a regression test for a `WRITE_TRUNCATE` route retry.
- Whether fix is safe to automate: Yes. This is a surgical endpoint fix with a straightforward test.

### P0-5 Raven resume deletes ingested chunks before transform/load succeeds

- File: `src/lib/bifrost/jobs/raven-resume.handler.ts:50-87`, `src/lib/bifrost/jobs/raven-resume.handler.ts:89-120`, `src/app/api/raven/ingest/[jobId]/complete/route.ts:111-126`
- Function/component: Raven/Data Agent Bifrost resume pipeline
- Evidence:
  - Resume assembles chunks (`src/lib/bifrost/jobs/raven-resume.handler.ts:50-83`) and then deletes them immediately (`src/lib/bifrost/jobs/raven-resume.handler.ts:86-87`).
  - Transform and destination connection/load occur after deletion (`src/lib/bifrost/jobs/raven-resume.handler.ts:89-120`).
  - The complete endpoint marks the Raven job success, then treats resume enqueue failure as non-fatal (`src/app/api/raven/ingest/[jobId]/complete/route.ts:111-126`).
- Impact: If transform/load fails after chunk deletion, the source data needed for retry is gone. If resume enqueue fails, the job is marked complete but the downstream route can remain stuck waiting for a handler that was never queued.
- Reproduction or reasoning: Complete a Raven job with chunks, then make destination connect/load fail. The resume handler deletes chunks before it reaches the risky downstream operations.
- Minimal fix plan: Delete chunks only after route completion is durable. If enqueue fails, mark the route log/job in a retryable state or return a non-2xx response so the agent/control plane can retry.
- Whether fix is safe to automate: Partially. Moving deletion after success is small; complete/enqueue state semantics should be designed and tested.

### P0-6 Gate push SQL builders concatenate unescaped identifiers and raw SQL literals

- File: `src/lib/gates/push-executor.ts:293-322`, `src/lib/gates/push-executor.ts:325-376`, `src/lib/gates/alter-generator.ts:34-44`, `src/lib/gates/alter-generator.ts:175-198`, `src/app/api/gates/route.ts:127-136`, `src/app/api/gates/route.ts:229-251`
- Function/component: Gate destination DDL/upsert generation
- Evidence:
  - Postgres upsert uses `"${schema}"."${table}"` and `"${c}"` without escaping embedded quotes (`src/lib/gates/push-executor.ts:300-322`).
  - MSSQL and MySQL builders use `[${name}]` and backticks without escaping delimiters (`src/lib/gates/push-executor.ts:325-376`).
  - DDL quote helper has the same issue (`src/lib/gates/alter-generator.ts:34-44`), then builds `CREATE TABLE` SQL from schema/table/column names (`src/lib/gates/alter-generator.ts:175-198`).
  - Gate creation can execute an initial push immediately (`src/app/api/gates/route.ts:229-251`).
- Impact: Malicious or malformed schema/table/column identifiers can break out of quoting or generate destructive SQL against destination databases. Even for trusted users, this can create incorrect writes or failed pushes.
- Reproduction or reasoning: Provide a destination table/schema/column name containing dialect quote delimiters such as `"`, `]`, or `` ` ``. The generated SQL embeds it directly.
- Minimal fix plan: Centralize dialect identifier quoting with delimiter escaping and/or enforce strict identifier validation at API boundaries. Prefer provider parameterization/bulk-load APIs for row values instead of building giant SQL value lists.
- Whether fix is safe to automate: Partially. Identifier escaping is surgical; replacing value-list DML with parameterized/bulk APIs is broader and should be tested per provider.

## P1 High Issues

### P1-1 Bifrost route updates can rebind source/destination/blueprint IDs without tenant validation

- Evidence: Existing route ownership is checked by `id` + `userId` only (`src/app/api/bifrost/routes/[id]/route.ts:32-34`), then `sourceId`, `ravenSatelliteId`, `destId`, `blueprintId`, and `destConfig` are written directly (`src/app/api/bifrost/routes/[id]/route.ts:66-90`).
- Impact: A route can be updated to point at references that were never validated for the active tenant. This compounds the tenant isolation issue and can execute pipelines with unintended connections.
- Minimal fix plan: On every update that changes a foreign key, validate the target row by active `tenantId` and compatible type before updating.

### P1-2 Worker shutdown marks all running logs failed globally

- Evidence: `markInFlightJobsFailed` updates every `RunLog` with `status: "RUNNING"` and every `RouteLog` with `status: "running"` (`src/lib/worker-shutdown.ts:12-20`) without worker ownership or heartbeat.
- Impact: In multi-worker or rolling deploy scenarios, one process shutdown can mark legitimate work owned by another process as failed.
- Minimal fix plan: Track worker/process ownership on log records or use pg-boss job state as source of truth. Only mark jobs owned by the shutting-down worker, or only stale jobs beyond a timeout.

### P1-3 Scheduler ticks can overlap and advance schedules before enqueue succeeds

- Evidence: Scheduler advances report `nextRunAt` before enqueue (`src/lib/worker.ts:166-191`), advances Bifrost `nextRunAt` before enqueue (`src/lib/worker.ts:219-227`), and runs on `setInterval` without an in-process `tickRunning` guard (`src/lib/worker.ts:549-556`).
- Impact: A crash between update and enqueue skips a run; an overlapping tick can race schedule advancement/enqueue behavior. Singleton keys help job duplication but do not protect schedule state.
- Minimal fix plan: Add a scheduler lease or in-process guard, and update `nextRunAt` in the same durable flow as enqueue where possible. At least make skipped-run behavior explicit and observable.

### P1-4 REST API provider can leak sensitive data in logs and accepts empty credentials on create

- Evidence: Auth failure logs include the full URL and first 500 response-body chars (`src/lib/providers/rest-api.provider.ts:127-131`); extraction logs full URL plus credential key names (`src/lib/providers/rest-api.provider.ts:312-320`). REST create validation uses `restApiCredentialsBaseSchema` (`src/lib/validations/unified-connections.ts:183-190`), whose fields are all optional (`src/lib/validations/alfheim.ts:55-70`).
- Impact: Tokens in query strings or response bodies can land in logs. Invalid REST connections can be saved without credentials even when auth type requires them.
- Minimal fix plan: Redact URLs before logging, avoid response bodies in auth logs, and use the refined credential schema in create/test paths based on auth type.

### P1-5 BigQuery MERGE identifiers are not escaped and failed staging tables are not actually preserved

- Evidence: BigQuery `mergeInto` interpolates dataset/table/column identifiers inside backticks without escaping (`src/lib/providers/bigquery.provider.ts:381-398`). On MERGE failure, the engine logs that staging is preserved (`src/lib/bifrost/engine.ts:791-796`) but the `finally` block drops it (`src/lib/bifrost/engine.ts:798-806`).
- Impact: Bad identifiers can break or alter generated MERGE SQL. Failed MERGE diagnostics are lost despite log messaging claiming otherwise.
- Minimal fix plan: Add BigQuery identifier quoting/validation and either actually preserve staging tables on MERGE failure or change the log/message and capture enough diagnostics elsewhere.

### P1-6 Bifrost opens provider connections before entering the guarded `try/finally`

- Evidence: Source and destination provider connections are opened before `try` starts (`src/lib/bifrost/engine.ts:270-281`), while cleanup happens in the `finally` inside that `try` (`src/lib/bifrost/engine.ts:938-940`).
- Impact: If destination connect fails after source connect succeeds, the source connection can leak and no route log is reliably updated. If source connect fails, no route log is created.
- Minimal fix plan: Move connection acquisition into a guarded block that closes whichever connection succeeded, and create/update a route log for connect-stage failures.

### P1-7 Backup APIs mix `userId` and `OR tenantId/userId` scoping

- Evidence: `userScopedWhere` returns only `{ userId }` (`src/lib/backups/api-helpers.ts:11-12`); backup source validation uses `userId` only (`src/lib/backups/api-helpers.ts:27-31`); storage target validation accepts either tenant or user (`src/lib/backups/api-helpers.ts:62-69`); storage target list accepts either tenant or user (`src/app/api/backups/storage-targets/route.ts:22-31`); item GET/PUT uses the same `OR` (`src/app/api/backups/storage-targets/[id]/route.ts:30-56`).
- Impact: Same-user cross-tenant backup sources/targets can appear or be reused across tenant contexts. Backup/restore is destructive enough that this should be strict.
- Minimal fix plan: Choose one ownership model. For tenant-scoped backups, require `tenantId: ctx.tenantId` for policies, runs, restores, targets, and referenced connections, with a migration/backfill plan for existing rows.

### P1-8 Query execution and report APIs return raw provider errors and execute user-only scoped connections

- Evidence: Query execution validates connection by `id` + `userId` only (`src/app/api/query/execute/route.ts:21-24`) and returns raw provider error messages to the frontend (`src/app/api/query/execute/route.ts:60-63`). Report creation validates the connection by `userId` only (`src/app/api/reports/route.ts:49-52`).
- Impact: Active-tenant boundaries are bypassed and provider/SQL/server details can leak to users through raw errors.
- Minimal fix plan: Scope by tenant and return sanitized error categories with detailed logs server-side.

## P2 Medium Issues

### P2-1 Nullable tenant columns are widespread and need an intentional migration plan

- Evidence: Tenant-scoped objects have nullable `tenantId`: `SftpConnection` (`prisma/schema.prisma:192-199`), `EmailConnection` (`prisma/schema.prisma:245-253`), `Report` (`prisma/schema.prisma:269-278`), `Connection` (`prisma/schema.prisma:515-532`), backup targets/policies (`prisma/schema.prisma:639-649`, `prisma/schema.prisma:686-689`), MSSQL backups (`prisma/schema.prisma:816-827`, `prisma/schema.prisma:852-857`), Bifrost route/dead-letter/watermark (`prisma/schema.prisma:960-977`, `prisma/schema.prisma:1013-1019`, `prisma/schema.prisma:1031-1036`).
- Impact: API fixes alone will not eliminate legacy/null-tenant ambiguity. Some nullability may be intentional for backward compatibility, but it is currently undocumented in code.
- Minimal fix plan: Inventory legacy rows, backfill by user active/default tenant where safe, and only then consider non-null constraints.

### P2-2 Route parameter parsing is fragile in many App Router handlers

- Evidence: Routes parse IDs via `req.url.split(...)`, for example `src/app/api/bifrost/routes/[id]/route.ts:30`, `src/app/api/bifrost/routes/[id]/route.ts:98`, `src/app/api/bifrost/helheim/[id]/retry/route.ts:16`, `src/app/api/raven/ingest/[jobId]/complete/route.ts:13`, `src/app/api/backups/mssql/policies/[id]/preflight/route.ts:5-10`.
- Impact: Path parsing can break under route nesting, encoded path segments, rewritten URLs, or future path changes.
- Minimal fix plan: Update `withAuth` to pass App Router `routeContext` through and migrate dynamic routes to typed `{ params }` handlers.

### P2-3 Dead-letter entries do not store tenant IDs

- Evidence: `HelheimEntry` has `tenantId String?` (`prisma/schema.prisma:1013-1019`), but `enqueueDeadLetter` does not set it (`src/lib/bifrost/helheim/dead-letter.ts:72-86`).
- Impact: Dead-letter APIs must join through route ownership for scoping. Tenant-level operations, cleanup, stats, and incident response are harder and more error-prone.
- Minimal fix plan: Set `tenantId` from the route when enqueuing and backfill existing entries.

### P2-4 Plaintext credential fallback remains accepted

- Evidence: `toConnectionLike` decrypts credentials, but if decrypt fails, it tries `JSON.parse(connection.credentials)` and uses plaintext fallback (`src/lib/providers/helpers.ts:16-25`). Tests assert this behavior.
- Impact: This may be a compatibility bridge, but it normalizes plaintext credential storage if bad rows or manual inserts exist.
- Minimal fix plan: Keep fallback only behind a migration/compatibility flag, log row IDs in a secure admin-only channel, and add a migration to re-encrypt or reject plaintext rows.

### P2-5 SQL query parameter fallback uses string interpolation

- Evidence: `resolveQueryParams` replaces `@param` placeholders with single-quoted escaped strings (`src/lib/providers/helpers.ts:41-49`).
- Impact: Escaping single quotes is better than raw concatenation, but it is still not native parameterization and can create type/casting surprises or edge-case injection risks for providers using it.
- Minimal fix plan: Prefer provider-native parameters for query execution/extraction. Where unsupported, restrict param origins and add tests for quotes, backslashes, nulls, arrays, and dates.

### P2-6 UI destructive actions mostly use confirmation state, but some flows are not obviously explicit

- Evidence: Reports, Bifrost routes, backup policies, storage targets, and blueprints perform `DELETE` in `executeDelete` after setting `deleteTarget` (`src/components/reports/report-list.tsx:29-37`, `src/components/bifrost/route-list.tsx:114-124`, `src/components/backups/backup-list.tsx:98-105`, `src/components/backups/storage-target-list.tsx:86-93`, `src/components/mjolnir/blueprint-list.tsx:44-53`). Raven settings use explicit `window.confirm` (`src/app/(app)/settings/raven-keys/page.tsx:110-132`, `src/app/(app)/settings/ravens/[ravenId]/page.tsx:123-150`).
- Impact: I did not find a top-tier destructive UI bug in the sampled main components, but the backup/Bifrost delete dialogs should be verified visually because API-side scoping/destructive behavior is high risk.
- Minimal fix plan: Add component tests or Playwright checks for delete confirmation modals on backup, Bifrost, report, and connection flows.

## P3 Low Issues

### P3-1 Logging is noisy in provider and pipeline tests/runs

- Evidence: REST extraction logs every URL (`src/lib/providers/rest-api.provider.ts:320`); NetSuite provider logs queries during tests (observed in `npm run test` output); Bifrost engine logs staging behavior and batch progress heavily (`src/lib/bifrost/engine.ts:790-810`).
- Impact: Noise makes real incidents harder to spot and increases accidental sensitive-data exposure risk.
- Minimal fix plan: Use structured log levels and redact sensitive fields consistently.

### P3-2 Generated comments and route comments show mojibake in terminal output

- Evidence: PowerShell line reads showed garbled box-drawing/comment characters across several files, such as `src/app/api/connections/route.ts:8` and `src/lib/bifrost/engine.ts:453`.
- Impact: This did not affect build/test behavior, but it hurts auditability in Windows terminals and can complicate diffs.
- Minimal fix plan: Standardize source encoding to UTF-8 and avoid decorative comment glyphs in code comments.

## Build/Test Results

- Command: `npx prisma validate`
  - Exit code: 0
  - Result:
    - `Environment variables loaded from .env`
    - `Prisma schema loaded from prisma\schema.prisma`
    - `The schema at prisma\schema.prisma is valid`

- Command: `npx prisma generate`
  - Exit code: 1
  - Exact failure:
    - `EPERM: operation not permitted, rename 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node.tmp380920' -> 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node'`
  - Interpretation: Matches the known Windows Prisma DLL lock failure. I did not move/delete `.prisma` because this was an audit-only pass.

- Command: `npm run build`
  - Exit code: 0
  - Result:
    - Next.js 14.2.35 compiled successfully.
    - Type checking passed.
    - Static generation completed: `Generating static pages (106/106)`.
    - Build finalized and emitted the route table.
  - Note: An earlier run before the user's parallel build finished failed at `src/app/api/backups/mssql/policies/[id]/preflight/route.ts:9:30`; this was not reproduced on rerun.

- Command: `npm run test`
  - Exit code: 0
  - Result:
    - `Test Files 55 passed (55)`
    - `Tests 972 passed (972)`
    - `Duration 7.31s`
  - Notable non-failing stderr/log signals:
    - REST auth failure logging appears in tests: `[REST] Auth failed 401 for https://api.example.com: null`.
    - Plaintext credential fallback is exercised: `[toConnectionLike] Credentials for POSTGRES connection were not encrypted - using plaintext fallback`.

- Command: `npm run lint`
  - Exit code: 1
  - Result:
    - Script runs `next lint`.
    - It prompts interactively: `How would you like to configure ESLint? Strict (recommended) / Base / Cancel`.
  - Interpretation: Lint is not currently usable in non-interactive CI without ESLint config migration/setup.

- Command not run: `npm install`
  - Reason: dependencies were already present and all requested npm/prisma diagnostics could be invoked without installing.

## Suggested Fix Order

1. Add centralized tenant scoping helpers and patch create/read/update/delete paths for connections, reports, schedules, email/SFTP connections, Bifrost routes, backups, and query execution. Add tests for same-user multi-tenant isolation.
2. Add SSRF protection to all user-supplied outbound URL paths, with redirect/DNS/IP tests.
3. Patch the surgical data-loss bugs: force manual Helheim retry append mode and move Raven chunk deletion after durable success.
4. Redesign Bifrost full reload around staging/swap semantics before allowing `needsFullReload` to drop production targets.
5. Harden Gate and BigQuery SQL identifier quoting/validation, then add dialect-specific tests.
6. Fix worker ownership/overlap semantics for shutdown cleanup and scheduler ticks.
7. Plan and execute tenantId backfill/non-null migrations only after API behavior is corrected and backed up.
8. Make lint non-interactive in CI and resolve the Prisma generate lock locally with the documented Windows workaround.

## Do Not Touch Yet

- Do not make tenant columns non-null or run destructive Prisma changes until legacy/null tenant data is inventoried and backed up.
- Do not change Bifrost full-reload, MERGE, or watermark semantics broadly without provider-specific migration tests and rollback strategy.
- Do not rewrite provider query execution globally; user-authored SQL is core product behavior, and parameterization changes need provider-by-provider validation.
- Do not alter backup/restore destructive flows without fixture databases/storage targets and explicit recovery tests.
- Do not clean up the large dirty working tree or generated-looking backup additions as part of this audit. Those changes pre-existed this pass and should be reviewed/owned separately.

## Fix Pass Results

Fix pass date: 2026-05-03

Scope: stabilization-only pass against the highest-priority findings. Changes were limited to P0 issues plus small P1 fixes that directly overlapped credential leakage, destructive writes, identifier safety, or connection cleanup.

### Fixed: P0-1 Tenant isolation is incomplete across core resources

- Files changed: `src/app/api/connections/route.ts`, `src/app/api/connections/[id]/route.ts`, `src/app/api/connections/[id]/move/route.ts`, `src/app/api/reports/route.ts`, `src/app/api/reports/[id]/route.ts`, `src/app/api/bifrost/routes/route.ts`, `src/app/api/bifrost/routes/[id]/route.ts`, `src/app/api/bifrost/routes/[id]/run/route.ts`, `src/app/api/bifrost/routes/[id]/logs/route.ts`, `src/app/api/query/execute/route.ts`, `src/app/api/bifrost/helheim/[id]/retry/route.ts`.
- Summary of fix: Core connection, report, Bifrost route, route-run/log, query execution, and manual Helheim retry paths now scope by `userId` and active `tenantId`; create paths write `tenantId`; Bifrost route updates validate changed connection/Raven/blueprint references before rebinding.
- Why minimal: No schema migration or broad auth helper rewrite; only existing `where` clauses and create/update validation were tightened.
- Tests/commands run: `npx tsc --noEmit --pretty false` after tenant patch.
- Result: Type check still failed only on pre-existing test typing issues; no new errors from the changed tenant-scoped route files.
- Remaining risk: Legacy rows with `NULL tenantId`, backup APIs, email/SFTP connection APIs, and some other tenant-scoped surfaces still need a broader tenant backfill/scoping pass.

### Fixed: P0-2 Authenticated SSRF exists in API discovery and REST connection testing

- Files changed: `src/lib/ssrf.ts`, `src/lib/alfheim/discovery/openapi-parser.ts`, `src/lib/alfheim/discovery/probe-endpoints.ts`, `src/lib/alfheim/discovery/doc-search.ts`, `src/app/api/connections/test/route.ts`, `src/lib/providers/rest-api.provider.ts`, `src/__tests__/security.test.ts`.
- Summary of fix: Added URL-level SSRF checks for `http`/`https`, DNS resolution, private/reserved IPv4 and IPv6 ranges, and redirect chains. Applied the guarded fetch path to OpenAPI fetch, probe/doc-search fetches, REST connection tests, and REST extraction. OpenAPI URL parsing now fetches through the guard and disables external reference resolution during validation.
- Why minimal: Centralized the guard in `src/lib/ssrf.ts` and replaced direct user-supplied fetches without changing discovery API shapes.
- Tests/commands run: `npm run test -- src/__tests__/security.test.ts`, `npm run test -- src/__tests__/alfheim/rest-api-provider.test.ts`.
- Result: Security test passed, 14 tests. REST provider test passed, 23 tests.
- Remaining risk: Additional outbound URL surfaces should continue to adopt `fetchWithSsrfProtection`; the guard intentionally allows public DNS failures to surface from the actual request.

### Fixed: P0-3 Bifrost full reload drops the destination table before a successful reload is proven

- Files changed: `src/lib/bifrost/engine.ts`, `src/__tests__/bifrost/bifrost-engine.test.ts`.
- Summary of fix: Removed the pre-load `dropTable` and watermark deletion path. If `needsFullReload` is set and the destination table already exists, the route now fails loudly and leaves the destination untouched until a staged reload/swap implementation exists.
- Why minimal: This avoids destructive behavior without attempting a broad provider-specific staged reload redesign.
- Tests/commands run: `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`.
- Result: Bifrost engine test passed, 23 tests.
- Remaining risk: Existing-table full reload is now blocked rather than completed. A proper staged reload/swap design is still required before re-enabling automatic full reload against existing targets.

### Fixed: P0-4 Helheim manual retry can truncate a destination during single-chunk retry

- Files changed: `src/app/api/bifrost/helheim/[id]/retry/route.ts`, `src/__tests__/bifrost/helheim-retry.test.ts`.
- Summary of fix: Manual Helheim retry now scopes the entry through active tenant ownership and forces `writeDisposition: "WRITE_APPEND"` when loading the retry chunk. The retry route also closes the destination connection if decompression or loading fails after connect.
- Why minimal: Mirrored the existing worker retry override instead of changing retry storage or provider behavior.
- Tests/commands run: `npm run test -- src/__tests__/bifrost/helheim-retry.test.ts`.
- Result: Helheim retry test passed, 5 tests.
- Remaining risk: No full HTTP integration test was added for the route; the focused regression covers the destructive write-disposition rule.

### Fixed: P0-5 Raven resume deletes ingested chunks before transform/load succeeds

- Files changed: `src/lib/bifrost/jobs/raven-resume.handler.ts`, `src/app/api/raven/ingest/[jobId]/complete/route.ts`.
- Summary of fix: Raven chunks are now deleted only after downstream route log finalization succeeds. If enqueueing `resume-raven-route` fails after completion, the complete endpoint resets the Raven job to `running`, clears `completedAt`, records a retryable error result, and returns HTTP 500.
- Why minimal: Moved cleanup ordering and made enqueue failure non-successful without changing Raven auth, chunk upload, or pg-boss job schema.
- Tests/commands run: `npx tsc --noEmit --pretty false`, `npm run test`.
- Result: Type check still failed only on pre-existing test typing issues; full test suite passed, 56 files and 980 tests.
- Remaining risk: This still needs an integration test covering chunk retention across transform/load failure and enqueue failure.

### Fixed: P0-6 Gate push SQL builders concatenate unescaped identifiers

- Files changed: `src/lib/gates/sql-identifiers.ts`, `src/lib/gates/push-executor.ts`, `src/lib/gates/alter-generator.ts`, `src/__tests__/gates/sql-identifiers.test.ts`.
- Summary of fix: Added dialect-aware identifier quoting with delimiter escaping for Postgres, MSSQL, MySQL, and BigQuery-style identifiers, then wired Gate upsert and DDL builders through it.
- Why minimal: Escaped identifiers in the existing builders without replacing the entire DML strategy.
- Tests/commands run: `npm run test -- src/__tests__/gates/sql-identifiers.test.ts`.
- Result: Gate SQL identifier test passed, 3 tests.
- Remaining risk: Row values are still rendered into SQL as escaped literals. Replacing value-list DML with parameterized/bulk provider APIs remains a larger follow-up.

### Fixed: P1-1 Bifrost route updates can rebind references without tenant validation

- Files changed: `src/app/api/bifrost/routes/[id]/route.ts`.
- Summary of fix: Update requests now validate changed `sourceId`, `ravenSatelliteId`, and `destId` against the active tenant before updating the route; `blueprintId` is validated by user ownership because the current schema has no `tenantId` on blueprints.
- Why minimal: Added validation around the existing update payload instead of changing schema or route shape.
- Tests/commands run: `npm run build`.
- Result: Production build passed.
- Remaining risk: Blueprint tenant ownership remains schema-limited until blueprints gain tenant scoping or an explicit migration plan.

### Fixed: P1-4 REST API provider can leak sensitive data in logs and accepts empty credentials

- Files changed: `src/lib/providers/rest-api.provider.ts`, `src/lib/validations/unified-connections.ts`.
- Summary of fix: REST auth failures no longer log response bodies; REST extract logs redact query strings and no longer list credential key names; REST create/test validation now uses the credential-presence refinement.
- Why minimal: Kept response/API shapes and auth header construction intact while removing sensitive log material and invalid empty REST credentials.
- Tests/commands run: `npm run test -- src/__tests__/alfheim/rest-api-provider.test.ts`, `npm run test -- src/__tests__/providers/unified-connection-validation.test.ts`.
- Result: REST provider test passed, 23 tests. Unified connection validation test passed, 17 tests.
- Remaining risk: OAuth2/CUSTOM REST credentials may need a more type-aware auth-mode schema if the catalog supports flows beyond the current credential refinement.

### Fixed: P1-5 BigQuery MERGE identifiers are not escaped and failed staging tables are not preserved

- Files changed: `src/lib/providers/bigquery.provider.ts`, `src/lib/bifrost/engine.ts`, `src/__tests__/providers/bigquery-provider.test.ts`, `src/__tests__/bifrost/bifrost-engine.test.ts`.
- Summary of fix: BigQuery MERGE SQL now escapes backtick delimiters in dataset/table/column identifiers. Bifrost now drops staging tables only after successful MERGE and leaves staging tables in place after MERGE failure, matching the existing failure log.
- Why minimal: Only touched MERGE SQL generation and the success/failure cleanup branch.
- Tests/commands run: `npm run test -- src/__tests__/providers/bigquery-provider.test.ts`, `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`.
- Result: BigQuery provider test passed, 52 tests. Bifrost engine test passed, 23 tests.
- Remaining risk: Failed staging tables now require operational cleanup after investigation.

### Fixed: P1-6 Bifrost opens provider connections before entering guarded cleanup

- Files changed: `src/lib/bifrost/engine.ts`, `src/__tests__/bifrost/bifrost-engine.test.ts`.
- Summary of fix: Source and destination connections are now acquired inside the engine `try` block and closed via nullable cleanup in `finally`, so a destination connect failure closes an already-open source connection.
- Why minimal: Moved the existing connection acquisition into the existing error/finally boundary without changing route log semantics.
- Tests/commands run: `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`.
- Result: Bifrost engine test passed, 23 tests.
- Remaining risk: Source-connect failures still cannot create rich provider diagnostics beyond the existing failed route log path.

### Final Validation

- Command: `npx prisma validate`
  - Exit code: 0
  - Result: `The schema at prisma\schema.prisma is valid`
- Command: `npx prisma generate`
  - Exit code: 1
  - Exact failure: `EPERM: operation not permitted, rename 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node.tmp384576' -> 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node'`
  - Interpretation: Same Windows Prisma DLL lock class noted in the audit. No destructive workaround was run.
- Command: `npm run test`
  - Exit code: 0
  - Result: `Test Files 56 passed (56)`, `Tests 980 passed (980)`, `Duration 6.15s`
- Command: `npm run build`
  - Exit code: 0
  - Result: Next.js 14.2.35 compiled successfully, type validity passed, static generation completed `106/106`.
- Command: `npm run lint`
  - Exit code: 1
  - Result: `next lint` prompted interactively for ESLint configuration: `Strict (recommended) / Base / Cancel`.
- Supplemental command: `npx tsc --noEmit --pretty false`
  - Exit code: 1
  - Result: Still fails on pre-existing test type errors in backup validation, Mjolnir parsed-file fixtures, NetSuite provider test cast, unified connection validation union accesses, and ExcelJS worksheet view assertions. No new application type errors remained after the fix pass.

### Issues Intentionally Not Fixed In This Pass

- P1-2 worker shutdown ownership: requires schema/runtime ownership or heartbeat design to avoid marking another worker's jobs failed.
- P1-3 scheduler overlap/advance-before-enqueue: requires scheduler lease/transaction design and pg-boss behavior review.
- P1-7 backup API tenant scoping: destructive backup/restore flows need a dedicated tenant model decision and fixtures before tightening.
- P1-8 raw query/provider errors: sanitizing query errors changes user-facing debugging behavior and should be paired with server-side structured error logging.
- P2 nullable tenant columns: requires data inventory, backfill plan, and reviewed migration.
- P2 route param parsing: requires a `withAuth` route-context signature change across many dynamic routes.
- P2 plaintext credential fallback: compatibility behavior remains and needs migration/flag planning before removal.
