# Worker Operational Visibility

Date: 2026-05-11

## Scope

This pass added diagnostics only. It did not change backup business logic, Gate key hardening semantics, Mjolnir versioning semantics, or data loading behavior.

## Existing Capability Inventory

- `src/lib/worker.ts` remains the worker orchestrator for reports, Bifrost, Gate validation, Mjolnir pruning, and backup jobs.
- `src/lib/pg-boss.ts` is the canonical pg-boss singleton/started-client helper.
- `src/lib/gates/validation-timeouts.ts` remains the canonical Gate validation heartbeat and stale-timeout helper.
- `src/lib/worker-guardrails.ts` remains the canonical source for worker singleton keys, due-job filters, and stale-job thresholds.
- Gate validation worker code already logs safe start/stage/final status messages without row payloads or credentials.
- Backup and Bifrost worker handlers remain unchanged; this pass only improved health/status visibility around worker-driven work.

## Results

- `GET /api/system/worker-health` now returns safe queue groups for:
  - Gate validation
  - Scheduled reports
  - Bifrost routes and Raven resume
  - Backup and restore queues
- Queue metrics are best-effort through pg-boss `getQueueSize()`:
  - `pending`
  - `active`
  - `failedRecently` as `null` because pg-boss does not expose a bounded recent-failure count through the current helper.
- If pg-boss introspection is unavailable, the endpoint returns a safe payload with unavailable queue metrics and no raw database or credential error details.
- Production copy no longer tells users to run `npm run worker`.
- Development copy can still mention `npm run worker` where it is useful.
- Stale scheduled-route and backup timeout messages now point users/operators to worker health and logs instead of the older crash/hang wording.

## Safety Notes

- The health endpoint does not return credentials, connection strings, SQL configs, route configs, row payloads, backup object keys, or raw worker errors.
- No worker queue processing behavior changed.
- No Gate validation, KEY_DRIFT, UCC, DDL, Mjolnir, or data loading semantics changed.

## Tests Added

- `src/__tests__/system/worker-health.test.ts`
  - Safe worker health response with queue summaries.
  - Safe fallback when queue introspection fails.
  - Development copy differs from production copy.
  - Worker stuck copy does not mention local commands in production.

## Validation Results

- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 121 test files and 1459 tests.
- `npm run build`: passed with existing lint warnings.
- `npm run lint`: passed with existing warnings.
