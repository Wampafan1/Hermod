# Hermod Regression Guardrails Audit

## Existing Safety Nets

### Existing tests

Hermod already has a broad Vitest suite under `src/__tests__` covering core utilities, report execution, schedules, dashboard tenant scoping, query API behavior, SFTP/email API behavior, Raven jobs, Bifrost engine/validation/Helheim flows, provider registry/helpers/pool behavior, Mjolnir engines, backup validation/storage/provisioning/restore/engine flows, and some security helpers such as SSRF and query row limits.

Notable existing coverage:

- `src/__tests__/schedule-utils.test.ts` covers timezone-aware schedule math.
- `src/__tests__/query-api.test.ts` verifies query execution scopes connections by `userId` and `tenantId`, and returns safe query errors.
- `src/__tests__/dashboard-tenant-scope.test.ts` verifies dashboard queries remain tenant scoped.
- `src/__tests__/backups/validation.test.ts` covers PostgreSQL backup policy validation, PostgreSQL database/server connection scopes, tenant-scoped backup references, and restore target validation.
- `src/__tests__/backups/storage-api.test.ts` covers storage target credential redaction, update credential preservation, unsaved storage tests, and delete protections.
- `src/__tests__/backups/storage/object-keys.test.ts` covers some object-key layout behavior.
- `src/__tests__/backups/mssql-backups.test.ts` and related backup tests cover MSSQL backup helpers and flows.
- `src/__tests__/providers/sql-providers.test.ts`, `src/__tests__/providers/helpers.test.ts`, and `src/__tests__/providers/pool-manager.test.ts` cover provider behavior without hitting live databases.
- `src/__tests__/worker-shutdown.test.ts` covers shutdown cleanup avoiding unrelated in-flight log updates.

### Existing scripts

`package.json` defines:

- `npm run dev` for Next.js development.
- `npm run worker` for the pg-boss worker.
- `npm run build` for production build.
- `npm run test` / `npm run test:watch` for Vitest.
- `npm run lint` for Next lint.
- `npm run db:generate`, `npm run db:push`, `npm run db:migrate`, and `npm run db:seed` for Prisma workflows.

There is not yet a `check:secrets` script.

### Existing validation schemas

Validation is grouped under `src/lib/validations`.

- `src/lib/validations/unified-connections.ts:19` defines PostgreSQL and MSSQL `DATABASE` / `SERVER` scope enums.
- `src/lib/validations/unified-connections.ts:183` defines `createConnectionSchema`, with type-specific config and credential schemas.
- `src/lib/validations/unified-connections.ts:199` defines `updateConnectionSchema`, intentionally loose with type-aware validation performed in the route.
- `src/lib/validations/backup-storage.ts:25` validates storage prefixes and rejects absolute paths, `..`, and shell metacharacters.
- `src/lib/validations/backup-storage.ts:97` validates storage target create payloads and required AWS/GCP credential modes.
- `src/lib/validations/backups.ts:49` validates PostgreSQL backup policies, database selection modes, WAL replication slot requirements, and restore options.
- `src/lib/validations/mssql-backups.ts:80` validates SQL Server backup policy creation, destination mode requirements, and database selection.
- `src/lib/validations/bifrost.ts` validates Bifrost route create/update payloads, destination config, source config, schedule fields, and cursor config.

### Existing auth wrappers

- `src/lib/api.ts:27` provides `withAuth(handler, options)`.
- `src/lib/api.ts:34` returns `401` for unauthenticated requests.
- `src/lib/api.ts:37` returns `403` when the user has no active tenant.
- `src/lib/api.ts:40` enforces `minimumRole` through `hasRole`.
- `src/lib/auth-helpers.ts:33` defines the role hierarchy used by `withAuth`.
- `src/lib/auth.ts:43` attaches active tenant membership and role to the NextAuth session.

Most API routes use `withAuth`, and many critical routes scope queries by both `userId` and `tenantId`.

### Existing CI config

No GitHub Actions workflow is present under `.github/workflows`.

### Existing Prisma validation/generation workflow

Prisma scripts exist in `package.json`:

- `npm run db:generate` runs `prisma generate`.
- `npm run db:migrate` runs `prisma migrate dev`.
- `npm run db:push` runs `prisma db push`.

There is no CI workflow currently running `npx prisma validate` or `npx prisma generate`.

## Missing Safety Nets

1. Auth and tenant isolation

   Existing route code frequently scopes by `{ userId, tenantId }`, but there is no dedicated regression suite for `withAuth` behavior, role enforcement, or destructive-operation role boundaries across connections, Bifrost, backups, restores, and storage targets.

2. Credential encryption and response redaction

   Some tests cover storage targets, but connections, provider helpers, logs/errors, and static route patterns need broader tests. `src/app/api/connections/route.ts:48` encrypts credentials on create, and `src/app/api/connections/[id]/route.ts:111` only updates credentials when provided; both need explicit regression tests.

3. Provider behavior

   PostgreSQL and MSSQL server/database scope behavior is implemented in `src/lib/providers/postgres.provider.ts:315` and `src/lib/providers/mssql.provider.ts:59`, but scope-specific guardrails should be grouped under provider safety tests.

4. Bifrost route execution and logs

   Manual route execution locks are created in `src/app/api/bifrost/routes/[id]/run/route.ts:32`, but route log JSON currently returns raw `RouteLog` rows from `src/app/api/bifrost/routes/[id]/logs/route.ts:47`. Because `RouteLog.bytesTransferred` is a `BigInt`, this route can fail JSON serialization if that field is present.

5. Worker scheduling and singleton jobs

   Worker singleton keys are hard-coded in `src/lib/worker.ts:190`, `src/lib/worker.ts:232`, `src/lib/worker.ts:278`, `src/lib/worker.ts:327`, `src/lib/worker.ts:375`, `src/lib/worker.ts:424`, and `src/lib/worker.ts:473`. There is no focused regression test ensuring keys are stable and non-overlapping across report, route, Postgres backup, MSSQL backup, and restore jobs.

6. Backup object-key layout, storage targets, and restore metadata

   Backup object-key helpers exist in `src/lib/backups/storage/object-keys.ts:57` and `src/lib/backups/storage/path-utils.ts:10`, but guardrails should explicitly pin PostgreSQL database-centered keys, server-level WAL keys, MSSQL database-centered keys, prefix normalization, and manifest keys.

7. API validation contracts

   Zod validation exists, but critical response shapes are not contract-tested consistently. Connection list/detail, Bifrost route/log, storage target, policy, run, and restore responses need tests that fail when required UI fields disappear or credentials appear.

8. UI/API response shape mismatches

   Components under `src/components/bifrost`, `src/components/connections`, and `src/components/backups` depend on route response fields, but there are no central response contract tests to catch backend/frontend drift.

9. Prisma schema validity

   `prisma/schema.prisma` is large and includes recent backup, restore, Raven, and Bifrost additions. CI does not currently run `npx prisma validate`.

10. Build/type/lint/test commands

   `npm run build`, `npm run test`, and `npm run lint` exist, but they are not enforced by CI. Lint was recently added to dependencies in the dirty worktree, so it should be validated before making lint blocking in CI.

## Highest Risk Untested Areas

- `src/lib/api.ts:27` / `withAuth`: needs direct tests for `401`, `403`, minimum role enforcement, and role hierarchy boundaries.
- `src/app/api/connections/route.ts:9` and `src/app/api/connections/[id]/route.ts:31`: need credential redaction and tenant-scope route tests for list/detail/create/update/delete.
- `src/app/api/connections/[id]/route.ts:94`: `if (credentials)` skips type-aware validation for empty credential objects, while `credentials !== undefined` at `src/app/api/connections/[id]/route.ts:111` can still encrypt them. Tests should lock expected update behavior.
- `src/lib/providers/helpers.ts:9`: decrypts credentials and allows plaintext fallback outside production; tests should ensure decrypted values are only returned server-side and invalid encrypted credentials are safe.
- `src/app/api/bifrost/routes/[id]/logs/route.ts:47`: raw log response can expose unserializable BigInt values from `bytesTransferred`.
- `src/app/api/bifrost/routes/[id]/run/route.ts:32`: manual run locking should stay atomic and should remain tenant scoped.
- `src/lib/worker.ts:150`: scheduler tick logic is monolithic, which makes due filters, stale thresholds, singleton keys, and safe errors hard to test without small helper extraction.
- `src/lib/worker.ts:190`, `src/lib/worker.ts:232`, `src/lib/worker.ts:278`, `src/lib/worker.ts:327`, `src/lib/worker.ts:375`, `src/lib/worker.ts:424`, `src/lib/worker.ts:473`: singleton keys should be centralized and tested.
- `src/lib/backups/api-helpers.ts:226`: restore reference validation is critical; tests should pin same-source protection, object-key lookup, target type rejection, and confirmation phrase behavior.
- `src/app/api/backups/restores/route.ts:38`: restore list is tenant scoped but not user scoped; that may be intentional for tenant admins, but it needs a contract test and an explicit decision.
- `src/app/api/backups/policies/[id]/route.ts:202` and `src/app/api/backups/mssql/policies/[id]/route.ts:149`: update responses return raw policy rows, so contract tests should catch any BigInt/date/shape issues.
- `src/lib/backups/storage/object-keys.ts:57` and `src/lib/backups/storage/path-utils.ts:10`: object-key path traversal and database/server name sanitization are high-risk because paths drive cloud storage layout.
- `src/lib/backups/mssql/mssql-backup-sql.ts:15`: SQL identifier/string quoting should stay pinned with injection-oriented tests.
- `src/lib/providers/postgres.provider.ts:315` and `src/lib/providers/mssql.provider.ts:59`: server-scoped connection behavior should stay pinned for backup database discovery.
- `src/lib/providers/pool-manager.ts:32`: provider pool keys should include host, port, database/maintenance database, username, and credential-influencing values.

## Guardrails Added

1. Test infrastructure

   Files added/changed:

   - `src/__tests__/helpers/factories.ts`
   - `src/__tests__/helpers/mock-auth.ts`
   - `src/__tests__/helpers/mock-prisma.ts`
   - `src/__tests__/helpers/api-test.ts`

   Behavior protected:

   - Provides deterministic user, tenant, membership, connection, Bifrost route/log, storage target, backup policy, backup run, and restore job fixtures.
   - Provides reusable auth/session and Prisma mocks so API tests do not touch live databases or external services.

   Verification:

   - `npm run test`

2. Validation regression tests

   Files added/changed:

   - `src/__tests__/validations/critical-validation.test.ts`

   Behavior protected:

   - Database-scoped PostgreSQL and MSSQL connections remain backward compatible.
   - Server-scoped PostgreSQL and MSSQL connections validate without an application database where intended.
   - Missing required credentials are rejected.
   - Storage target prefixes reject absolute paths, traversal, and unsafe shell characters.
   - Backup policy, storage target, and restore update schemas preserve optional update behavior.

   Verification:

   - `npm run test`

3. Credential redaction and secret-safe errors

   Files added/changed:

   - `src/__tests__/security/credentials.test.ts`
   - `src/lib/secret-redaction.ts`
   - `src/lib/async-utils.ts`
   - `src/lib/bifrost/helheim/dead-letter.ts`
   - `src/lib/connections/api-helpers.ts`
   - `src/lib/credential-response.ts`
   - `src/app/api/connections/route.ts`
   - `src/app/api/connections/[id]/route.ts`
   - `src/app/api/email-connections/route.ts`
   - `src/app/api/email-connections/[id]/route.ts`
   - `src/app/api/sftp-connections/route.ts`
   - `src/app/api/sftp-connections/[id]/route.ts`

   Behavior protected:

   - Connection create encrypts credentials before storage.
   - Connection list/detail responses omit credentials.
   - Email and SFTP connection list/detail/update responses omit encrypted credential material.
   - Storage target list and unsaved-test behavior remain credential-safe.
   - Connection update without credentials preserves existing encrypted credentials.
   - Provider helpers decrypt only in server-side helper paths.
   - Error formatting redacts obvious secret key/value pairs such as `password`, `secretAccessKey`, `accessKeyId`, `serviceAccountKey`, `private_key`, `client_email`, `tokenSecret`, `consumerSecret`, `refresh_token`, and `PGPASSWORD`.

   Verification:

   - `npm run test`
   - `npm run check:secrets`

4. Auth and tenant isolation tests

   Files added/changed:

   - `src/__tests__/security/tenant-isolation.test.ts`

   Behavior protected:

   - `withAuth` returns `401` for unauthenticated users.
   - `withAuth` returns `403` for authenticated users without an active tenant.
   - Minimum role checks reject lower-privilege users.
   - Connections are read and updated only through `{ userId, tenantId }` scopes.
   - Bifrost routes are updated and deleted only through tenant-scoped queries.

   Verification:

   - `npm run test`

5. API contract tests and BigInt-safe Bifrost logs

   Files added/changed:

   - `src/__tests__/contracts/api-contracts.test.ts`
   - `src/lib/bifrost/api-helpers.ts`
   - `src/app/api/bifrost/routes/[id]/logs/route.ts`

   Behavior protected:

   - Connection, Bifrost route, route log, storage target, backup policy, backup run, and restore job response shapes are pinned with Zod contracts.
   - Credentials are asserted absent from API contract outputs.
   - Date fields remain serializable.
   - Bifrost route log `bytesTransferred` values are serialized safely instead of returning raw `BigInt` values through `NextResponse.json`.

   Verification:

   - `npm run test`
   - `npm run build`

6. Backup storage, target, coverage, and restore tests

   Files added/changed:

   - `src/__tests__/backups/storage/object-keys.test.ts`
   - `src/__tests__/backups/storage/storage-targets.test.ts`
   - `src/__tests__/backups/coverage.test.ts`
   - `src/__tests__/backups/restore-validation.test.ts`

   Behavior protected:

   - MSSQL object keys stay database-centered.
   - PostgreSQL full logical keys stay under `databases/<database>/full-logical`.
   - PostgreSQL WAL keys stay server-level under `wal/`.
   - Prefix normalization, database/server name sanitization, empty prefixes, manifest keys, and traversal rejection are pinned.
   - Storage target provider resolution selects AWS/GCP correctly.
   - Unsaved storage target tests do not persist credentials.
   - Saved storage targets do not return credentials.
   - Generated AWS/GCP provisioning commands do not include secrets.
   - Backup coverage status mapping covers `NEVER_RUN`, `HEALTHY`, `DEGRADED`, `FAILED`, and MSSQL `UNSUPPORTED`.
   - Restore validation rejects incompatible target types and same-source restores without explicit confirmation, and pins stored `objectKey` usage.

   Verification:

   - `npm run test`

7. Worker scheduling guardrails

   Files added/changed:

   - `src/__tests__/worker/worker-guardrails.test.ts`
   - `src/lib/worker-guardrails.ts`
   - `src/lib/worker.ts`
   - `src/app/api/backups/restores/route.ts`

   Behavior protected:

   - Due schedule filters require enabled schedules and `nextRunAt <= now`.
   - `nextRunAt` advancement remains ordered before pg-boss enqueue calls.
   - Singleton keys are centralized and stable across report, Bifrost route, PostgreSQL backup, MSSQL backup, and restore jobs.
   - Stale running log thresholds are explicit and testable.
   - Job kinds do not overlap for the same ID.

   Verification:

   - `npm run test`

8. Provider safety tests

   Files added/changed:

   - `src/__tests__/providers/guardrails.test.ts`
   - `src/lib/providers/mssql.provider.ts`

   Behavior protected:

   - PostgreSQL provider connection config uses the selected database for database scope and a maintenance database for server scope.
   - MSSQL provider exposes and tests effective database selection for database/server scope.
   - SQL identifier quoting helpers resist quote/bracket injection.
   - MSSQL backup SQL quotes database names safely.
   - Pool keys include connection identity details.
   - Provider credential helpers tolerate absent optional credentials until an operation requires them.

   Verification:

   - `npm run test`

9. CI guardrails

   Files added/changed:

   - `.github/workflows/ci.yml`

   Behavior protected:

   - CI runs on Node 20.
   - Blocking job runs `npm ci`, `npx prisma validate`, `npx prisma generate`, `npm run test`, `npm run check:secrets`, and `npm run build`.
   - Lint runs in a separate non-blocking job because the current repo has existing warning noise that should be cleaned up deliberately before making lint blocking.

   Verification:

   - Local equivalents were run in final validation.

10. Static credential leak scanner

    Files added/changed:

    - `scripts/check-no-credential-responses.ts`
    - `package.json`

    Behavior protected:

    - Flags strong credential-response smells in API route files, including raw credential selects followed by raw JSON responses, direct raw connection/target responses, and console logging of credential-like names.
    - Keeps the check lightweight and heuristic so it catches likely leaks without replacing code review or response contract tests.

    Verification:

    - `npm run check:secrets`

11. Guardrail documentation

    Files added/changed:

    - `docs/testing-and-guardrails.md`
    - `docs/audits/hermod-regression-guardrails.md`

    Behavior protected:

    - Documents how to run the guardrail suite, how to add validation/API contract tests, how to safely test credentials, how to use auth/Prisma mocks, what CI protects, and what not to do.

    Verification:

    - Documentation review during this pass.

## Validation Results

- `npx prisma validate`: passed. Prisma schema loaded from `prisma/schema.prisma`; schema is valid.
- `npx prisma generate`: passed. Prisma Client generated successfully.
- `npm run test`: passed. Vitest reported 76 test files and 1101 tests passing.
- `npm run check:secrets`: passed. Credential response scan reported no strong matches.
- `npm run build`: passed. Next compiled, type-checked, generated static pages, and completed production build.
- `npm run lint`: passed with existing warnings. Warnings include font loading, `<img>` usage, and React hook dependency warnings in existing UI components.

## Remaining Gaps

- No live database or live cloud provider integration tests were added. This was intentional for deterministic guardrails, but a separate opt-in integration suite would still be useful for provider compatibility.
- Worker coverage now pins extracted scheduling and singleton helpers, but `src/lib/worker.ts` remains a large orchestration module. Further decomposition would make end-to-end worker behavior easier to test without mocks.
- The static credential scanner is heuristic. It catches strong response/logging smells but cannot prove every dynamic serialization path is credential-safe.
- Lint is non-blocking in CI until the existing warning baseline is cleaned up and intentionally made blocking.
- UI/API drift is covered through API response contracts, but there are no browser/e2e tests asserting the Bifrost, connections, backups, and restore screens render those contracts successfully.
- SFTP create intentionally returns a generated one-time password. Follow-up tests should continue to distinguish that explicit one-time secret from ordinary list/detail/update response redaction.
- Restore checksum failure behavior is covered by restore engine tests; the new restore validation guardrails avoid reconstructing paths and same-source mistakes but do not exercise a full restore command path against real storage.
