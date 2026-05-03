# Hermod Code Scrub

Audit date: 2026-05-03

Scope: local checkout of `Wampafan1/Hermod`. This was an audit-only pass. No application code was changed. This report file is the only intended output.

## Executive Summary

- Overall risk level: HIGH
- Top 5 issues:
  1. Server-rendered app pages use `userId`-only or `OR tenantId/userId` queries, so a multi-tenant user can see reports, schedules, history, dashboard data, Helheim entries, Mjolnir blueprints, and some connections from another tenant.
  2. Bifrost direct loads can use `WRITE_TRUNCATE` on the real destination table and then continue after later batches fail, leaving partial data in production tables.
  3. Realm Gates can attach the active tenant to a connection owned by the same user in another tenant, then decrypt and use that connection during setup.
  4. Raven resume jobs bypass the direct Bifrost MERGE/staging path and buffer all result chunks in memory, creating duplicate/load-corruption and memory risks.
  5. Google Sheets connections can be saved without provider-usable OAuth credentials, while the provider requires tokens during worker extraction.
- Build/test status: PASS with warnings. `prisma validate`, `prisma generate`, `npm run test`, `npm run build`, and `npm run lint` completed successfully.
- Credential risk: no obvious plaintext credential exposure was found in the normal connection CRUD responses, and `src/lib/crypto.ts` plus `src/lib/providers/helpers.ts` are broadly sound. However, the Realm Gates cross-tenant connection lookup can cause the server to use another tenant's encrypted connection credentials, and Google Sheets OAuth credential ownership/storage is incomplete.
- Tenant isolation risk: YES. API routes are mostly tenant-aware through `withAuth`, but several server-rendered pages and dashboard data functions still rely on `userId` only.

## Recent Suspicious Code

- `git status --short` shows a large pre-existing dirty worktree touching API auth/tenant routes, backup engines, Bifrost/Helheim, provider code, validations, tests, `package.json`, and `package-lock.json`. I did not revert or normalize those changes.
- `git diff --name-only` includes high-risk files such as `src/lib/api.ts`, `src/lib/bifrost/engine.ts`, `src/lib/bifrost/jobs/raven-resume.handler.ts`, `src/lib/providers/mysql.provider.ts`, Alfheim catalog routes, backup policy/storage routes, schedule/report execution routes, and many security/provider tests.
- Recent commits from `git log --oneline -8` are:
  1. `f40dd00 Apply backup storage and efficiency updates`
  2. `ce70126 Stabilize remaining audit P1 P2 issues`
  3. `ee82771 Stabilize critical audit findings`
  4. `083d4eb Add Niflheim backup operations`
  5. `59d4ccd fix: replace broken entity join with customer/vendor, cache field-fetch failures`
  6. `241aa35 feat: add curated record joins to NetSuite route builder`
  7. `7f8abce fix: auto-execute gate push after validation, add history recovery button`
  8. `05220d4 fix: improve header detection heuristic for ERP exports`
- Audit prioritization note: I prioritized files that were both security/data-path sensitive and recently touched, especially tenant scoping in app/API routes, Bifrost loading, Raven resume, providers, credential helpers, and validation schemas.

## P0 Critical Issues

### P0-1. Server-rendered app pages leak tenant data through `userId`-only queries

- File:
  - `src/lib/session.ts:8-14`
  - `src/app/(app)/connections/page.tsx:8-18`, `src/app/(app)/connections/page.tsx:29-31`
  - `src/app/(app)/reports/page.tsx:8-20`
  - `src/app/(app)/schedules/page.tsx:7-21`
  - `src/app/(app)/history/page.tsx:8-34`
  - `src/app/(app)/dashboard/page.tsx:8-13`
  - `src/lib/dashboard/queries.ts:57-139`
  - `src/app/(app)/helheim/page.tsx:7-34`
  - `src/app/(app)/mjolnir/page.tsx:7-21`
- Function/component:
  - `requireAuth`
  - `ConnectionsPage`
  - `ReportsPage`
  - `SchedulesPage`
  - `HistoryPage`
  - `DashboardPage`
  - `getDashboardData`
  - `HelheimPage`
  - `MjolnirPage`
- Evidence:
  - `src/lib/session.ts:8-14` only redirects unauthenticated users. It does not require `session.user.tenantId`.
  - `src/app/(app)/connections/page.tsx:11-18` queries connections with `OR: [{ tenantId: session.user.tenantId ?? undefined }, { userId: session.user.id }]`.
  - `src/app/(app)/connections/page.tsx:29-31` queries email connections by `userId` only.
  - `src/app/(app)/reports/page.tsx:10-20` queries reports by `userId` only and includes `connection`, `schedule`, and `runHistory`.
  - `src/app/(app)/schedules/page.tsx:9-21` queries schedules by `report.userId` only and includes report and recipients.
  - `src/app/(app)/history/page.tsx:11-34` queries run logs and report lists by `report.userId` only.
  - `src/app/(app)/dashboard/page.tsx:12` calls `getDashboardData(session.user.id)`, and `src/lib/dashboard/queries.ts:57-139` counts routes, route logs, Helheim entries, schedules, and recent logs by `userId` only.
  - `src/app/(app)/helheim/page.tsx:11-34` queries Helheim entries through `route.userId`.
  - `src/app/(app)/mjolnir/page.tsx:9-21` lists blueprints by `userId` only.
- Impact:
  - A user who belongs to multiple tenants can switch active tenants and still see objects created in another tenant if those rows share the same `userId`.
  - Leaked data can include report names, SQL-bearing report metadata, connection names and types, schedule recipients, run history errors, route names, dead-letter metadata, and blueprint source schemas or transformations.
  - This weakens the tenant model even though most API routes are correctly scoped.
- Reproduction or reasoning:
  - Create or own tenant A data as user U.
  - Join or switch to tenant B as the same user U.
  - Render `/reports`, `/schedules`, `/history`, `/dashboard`, `/helheim`, `/mjolnir`, or `/connections`.
  - The server-side queries use `userId: U` or an `OR` branch on `userId: U`, so tenant A rows are eligible while tenant B is active.
- Minimal fix plan:
  1. Update `src/lib/session.ts` so app pages require an active tenant, matching the stricter API contract in `src/lib/api.ts`.
  2. Pass `tenantId` into server-side data helpers such as `getDashboardData`.
  3. Replace `userId`-only filters with tenant-aware filters. Prefer `{ tenantId: session.user.tenantId }` for tenant-owned resources, optionally also keeping `{ userId: session.user.id }` where ownership inside a tenant is intentional.
  4. Remove broad `OR tenantId/userId` fallbacks from page queries unless there is a documented legacy migration path.
  5. Add tests for a user who belongs to two tenants and verify each page only returns active-tenant data.
- Whether fix is safe to automate:
  - Partially. The mechanical filter changes are small, but the intended sharing model for Mjolnir blueprints and legacy `tenantId: null` rows needs product confirmation before a schema or migration change.

### P0-2. Bifrost `WRITE_TRUNCATE` can leave production destination tables partially loaded

- File:
  - `src/lib/bifrost/engine.ts:570-690`, `src/lib/bifrost/engine.ts:856-861`
  - `src/lib/providers/postgres.provider.ts:268-270`
  - `src/lib/providers/mysql.provider.ts:207-210`
  - `src/lib/providers/mssql.provider.ts:281-282`
  - `src/lib/providers/bigquery.provider.ts:230-233`
- Function/component:
  - `runBifrostRoute`
  - `PostgresProvider.load`
  - `MySqlProvider.load`
  - `MssqlProvider.load`
  - `BigQueryProvider.load`
- Evidence:
  - `src/lib/bifrost/engine.ts:632-636` sends `WRITE_TRUNCATE` for the first successful destination load batch and `WRITE_APPEND` for later batches.
  - `src/lib/bifrost/engine.ts:660-690` can dead-letter failed batches and continue.
  - `src/lib/bifrost/engine.ts:856-861` marks the run as `partial` when only some rows load.
  - `src/lib/providers/postgres.provider.ts:268-270`, `src/lib/providers/mysql.provider.ts:207-210`, and `src/lib/providers/mssql.provider.ts:281-282` perform real `TRUNCATE TABLE` operations before inserts.
  - `src/lib/providers/bigquery.provider.ts:230-233` passes the requested `writeDisposition` to BigQuery load jobs.
- Impact:
  - If the first batch succeeds and a later batch fails, the destination table has already been truncated and replaced with only a subset of the source data.
  - The run can be recorded as partial rather than failed, but the destructive side effect has already happened.
  - This is a production data-loss risk for any non-staged destination using `WRITE_TRUNCATE`.
- Reproduction or reasoning:
  - Configure a direct Bifrost route with `destConfig.writeDisposition = "WRITE_TRUNCATE"` and enough rows for multiple batches.
  - Cause batch 2 or later to fail, for example with a row-level type/constraint problem.
  - Batch 1 truncates and loads the destination table. Later failure is dead-lettered. Final destination now contains only the rows loaded before the failed batch.
- Minimal fix plan:
  1. Treat `WRITE_TRUNCATE` as an all-or-nothing operation.
  2. Load into a staging table first, validate all batches, then swap/replace the destination inside the strongest transaction or provider-native atomic operation available.
  3. For providers that cannot swap atomically, either block `WRITE_TRUNCATE` for multi-batch runs or fail before touching the destination.
  4. Add failure-injection tests where batch 2 fails and assert the original destination table remains unchanged.
- Whether fix is safe to automate:
  - No for the full fix. Provider-specific staging and swap behavior needs careful design and tests. A temporary guard that rejects unsafe `WRITE_TRUNCATE` direct loads is safer to automate.

### P0-3. Realm Gate creation can use another tenant's connection credentials

- File:
  - `src/app/api/gates/route.ts:128-134`
  - `src/app/api/gates/route.ts:191-199`
  - `src/app/api/gates/route.ts:211-222`
- Function/component:
  - `POST /api/gates`
- Evidence:
  - `src/app/api/gates/route.ts:128-134` comments "Verify connection belongs to tenant" but performs:
    - `id: connectionId`
    - `OR: [{ tenantId: ctx.tenantId }, { userId: ctx.userId }]`
  - `src/app/api/gates/route.ts:191-199` decrypts and connects to the selected connection when `createTable` is enabled.
  - `src/app/api/gates/route.ts:211-222` then creates a gate in `ctx.tenantId`.
- Impact:
  - A multi-tenant user can create a gate in tenant B using a connection row from tenant A if the same `userId` owns it.
  - The server can decrypt and use tenant A's connection credentials while operating in tenant B.
  - With `createTable` enabled, this can issue DDL against a database connection that is not owned by the active tenant.
- Reproduction or reasoning:
  - User U owns connection C in tenant A.
  - User U switches to tenant B.
  - Submit `POST /api/gates` with `connectionId = C`.
  - The `userId` branch matches C, even though `tenantId` does not match `ctx.tenantId`.
- Minimal fix plan:
  1. Change the connection lookup to require `id: connectionId` and `tenantId: ctx.tenantId`.
  2. If legacy `tenantId: null` connections must be supported, add an explicit migration or claim flow instead of broad `OR userId`.
  3. Add an API test proving a tenant B gate cannot reference a tenant A connection owned by the same user.
- Whether fix is safe to automate:
  - Mostly yes if legacy null-tenant connections are not required. If legacy rows are in production, fix needs a backfill/claim decision first.

## P1 High Issues

### P1-1. Raven resume bypasses Bifrost MERGE/staging semantics and buffers all rows in memory

- File:
  - `src/lib/bifrost/engine.ts:545-557`, `src/lib/bifrost/engine.ts:763-789`
  - `src/lib/bifrost/jobs/raven-resume.handler.ts:74-80`
  - `src/lib/bifrost/jobs/raven-resume.handler.ts:131-160`
  - `src/lib/bifrost/jobs/raven-resume.handler.ts:209-221`
- Function/component:
  - `runBifrostRoute`
  - `resumeRavenRoute`
- Evidence:
  - The direct engine chooses a MERGE path at `src/lib/bifrost/engine.ts:545-557` when primary keys, incremental mode, and provider support are available.
  - The direct engine performs `mergeInto` at `src/lib/bifrost/engine.ts:763-789`.
  - Raven resume pushes every chunk into `allRows` at `src/lib/bifrost/jobs/raven-resume.handler.ts:74-80`.
  - Raven resume loads batches directly with `destProvider.load(destConn, batch, effectiveDestConfig)` at `src/lib/bifrost/jobs/raven-resume.handler.ts:131-160`.
  - Raven resume advances the watermark after that direct load at `src/lib/bifrost/jobs/raven-resume.handler.ts:209-221`.
- Impact:
  - Incremental Raven results can append duplicates where direct engine runs would have used MERGE.
  - `WRITE_TRUNCATE` routes inherit the destructive partial-load risk from P0-2.
  - Large agent responses can exhaust worker memory because all chunks are accumulated before loading.
  - Watermarks can advance after a load path that does not have the same correctness guarantees as the direct engine.
- Reproduction or reasoning:
  - Configure a Raven route with `cursorConfig.primaryKey` and a destination provider that supports `mergeInto`.
  - Have the agent return updates for existing primary keys.
  - Resume path appends or uses route write disposition directly instead of staging and merging, unlike the direct engine.
- Minimal fix plan:
  1. Extract a shared "finalize destination load" path used by both direct Bifrost and Raven resume.
  2. Preserve the direct engine's MERGE/staging decision for Raven results.
  3. Stream chunks or process bounded batches rather than accumulating all rows.
  4. Add tests covering Raven incremental updates, duplicate primary keys, multi-chunk outputs, and failed batch behavior.
- Whether fix is safe to automate:
  - Partially. A guard and tests are automatable; the shared loading abstraction should be done carefully because it touches the core data path.

### P1-2. Google Sheets connections can be saved without credentials that the provider requires

- File:
  - `src/app/(app)/connections/sheets/new/page.tsx:144-161`
  - `src/lib/validations/unified-connections.ts:147-193`
  - `src/lib/providers/google-sheets.provider.ts:25-28`
  - `src/lib/providers/google-sheets.provider.ts:67-92`
  - `src/lib/providers/google-sheets.provider.ts:113-116`
  - `src/app/api/connections/sheets/detect/route.ts:16-86`
- Function/component:
  - `NewGoogleSheetsConnectionPage`
  - `unifiedCreateConnectionSchema`
  - `GoogleSheetsProvider`
  - `POST /api/connections/sheets/detect`
- Evidence:
  - `src/app/(app)/connections/sheets/new/page.tsx:144-161` posts `name`, `type: "GOOGLE_SHEETS"`, and `config` to `/api/connections`; it does not send OAuth credentials or an account reference.
  - `src/lib/validations/unified-connections.ts:147-193` defines `GOOGLE_SHEETS` credentials as an empty object.
  - `src/lib/providers/google-sheets.provider.ts:25-28` requires `accessToken`, `refreshToken`, and `tokenExpiry`.
  - `src/lib/providers/google-sheets.provider.ts:67-92` refreshes and tests using those token fields.
  - `src/lib/providers/google-sheets.provider.ts:113-116` extracts sheets by calling `getValidToken(credentials)`.
  - `src/app/api/connections/sheets/detect/route.ts:16-86` reads and refreshes OAuth tokens from the NextAuth `Account`, but the saved `Connection` does not carry those provider credentials.
- Impact:
  - Detection can succeed during onboarding, while the saved connection later fails in workers or Bifrost because provider credentials are `{}`.
  - The credential ownership model is unclear: regular database/API credentials are encrypted on `Connection`, while Google OAuth tokens live on `Account` and are not available to the provider in worker context.
- Reproduction or reasoning:
  - Connect a Google account and detect a sheet.
  - Save the Google Sheets connection from the page.
  - Later provider use casts `{}` to `SheetsCredentials`; token expiry/refresh access is missing and extraction cannot authenticate.
- Minimal fix plan:
  1. Decide the credential model: encrypted refresh token on `Connection`, provider lookup by user/account context, or feature-gate Google Sheets until persistence is complete.
  2. If storing on `Connection`, encrypt the refresh token and minimal token metadata like other credentials.
  3. Add create/test/extract tests for saved Google Sheets connections and expired token refresh.
- Whether fix is safe to automate:
  - No. This needs an OAuth and credential storage decision before code changes.

### P1-3. Mjolnir blueprints are user-scoped while the rest of the product is tenant-scoped

- File:
  - `prisma/schema.prisma:362-380`
  - `src/app/api/mjolnir/blueprints/route.ts:14-56`
  - `src/app/api/reports/[id]/route.ts:70-75`
  - `src/app/api/bifrost/routes/route.ts:68-74`
  - `src/app/api/bifrost/routes/[id]/route.ts:76-82`
  - `src/app/(app)/mjolnir/page.tsx:9-21`
- Function/component:
  - `Blueprint` model
  - Mjolnir blueprint API
  - report and Bifrost route blueprint attachment
- Evidence:
  - `prisma/schema.prisma:362-380` defines `Blueprint` with `userId` but no `tenantId`.
  - `src/app/api/mjolnir/blueprints/route.ts:14-56` lists and creates blueprints by `userId`.
  - `src/app/api/reports/[id]/route.ts:70-75` verifies an attached blueprint by `{ id, userId }`.
  - `src/app/api/bifrost/routes/route.ts:68-74` and `src/app/api/bifrost/routes/[id]/route.ts:76-82` verify attached blueprints by `{ id, userId }`.
  - `src/app/(app)/mjolnir/page.tsx:9-21` renders all user blueprints regardless of active tenant.
- Impact:
  - Users can carry blueprint names, source schemas, transformations, recommendations, and sample file metadata across tenants.
  - A tenant-scoped report or Bifrost route can reference a blueprint created in another tenant by the same user.
  - This may be intentional as a personal library, but it conflicts with the rest of the tenant-scoped security model.
- Reproduction or reasoning:
  - User U creates a blueprint while active in tenant A.
  - User U switches to tenant B.
  - Mjolnir lists the same blueprint and APIs allow attaching it by ID to tenant B reports/routes because checks only require `userId`.
- Minimal fix plan:
  1. Confirm whether blueprints are meant to be tenant assets or personal assets.
  2. If tenant assets, add `tenantId`, backfill carefully, scope all list/create/attach operations by active tenant, and add composite indexes.
  3. If personal assets, document the intentional cross-tenant behavior and ensure blueprint content never contains tenant-sensitive samples.
- Whether fix is safe to automate:
  - No for schema changes. Needs product confirmation and a non-destructive migration/backfill.

### P1-4. Bifrost validation silently drops route fields and accepts invalid frequencies

- File:
  - `src/lib/validations/bifrost.ts:49-126`
  - `src/components/bifrost/route-editor.tsx:250-282`
  - `src/app/api/bifrost/routes/route.ts:87-101`
- Function/component:
  - `bifrostSourceConfigSchema`
  - `bifrostCreateRouteSchema`
  - `BifrostRouteEditor`
  - `POST /api/bifrost/routes`
- Evidence:
  - `src/lib/validations/bifrost.ts:49-57` allows source config keys such as `recordType`, `fields`, `filter`, and `objectSlug`, but not `referenceFields`.
  - `src/components/bifrost/route-editor.tsx:250-282` reads and submits `referenceFields`.
  - Zod object schemas strip unknown keys by default, so submitted `referenceFields` are silently discarded.
  - `src/lib/validations/bifrost.ts:92` and `src/lib/validations/bifrost.ts:121` define `frequency` as arbitrary `z.string().nullable().optional()`.
  - `src/app/api/bifrost/routes/route.ts:87-101` casts frequency into schedule calculation, so invalid API input can become a runtime 500 instead of validation feedback.
- Impact:
  - UI-selected reference fields may not persist, changing extraction behavior.
  - Invalid frequencies can pass validation and fail deeper in route creation/update.
  - The API is less type-aware than the UI and domain model.
- Reproduction or reasoning:
  - Submit a Bifrost route payload containing `sourceConfig.referenceFields`.
  - Validation succeeds, but the field is not retained in the parsed object.
  - Submit `frequency: "nonsense"` with scheduling enabled and route calculation can throw.
- Minimal fix plan:
  1. Add `referenceFields: z.array(z.string()).optional()` to the Bifrost source config schema.
  2. Replace `frequency: z.string()` with the explicit schedule frequency enum used by scheduling.
  3. Add API validation tests for `referenceFields` preservation and invalid frequency rejection.
- Whether fix is safe to automate:
  - Yes. This is a small validation-focused fix with straightforward tests.

## P2 Medium Issues

### P2-1. `PipelineWatermark.tenantId` exists but is never populated

- File:
  - `prisma/schema.prisma:1034-1047`
  - `src/lib/sync/watermark.ts:25-42`
  - `src/lib/bifrost/engine.ts:827-834`
  - `src/lib/bifrost/jobs/raven-resume.handler.ts:215-221`
- Function/component:
  - `PipelineWatermark`
  - `setWatermark`
  - Bifrost watermark advancement
- Evidence:
  - `prisma/schema.prisma:1034-1047` includes nullable `tenantId` and an index on it.
  - `src/lib/sync/watermark.ts:25-42` upserts watermark rows without setting `tenantId`.
  - `src/lib/bifrost/engine.ts:827-834` and `src/lib/bifrost/jobs/raven-resume.handler.ts:215-221` call `setWatermark` without tenant context.
- Impact:
  - Tenant-indexed watermark queries cannot work as intended.
  - Existing rows accumulate `tenantId: null`, making future tenant-scoped cleanup/admin features harder.
  - It is not a current leak because reads key by route/table, but it is a consistency and migration risk.
- Reproduction or reasoning:
  - Run a Bifrost route that advances a watermark.
  - Inspect `PipelineWatermark`; the row will not have `tenantId` populated by the current setter.
- Minimal fix plan:
  1. Extend `setWatermark` input to include `tenantId` or derive it from the route.
  2. Backfill existing rows from `BifrostRoute.tenantId`.
  3. Add a test proving the created/upserted watermark carries the route tenant.
- Whether fix is safe to automate:
  - Code change is safe. Backfill needs normal schema/data migration caution.

### P2-2. Dynamic App Router APIs still parse route params from `req.url`

- File:
  - `src/app/api/connections/[id]/route.ts:10-15`
  - `src/app/api/raven/jobs/[jobId]/claim/route.ts:6-8`
  - `src/app/api/raven/jobs/[jobId]/result/route.ts:6-8`
  - `src/app/api/tenants/[tenantId]/members/route.ts:10-12`
  - `src/lib/api.ts:16-48`
- Function/component:
  - Multiple dynamic API routes
  - `withAuth`
- Evidence:
  - `src/app/api/connections/[id]/route.ts:10-15` splits `url` on `/connections/`.
  - Raven job routes split on `/jobs/`.
  - `src/app/api/tenants/[tenantId]/members/route.ts:10-12` extracts path segment `[3]`.
  - `src/lib/api.ts:16-48` already forwards the App Router route context into handlers, so stable `params` are available for routes that choose to use them.
- Impact:
  - Fragile parsing can break under base path changes, rewrites, route nesting changes, or unexpected path suffixes.
  - Bugs here tend to become 404/500 behavior or accidental wrong-resource lookups.
- Reproduction or reasoning:
  - Add a base path, rewrite, or route layout that changes path shape.
  - Split-based parsing can return an incorrect ID while framework params would remain stable.
- Minimal fix plan:
  1. Migrate dynamic routes to the forwarded `routeContext.params`.
  2. Keep small route-specific validation for missing IDs.
  3. Add regression tests for at least the high-use dynamic routes.
- Whether fix is safe to automate:
  - Yes, but best done route-by-route to avoid accidental handler signature mistakes.

### P2-3. MSSQL destination load builds INSERT SQL strings instead of using driver parameters or bulk insert

- File:
  - `src/lib/providers/mssql.provider.ts:299-312`
- Function/component:
  - `MssqlProvider.load`
- Evidence:
  - `src/lib/providers/mssql.provider.ts:299-305` converts row values into SQL literal strings.
  - `src/lib/providers/mssql.provider.ts:309-312` executes the constructed `INSERT` statement.
  - Postgres and MySQL destination loaders use parameterized insert paths, so MSSQL is inconsistent.
- Impact:
  - Current escaping of single quotes lowers classic string-injection risk, but this is still brittle for dates, binary values, unicode, precision-sensitive values, and provider-specific literal syntax.
  - It is harder to prove safe and maintain than using `mssql.Table` bulk insert or request parameters.
- Reproduction or reasoning:
  - Load rows containing edge-case values such as binary, very long unicode, dates with timezone semantics, or decimal precision.
  - Literal conversion can corrupt values or fail differently than parameterized/bulk APIs.
- Minimal fix plan:
  1. Replace string-built inserts with `mssql.Table` bulk insert or parameterized batch inserts.
  2. Add tests for apostrophes, unicode, dates, nulls, decimals, and binary-like values.
- Whether fix is safe to automate:
  - Medium. The implementation is contained, but needs integration-style coverage against SQL Server behavior.

### P2-4. Email connection updates can create invalid auth configurations

- File:
  - `src/app/api/email-connections/[id]/route.ts:52-95`
  - `src/app/api/email-connections/[id]/test/route.ts:27-71`
- Function/component:
  - `PUT /api/email-connections/[id]`
  - `POST /api/email-connections/[id]/test`
- Evidence:
  - The update route conditionally changes fields such as `authType`, `smtpUser`, and `smtpPassword`, but does not revalidate the final stored configuration by auth type.
  - The test route decrypts and tests the stored configuration later, so invalid combinations are discovered at runtime.
- Impact:
  - Users can save an email connection with `authType = "PLAIN"` but missing username/password, or flip auth modes without the required companion fields.
  - This is not a tenant leak, but it creates broken scheduled delivery paths.
- Reproduction or reasoning:
  - Update an email connection from `NONE` to `PLAIN` without supplying a password.
  - The update can persist, while send/test later fails.
- Minimal fix plan:
  1. After merging update fields with the existing row, validate the complete final config.
  2. Return 400 with a specific validation message when auth-specific required fields are missing.
  3. Add tests for auth mode transitions.
- Whether fix is safe to automate:
  - Yes, if scoped to validation and tests.

## P3 Low Issues

### P3-1. Build/lint warnings remain in UI components

- File:
  - `src/app/layout.tsx:53`
  - `src/app/onboarding/onboarding-form.tsx:95`
  - `src/components/alfheim/connector-card.tsx:56`
  - `src/components/marketing/connector-grid.tsx:166`
  - `src/components/marketing/forge-visuals.tsx:233`
  - `src/components/user-menu.tsx:123`
  - `src/components/alfheim/wizard-credentials.tsx:70-71`
  - `src/components/alfheim/wizard-review.tsx:244`
  - `src/components/bifrost/cursor-config-panel.tsx:92`
  - `src/components/bifrost/route-editor.tsx:169`, `src/components/bifrost/route-editor.tsx:201`, `src/components/bifrost/route-editor.tsx:225`
  - `src/components/bifrost/sync-builder.tsx:323`, `src/components/bifrost/sync-builder.tsx:339`, `src/components/bifrost/sync-builder.tsx:409`
  - `src/components/gates/gate-detail.tsx:195`, `src/components/gates/gate-detail.tsx:243`, `src/components/gates/gate-detail.tsx:262`, `src/components/gates/gate-detail.tsx:306`
  - `src/components/gates/gate-wizard.tsx:697`
  - `src/components/mjolnir/forge-animation.tsx:196`
  - `src/components/reports/report-editor.tsx:145`
- Function/component:
  - Next lint/build warnings
- Evidence:
  - `npm run build` and `npm run lint` both complete successfully but report warnings for custom fonts, raw `<img>` elements, and missing React hook dependencies.
- Impact:
  - These are not currently production blockers.
  - Missing hook dependencies can become stale-state bugs, especially in route/gate editors.
  - Raw `<img>` usage can hurt performance and LCP.
- Reproduction or reasoning:
  - Run `npm run lint` or `npm run build`; warnings are emitted consistently.
- Minimal fix plan:
  1. Triage hook dependency warnings first because they can affect correctness.
  2. Replace raw images with `next/image` where layout constraints are known.
  3. Use Next font utilities for custom fonts or consciously suppress if the design system requires current behavior.
- Whether fix is safe to automate:
  - Partially. Hook dependency changes need behavior checks; image/font warning fixes are safer.

### P3-2. Connection credential handling looks mostly sound, but plaintext fallback should stay tightly controlled

- File:
  - `src/lib/crypto.ts:1-58`
  - `src/lib/providers/helpers.ts:21-59`
  - `src/app/api/connections/route.ts:34-115`
  - `src/app/api/connections/[id]/route.ts:41-173`
  - `src/app/api/connections/test/route.ts:13-52`
- Function/component:
  - Credential encryption/decryption helpers
  - Connection CRUD/test routes
- Evidence:
  - `src/lib/crypto.ts:12-58` uses AES-256-GCM with IV and auth tag, and validates a 32-byte base64 key.
  - `src/lib/providers/helpers.ts:21-59` decrypts credentials and only allows plaintext fallback outside production or when explicitly enabled.
  - Connection list/detail routes select safe fields and do not return encrypted credentials.
  - `src/app/api/connections/[id]/route.ts:114-119` only updates credentials when a `credentials` field is present, so normal updates do not erase credentials.
  - `src/app/api/connections/test/route.ts:13-52` tests unsaved credentials in memory and does not persist them.
- Impact:
  - No immediate credential leak was found here.
  - The fallback path is a policy risk if `HERMOD_ALLOW_PLAINTEXT_CREDENTIALS=true` is ever set in a real environment.
- Reproduction or reasoning:
  - Review of selects, update branches, and helper logs found connection type/status logging, but no decrypted credential logging.
- Minimal fix plan:
  1. Keep production plaintext fallback disabled.
  2. Consider adding a startup warning or hard failure if plaintext fallback is enabled outside local/test environments.
  3. Add regression tests ensuring connection API responses never include `credentials`.
- Whether fix is safe to automate:
  - Yes for tests and environment guardrails.

## Build/Test Results

Commands run from `C:\Users\JDelg\Hermod`:

1. `npx prisma validate`
   - Result: PASS
   - Exact result: `The schema at prisma\schema.prisma is valid 🚀`

2. `npx prisma generate`
   - Result: PASS
   - Exact result: `Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 765ms`

3. `npm run test`
   - Result: PASS
   - Exact result: `Test Files  63 passed (63)`, `Tests  1020 passed (1020)`, `Duration  13.59s`
   - Notes: test output includes expected provider/Bifrost stdout/stderr logs, but no failed tests.

4. `npm run build`
   - Result: PASS with warnings
   - Exact result: Next.js compiled successfully and generated static/dynamic route output.
   - Warnings:
     - Custom font warning in `src/app/layout.tsx:53`.
     - Raw `<img>` warnings in onboarding, Alfheim connector card, marketing connector grid, marketing forge visuals, and user menu.
     - React hook dependency warnings in Alfheim, Bifrost, Gates, Mjolnir, and report editor components.

5. `npm run lint`
   - Result: PASS with warnings
   - Exact result: same warning families as `npm run build`; no lint errors.

Additional repository status:

- The working tree was already dirty before this report was written. Existing modified/untracked files include package files, tests, API/lib changes, `.eslintrc.json`, and `src/lib/alfheim/catalog-admin.ts`.
- This audit did not attempt to clean up or revert unrelated changes.

## Fix Pass Results

Fix pass date: 2026-05-03

Scope: stabilization-only pass. Application behavior changes were limited to tenant isolation, destructive-load guards, validation tightening, and tenant metadata consistency. No schema migrations, UI styling changes, broad rewrites, or feature work were performed.

### Fixed Issues

#### P0-1. Server-rendered app pages leak tenant data through `userId`-only queries

- Files changed:
  - `src/lib/session.ts`
  - `src/app/(app)/connections/page.tsx`
  - `src/app/(app)/reports/page.tsx`
  - `src/app/(app)/schedules/page.tsx`
  - `src/app/(app)/history/page.tsx`
  - `src/app/(app)/dashboard/page.tsx`
  - `src/lib/dashboard/queries.ts`
  - `src/app/(app)/helheim/page.tsx`
  - `src/app/(app)/gates/page.tsx`
  - `src/app/(app)/gates/[gateId]/page.tsx`
  - `src/__tests__/dashboard-tenant-scope.test.ts`
- Summary of fix:
  - `requireAuth()` now requires an active tenant and redirects tenantless authenticated users to onboarding.
  - Tenant-owned server pages now use active `tenantId` alongside `userId` instead of `userId` alone or `OR tenantId/userId` fallbacks.
  - Dashboard query helper now accepts `tenantId` and scopes all route-backed counts/lists to `{ userId, tenantId }`.
- Why this fix is minimal:
  - It mirrors the existing API route scoping pattern without changing schemas or component contracts.
  - It does not attempt to resolve Mjolnir blueprint tenant ownership, which is a separate schema/product decision.
- Tests/commands run:
  - `npm run test -- src/__tests__/dashboard-tenant-scope.test.ts`
  - Focused suite bundle covering all fix tests.
  - Full validation commands listed below.
- Result:
  - Focused dashboard tenant-scope test passed.
  - Full test/build/lint validation passed.
- Remaining risk:
  - Mjolnir `Blueprint` remains user-scoped because fixing that safely needs a schema migration and product decision.
  - Historical rows with `tenantId: null` may need a planned backfill before stricter database constraints.

#### P0-2. Bifrost `WRITE_TRUNCATE` can leave production destination tables partially loaded

- Files changed:
  - `src/lib/bifrost/engine.ts`
  - `src/__tests__/bifrost/bifrost-engine.test.ts`
- Summary of fix:
  - Direct Bifrost execution now fails before loading when `WRITE_TRUNCATE` targets an existing destination table without the staged MERGE path.
  - New test asserts no destination load occurs for direct existing-table `WRITE_TRUNCATE`.
- Why this fix is minimal:
  - It uses the existing destination schema check and adds a guard rather than implementing provider-specific table swap logic.
  - First-load auto-create behavior is preserved when the table does not exist.
- Tests/commands run:
  - `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Focused Bifrost engine test passed.
  - Full validation passed.
- Remaining risk:
  - A full staged replace implementation is still needed for safe `WRITE_TRUNCATE` on existing tables.

#### P0-3. Realm Gate creation can use another tenant's connection credentials

- Files changed:
  - `src/app/api/gates/route.ts`
  - `src/__tests__/gates-api.test.ts`
- Summary of fix:
  - Gate creation now verifies the selected connection by `id` and active `tenantId` only.
  - Removed the `userId` fallback that allowed a same-user cross-tenant connection to be used.
- Why this fix is minimal:
  - Single query predicate change, no API shape change, and no gate model change.
- Tests/commands run:
  - `npm run test -- src/__tests__/gates-api.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Cross-tenant gate connection test passed.
  - Full validation passed.
- Remaining risk:
  - Legacy `tenantId: null` connection rows need an explicit claim/backfill flow if production still depends on them.

#### P1-1. Raven resume bypasses Bifrost MERGE/staging semantics and buffers all rows in memory

- Files changed:
  - `src/lib/bifrost/jobs/raven-resume.handler.ts`
  - `src/__tests__/bifrost/raven-resume.test.ts`
  - `src/lib/sync/types.ts`
  - `src/lib/sync/watermark.ts`
- Summary of fix:
  - Raven resume now fails before chunk assembly/load for `WRITE_TRUNCATE` routes.
  - Raven resume now fails before chunk assembly/load for incremental routes that require provider staged MERGE support.
  - Removed the now-unreachable "subsequent batches append after truncate" branch.
- Why this fix is minimal:
  - This is a protective guard, not the full shared-loader refactor. It prevents known corrupting paths without rewriting the worker pipeline.
- Tests/commands run:
  - `npm run test -- src/__tests__/bifrost/raven-resume.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Raven guard tests passed.
  - Full validation passed.
- Remaining risk:
  - Raven resume still buffers non-guarded result chunks in memory.
  - Raven resume still needs a shared staged MERGE loader to support incremental agent-backed routes instead of failing them.

#### P1-4. Bifrost validation silently drops route fields and accepts invalid frequencies

- Files changed:
  - `src/lib/validations/bifrost.ts`
  - `src/__tests__/bifrost/bifrost-validation.test.ts`
- Summary of fix:
  - Added `referenceFields` to `sourceConfig` validation so NetSuite reference selections persist.
  - Replaced arbitrary frequency strings with Prisma `ScheduleFrequency` validation.
- Why this fix is minimal:
  - Schema validation only; no route payload shape was removed or loosened.
- Tests/commands run:
  - `npm run test -- src/__tests__/bifrost/bifrost-validation.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Bifrost validation tests passed.
  - Full validation passed.
- Remaining risk:
  - Existing routes that already lost `referenceFields` will not regain them automatically.

#### P2-1. `PipelineWatermark.tenantId` exists but is never populated

- Files changed:
  - `src/lib/sync/types.ts`
  - `src/lib/sync/watermark.ts`
  - `src/lib/bifrost/engine.ts`
  - `src/lib/bifrost/jobs/raven-resume.handler.ts`
  - `src/__tests__/sync/watermark.test.ts`
- Summary of fix:
  - `setWatermark()` now accepts and writes `tenantId`.
  - Direct Bifrost and Raven resume now pass `route.tenantId` when advancing watermarks.
- Why this fix is minimal:
  - It uses the existing nullable column and does not alter the watermark unique key or schema.
- Tests/commands run:
  - `npm run test -- src/__tests__/sync/watermark.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Watermark tests passed.
  - Full validation passed.
- Remaining risk:
  - Existing watermark rows with `tenantId: null` still need a backfill if tenant-scoped admin/query features depend on the column.

#### P2-4. Email connection updates can create invalid auth configurations

- Files changed:
  - `src/app/api/email-connections/[id]/route.ts`
  - `src/__tests__/email-connections-api.test.ts`
- Summary of fix:
  - Update route now validates the merged final SMTP connection state before saving.
  - Auth mode changes to `PLAIN`/`OAUTH2` are rejected unless username and password are present after merge.
- Why this fix is minimal:
  - Reuses the existing create schema and preserves existing response shape.
- Tests/commands run:
  - `npm run test -- src/__tests__/email-connections-api.test.ts`
  - Focused suite bundle.
  - Full validation commands listed below.
- Result:
  - Email connection update test passed.
  - Full validation passed.
- Remaining risk:
  - Existing invalid saved rows, if any, are not repaired automatically.

### Intentionally Not Fixed

- P1-2 Google Sheets credential persistence: not fixed because the audit identifies a required OAuth credential-storage decision.
- P1-3 Mjolnir blueprint tenant ownership: not fixed because it requires schema design, migration, and product confirmation.
- P2-2 dynamic route URL parsing: not fixed in this pass to avoid a broad multi-route signature migration after the higher-risk security/data-loss fixes.
- P2-3 MSSQL string-built load inserts: not fixed because replacing with bulk/parameterized inserts needs SQL Server behavior coverage.
- P3 UI lint warnings: not fixed because they are lower priority and unrelated to the stabilization targets.

### Fix Pass Validation

- `npx tsc --noEmit --pretty false`: FAILED before final validation because of pre-existing test-only type errors unrelated to the touched runtime files, including backup validation test shape drift, Mjolnir `ParsedFileData.columnIndices`, NetSuite test casts, Raven `NextRequest` test inputs, and ExcelJS worksheet view type assertions.
- `npm run test -- src/__tests__/dashboard-tenant-scope.test.ts src/__tests__/bifrost/bifrost-engine.test.ts src/__tests__/gates-api.test.ts src/__tests__/bifrost/bifrost-validation.test.ts src/__tests__/sync/watermark.test.ts src/__tests__/email-connections-api.test.ts src/__tests__/bifrost/raven-resume.test.ts`: PASS, 7 files and 73 tests.
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS, Prisma Client v5.22.0 generated in 772ms.
- `npm run test`: PASS, 67 files and 1029 tests.
- `npm run build`: PASS with the same lint warning families already documented in this audit.
- `npm run lint`: PASS with the same lint warning families already documented in this audit.

## Suggested Fix Order

1. Decide and implement the Google Sheets OAuth credential model.
2. Decide whether Mjolnir blueprints are tenant-owned or personal. If tenant-owned, plan a careful migration.
3. Implement safe staged replace for existing-table `WRITE_TRUNCATE` instead of the current protective guard.
4. Align Raven resume loading with direct Bifrost MERGE/staging behavior and remove all-rows buffering.
5. Backfill historical `tenantId: null` rows, including `PipelineWatermark`.
6. Migrate dynamic App Router APIs from `req.url` parsing to framework params.
7. Replace MSSQL string-built destination inserts with parameterized or bulk insert APIs.
8. Address hook dependency warnings, then image/font warnings.

## Do Not Touch Yet

- Do not make schema changes for `Blueprint.tenantId` until the product decision is clear and a non-destructive migration/backfill is planned.
- Do not broadly rewrite Bifrost provider loading until `WRITE_TRUNCATE`, MERGE, staging, and Raven resume semantics are specified together.
- Do not change Google Sheets OAuth storage casually. Decide whether tokens belong on `Connection`, `Account`, or a dedicated encrypted credential table first.
- Do not remove legacy `tenantId: null` support until production data shape is known and a migration path exists.
- Do not clean up unrelated dirty worktree changes as part of these fixes.
