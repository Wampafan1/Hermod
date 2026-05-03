# Hermod Critical Convergence Audit

Audit date: 2026-05-03

Scope: convergence pass after the prior code scrub and stabilization commit `5d97eef`. This pass intentionally did not run a broad fresh audit. It verified the previously reported P0 Critical issues, checked for new issues only under the requested critical severity rule, and ran the required validation commands against the current checkout.

Repository state note: `master` and `origin/master` both point at `5d97eef Fix Hermod audit stabilization issues`. The working tree still contains unrelated uncommitted changes in package files, backup/API/security files, and tests. This report does not classify those broad dirty changes as critical without a concrete reproduction.

## Executive Summary

- Current P0 count: 0
- Previous P0 count: 3
- Fixed P0 count: 2 fully fixed, plus P0-1's confirmed critical tenant-owned page leaks fixed
- Downgraded/false positive count: 1 residual subfinding from P0-1, Mjolnir blueprint tenant ownership, downgraded because tenant ownership is not established by the current schema/product model
- New confirmed P0 count: 0
- Build/test status: PASS. `prisma validate`, `prisma generate`, `npm run test`, `npm run build`, and `npm run lint` pass. `prisma generate` first hit the known Windows Prisma DLL lock, then passed after moving `node_modules/.prisma` aside per repo instructions.
- Recommendation: STOP broad critical-pass churn. Move to targeted audits for remaining P1/P2 areas such as Mjolnir ownership, Google Sheets credential persistence, safe staged replace for `WRITE_TRUNCATE`, Raven resume support, and backup UX hardening.

Critical-risk conclusion: the previously confirmed P0 auth/tenant/data-loss paths are closed or guarded. No confirmed credential leak, auth bypass, tenant data leak, destructive data-loss path, production build failure, schema startup failure, unbounded destructive worker behavior, or wrong-target backup/restore behavior was reproduced in this pass.

## P0 Closure Matrix

| Issue ID | Prior title | Prior file | Status | Evidence | Verification command/test | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| P0-1 | Server-rendered app pages leak tenant data through `userId`-only queries | `src/lib/session.ts`; `src/app/(app)/connections/page.tsx`; `src/app/(app)/reports/page.tsx`; `src/app/(app)/schedules/page.tsx`; `src/app/(app)/history/page.tsx`; `src/app/(app)/dashboard/page.tsx`; `src/lib/dashboard/queries.ts`; `src/app/(app)/helheim/page.tsx`; `src/app/(app)/mjolnir/page.tsx` | PARTIALLY FIXED, with no remaining confirmed P0 | `requireAuth()` now requires `session.user.tenantId` and redirects tenantless sessions at `src/lib/session.ts:18-26`. Connections, reports, schedules, history, dashboard, and Helheim now use active-tenant predicates: `src/app/(app)/connections/page.tsx:11-46`, `src/app/(app)/reports/page.tsx:11-23`, `src/app/(app)/schedules/page.tsx:10-17`, `src/app/(app)/history/page.tsx:11-30`, `src/app/(app)/dashboard/page.tsx:11-13`, `src/lib/dashboard/queries.ts:69-173`, `src/app/(app)/helheim/page.tsx:11-38`. | `npm run test -- src/__tests__/dashboard-tenant-scope.test.ts` during fix pass; full `npm run test`; `npm run build`. | The remaining Mjolnir path is still user-scoped at `src/app/(app)/mjolnir/page.tsx:9-10` and `prisma/schema.prisma:362-380`, but the schema has no `Blueprint.tenantId`, so this is downgraded to a product/schema ownership decision rather than an open P0. |
| P0-2 | Bifrost `WRITE_TRUNCATE` can leave production destination tables partially loaded | `src/lib/bifrost/engine.ts`; provider `load()` methods | FIXED as a protective guard | The direct engine computes the MERGE/staging path at `src/lib/bifrost/engine.ts:545-552`, then rejects existing-table direct `WRITE_TRUNCATE` before destination loads at `src/lib/bifrost/engine.ts:566-570`. The prior truncating provider paths remain provider capabilities, but this confirmed engine path no longer reaches them for existing destination tables without staging. | `npm run test -- src/__tests__/bifrost/bifrost-engine.test.ts` during fix pass; full `npm run test`; `npm run build`. Test evidence: `src/__tests__/bifrost/bifrost-engine.test.ts:329-353` asserts the existing-table direct truncate path fails before load. | This is a stopgap, not full staged replace support. Safe `WRITE_TRUNCATE` for existing tables should be implemented later as a targeted P1/P2 design. |
| P0-3 | Realm Gate creation can use another tenant's connection credentials | `src/app/api/gates/route.ts` | FIXED | Gate creation now verifies the selected connection by `id` and active `tenantId` only at `src/app/api/gates/route.ts:127-133`. The prior `OR [{ tenantId }, { userId }]` fallback is gone, so same-user cross-tenant connections are not accepted for gate setup. | `npm run test -- src/__tests__/gates-api.test.ts` during fix pass; full `npm run test`; `npm run build`. Test evidence: `src/__tests__/gates-api.test.ts:88-100` asserts tenant-only lookup. | Legacy `tenantId: null` connections may still need an explicit migration/claim flow, but that is not a confirmed current P0. |

## Remaining Confirmed P0 Critical Issues

None.

This pass did not find a confirmed P0 under the requested rule. In particular:

- Credential response scan: connection and email connection APIs select safe fields and do not return encrypted credentials at `src/app/api/connections/route.ts:9-27`, `src/app/api/connections/[id]/route.ts:17-46`, `src/app/api/email-connections/route.ts:7-25`, and `src/app/api/email-connections/[id]/route.ts:76-92`. Backup storage targets serialize without credentials at `src/lib/backups/api-helpers.ts:146-149`.
- Auth scan: normal app APIs use `withAuth()` from `src/lib/api.ts:27-60`; Raven machine routes use `withRavenAuth()` from `src/lib/raven/auth.ts:25-95`; Stripe webhook verifies signatures at `src/app/api/stripe/webhook/route.ts:15-37`; Stripe checkout and portal use server `requireAuth()` at `src/app/api/stripe/checkout/route.ts:14-16` and `src/app/api/stripe/portal/route.ts:7-11`.
- Backup/restore scan: restore creation validates policy, backup run, target connection, target database, and confirmation phrase at `src/lib/backups/api-helpers.ts:248-322`; logical restore verifies target type/checksum before `pg_restore` at `src/lib/backups/postgres/postgres-restore-engine.ts:271-305`; physical PITR mode writes a preparation manifest rather than overwriting a database at `src/lib/backups/postgres/postgres-restore-engine.ts:350-455`.
- Worker scan: scheduler ticks are single-flight guarded at `src/lib/worker.ts:492-503`; due jobs use singleton keys for reports, Bifrost routes, and backup jobs at `src/lib/worker.ts:185-196`, `src/lib/worker.ts:226-235`, `src/lib/worker.ts:261-283`, `src/lib/worker.ts:310-332`, and `src/lib/worker.ts:358-478`.

## Downgraded Issues

### D-1. Mjolnir blueprints are user-scoped, not tenant-scoped

- Why it was downgraded:
  - The prior P0-1 grouped Mjolnir with tenant-owned page leaks. Current code still lists Mjolnir blueprints by `userId` only at `src/app/(app)/mjolnir/page.tsx:9-10`, and the `Blueprint` model has `userId` but no `tenantId` at `prisma/schema.prisma:362-380`.
  - API attachment checks also use `userId` ownership at `src/app/api/reports/[id]/route.ts:69-73`, `src/app/api/bifrost/routes/route.ts:67-72`, and `src/app/api/bifrost/routes/[id]/route.ts:76-79`.
  - However, because the schema itself models blueprints as user-owned assets and not tenant-owned assets, this is not a confirmed tenant data leak unless the product decision says blueprints must be tenant assets. Under the requested severity rule, product ambiguity and tenant/user scoping concern without established tenant ownership should not remain P0.
- Correct severity:
  - P1 if blueprints contain tenant-sensitive schemas/samples and are intended to be tenant-owned.
  - P2 if blueprints are intended as a personal cross-tenant library but need documentation and privacy boundaries.
- Whether it still needs work:
  - Yes. Decide the ownership model. If tenant-owned, add `tenantId` with a safe migration/backfill and scope list/create/attach APIs. If personal, document the behavior and prevent tenant-sensitive samples from being retained unexpectedly.

## Validation Results

Commands run from `C:\Users\JDelg\Hermod`:

1. `npx prisma validate`
   - Result: PASS
   - Exact result: `The schema at prisma\schema.prisma is valid`

2. `npx prisma generate`
   - Initial result: FAILED due local Windows DLL lock
   - Exact failure: `EPERM: operation not permitted, rename 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node.tmp395360' -> 'C:\Users\JDelg\Hermod\node_modules\.prisma\client\query_engine-windows.dll.node'`
   - Action taken: moved `node_modules\.prisma` to `node_modules\.prisma_old_20260503080442`, matching the repo's documented Windows workaround. No source files were changed.
   - Rerun result: PASS
   - Exact result: `Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 817ms`

3. `npm run test`
   - Result: PASS
   - Exact result: `Test Files 67 passed (67)`, `Tests 1029 passed (1029)`, `Duration 8.01s`
   - Notes: output includes expected test stderr/stdout for simulated provider failures, Bifrost load failures, Raven guard failures, and retry behavior.

4. `npm run build`
   - Result: PASS with warnings
   - Exact result: Next.js compiled successfully, type/lint phase completed, and static generation completed with `Generating static pages (107/107)`.
   - Warnings:
     - Custom font warning at `src/app/layout.tsx:53`.
     - Raw `<img>` warnings in onboarding, Alfheim, marketing, and user menu components.
     - React hook dependency warnings in Alfheim, Bifrost, Gates, Mjolnir, and report editor components.

5. `npm run lint`
   - Result: PASS with warnings
   - Exact result: `next lint` completed with the same warning families listed for the build.

## Stop/Continue Recommendation

Recommendation: STOP broad critical convergence passes.

The current P0 count is zero, the previous confirmed critical paths are closed or guarded, and the required validation suite passes. Another broad audit is likely to recreate noise by re-labeling product decisions and theoretical risks as critical.

Continue with targeted audits only:

1. Mjolnir blueprint ownership and retention.
2. Google Sheets OAuth credential persistence.
3. Full staged replace design for existing-table `WRITE_TRUNCATE`.
4. Raven resume support for staged MERGE and bounded chunk processing.
5. Backup/restore UX and destructive-confirmation ergonomics.
6. Existing lint warning families, especially hook dependency warnings.
