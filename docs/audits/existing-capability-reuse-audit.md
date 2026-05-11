# Existing Capability Reuse Audit

Targeted audit date: 2026-05-11

Scope:

- This is a targeted duplicate/parallel-logic audit.
- No backup runtime code was changed; backup files were inspected only to inventory existing helper reuse.
- No Next.js framework changes were made.
- No broad critical audit or large refactor was performed.

Searches run:

- UCC/key discovery: `discoverUCCs`, `discoverGateKeyCandidates`, `validateSelectedGateKey`, `preflightUpsertKey`, `prepareMappedRowsForPush`, `candidateKeys`, `UCC`.
- SQL identifiers and DDL: `quoteSqlIdentifier`, `fullSqlTableRef`, `quoteIdentifier`, `ALTER TABLE`, `DROP CONSTRAINT`, `PRIMARY KEY`, `UNIQUE INDEX`.
- Auth/tenant and version attach: `withAuth`, `session.tenantId`, `validateOptionalAttachableBlueprintVersion`, report/Bifrost/RealmGate attach helpers.
- File analysis: `analyzeFile`, `skipUCC`, `createAnalyticsSession`, `loadCSV`, `loadExcel`, `parseExcelBuffer`.
- Temp cleanup and stale work: `saveTempFile`, `readTempFile`, `deleteTempFile`, `runWithGateValidationHeartbeat`, `markStaleGatePushValidationFailed`, `staleStartedBefore`.
- Retention/redaction and storage paths: `sanitizeBlueprintCreatePayload`, `redactSampleValue`, `buildBackupObjectKey`, `buildManifestObjectKey`, object-key/path builders.

## Findings

| Area | Existing canonical helper | Duplicate/parallel code | Risk | Recommended action | Safe to fix now |
| --- | --- | --- | --- | --- | --- |
| UCC/key discovery | `src/lib/duckdb/file-analyzer.ts` `analyzeFile()`, `src/lib/ucc/discovery.ts` `discoverUCCs()`, and `src/lib/gates/gate-ucc-discovery.ts` `discoverGateKeyCandidates()` | `src/lib/gates/key-discovery.ts` still contains `discoverUniqueColumnCombinations()` and ranking/no-key messaging from the older Gate-only finder. Current Gate KEY_DRIFT uses the UCC adapter, but tests and manual validation still import pieces from this file. | High if someone reuses `discoverUniqueColumnCombinations()` as a primary finder and bypasses UCC again. | Treat `key-discovery.ts` as types, deterministic ranking, recommendation shaping, and manual selected-key validation only. New automatic candidate discovery must go through `discoverGateKeyCandidates()` or `discoverUCCs()`. Consider a future cleanup that renames or splits the old finder so it cannot be mistaken for canonical discovery. | No. Removing or renaming would touch many Gate tests and review flows. |
| Gate push prep and current-key preflight | `src/lib/gates/push-executor.ts` `prepareMappedRowsForPush()`, `preflightUpsertKey()`, `isFullyBlankMappedRow()`, `resolvePrimaryKeyDestinationColumns()` | Resolve routes and tests correctly call these helpers. No live duplicate blank-row/current-key preflight was found outside the Gate flow. | Low currently; future risk is ad hoc row filtering that bypasses blank-row counts or reviewed exclusion. | Keep all Gate mapped-row filtering, blank-row counting, current-key null/duplicate preflight, and reviewed row exclusion on these helpers. | No code change needed. |
| Manual selected-key validation | `src/lib/gates/key-discovery.ts` `validateSelectedGateKey()` | Resolve route uses the helper. No separate manual validation implementation was found. | Low. | Keep manual key preview and approval paths on `validateSelectedGateKey()` and avoid reconstructing null/duplicate example logic in API/UI code. | No code change needed. |
| SQL identifier quoting for Gate DDL/push | `src/lib/gates/sql-identifiers.ts` `quoteSqlIdentifier()` and `fullSqlTableRef()` | `src/lib/sync/watermark.ts` has a narrow `quoteIdentifier()` for cursor clauses. `src/lib/alfheim/ddl-generator.ts` has a local `quoteIdentifier()` and sanitizer. `src/lib/backups/mssql/mssql-backup-sql.ts` has `quoteMssqlIdentifier()` for SQL Server backup commands. | Medium. The Gate helper handles dialect-specific escaping; parallel helpers can drift, especially Alfheim's DDL quote helper if identifiers contain dialect escape characters after sanitization. | New Gate code must use Gate SQL identifier helpers. Future cross-domain work should consider a shared dialect identifier package, but only after tests prove equivalence for Alfheim, Bifrost watermarks, and backup SQL. | No. These helpers are domain-specific and changing them could alter generated SQL. |
| Provider-specific Gate DDL | `src/lib/gates/key-ddl.ts` for key replacement and `src/lib/gates/alter-generator.ts` for schema drift/table creation | `src/lib/alfheim/ddl-generator.ts` builds API-source CREATE TABLE DDL. `src/lib/backups/mssql/mssql-backup-sql.ts` builds SQL Server backup/verify commands. | Medium if future Gate work hand-rolls DDL instead of using `key-ddl.ts`/`alter-generator.ts`. Lower for Alfheim/backups because they solve different DDL problems. | Do not add provider DDL inside API routes. Gate key constraints belong in `key-ddl.ts`; Gate schema drift/table DDL belongs in `alter-generator.ts`. | No. Cross-domain DDL consolidation is a larger design pass. |
| Auth and tenant checks | `src/lib/api.ts` `withAuth()` plus route-level `tenantId`/`userId` Prisma filters | Routes consistently use `withAuth()`, but route-level ownership checks are still repeated by feature. This is expected, not a single reusable business helper. | Medium. Repetition can cause missed tenant filters when new routes are added. | Keep `withAuth()` mandatory. For new attachment flows, prefer feature helpers that take `tenantId`/`userId` and return safe errors instead of embedding complex tenant logic in route files. | No. No obviously incorrect duplicate was found. |
| Blueprint version attach validation | `src/lib/mjolnir/blueprint-version-attach.ts` `validateOptionalAttachableBlueprintVersion()` and consumer wrappers: report, Bifrost, RealmGate | Runtime execution paths also re-check tenant/locked/scope/status before executing pinned versions. This is duplicated by design as defense in depth. | Low to medium. API attach and runtime execution can diverge in wording, but runtime should still defend against stale or manually edited records. | Keep consumer API validation on wrapper helpers. Keep runtime checks in loaders/executors, but do not invent new attach validators per route. | No. Runtime duplicate checks are intentional safety. |
| File analysis and UCC | `src/lib/duckdb/file-analyzer.ts` `analyzeFile()` and `src/lib/ucc/discovery.ts` `discoverUCCs()` | `src/lib/file-processor.ts` is a deprecated shim that throws migration errors. `src/app/api/ucc/discover/route.ts` loads files/rows directly into DuckDB and calls `discoverUCCs()`. Mjolnir `parseExcelBuffer()` is separate for before/after blueprint structural analysis. | Medium. The `/api/ucc/discover` route can drift from `analyzeFile()` loading behavior; Mjolnir parsing is a valid separate domain. | New file profiling should use `analyzeFile()`. New UCC-only surfaces can call `discoverUCCs()` directly, but should not reimplement file parsing unless there is a clear endpoint reason. | No. The UCC route's direct loader supports multipart/rows/filePath shapes and is covered separately. |
| Gate temp/staged file cleanup | `src/lib/gates/temp-files.ts` `saveTempFile()`, `readTempFile()`, `deleteTempFile()`, `cleanupOldTempFiles()` | Push, execute, resolve, and clear routes call these helpers directly in multiple places. | Medium. Rules around preserving KEY_DRIFT/SCHEMA_DRIFT staged files are subtle; duplicated delete calls increase regression risk. | Future cleanup should add a small `clearGatePushTempFile()` or `finalizeGatePushTempFile()` helper that encodes status-specific delete/preserve rules. | No. Existing behavior is correct and tests cover it; consolidating would be a refactor. |
| Gate validation heartbeat and stale timeout | `src/lib/gates/validation-timeouts.ts` for Gate validation stages, heartbeat, stale failure; `src/lib/worker-guardrails.ts` for general worker singleton/stale helpers | Raven cleanup has its own 24-hour stale job logic in `src/lib/raven/cleanup.ts`. Raven UI status also has local heartbeat display helpers. | Medium. Separate stale concepts are valid, but timeout copy and thresholds can drift. | Keep Gate validation on `validation-timeouts.ts`. Future Raven cleanup/status work should consider moving stale thresholds/status classification into a Raven-specific helper instead of route/UI local logic. | No. Raven stale semantics differ from Gate validation heartbeat. |
| Retention and redaction | `src/lib/mjolnir/retention.ts` `sanitizeBlueprintCreatePayload()`, `sanitizeForgeSteps()`, `sanitizeAnalysisLog()`, `sanitizeAfterFormatting()`, `redactSampleValue()` | Publish and blueprint update paths use the retention helpers. Key-drift metadata intentionally exposes column names/counts/key examples, not raw full rows. No alternate Mjolnir redaction helper was found. | Low currently. High if future APIs persist or return sample-derived Mjolnir payloads without the retention helper. | New Mjolnir persistence or API-return code that touches sample-derived fields must go through retention helpers. | No code change needed. |
| Backup object storage keys and paths | `src/lib/backups/storage/object-keys.ts` and `src/lib/backups/storage/path-utils.ts` | Postgres artifact wrappers and SQL Server backup artifact helpers already reuse the canonical object-key builder. Tests contain literal example keys. | Low. The canonical helper is already in use. | Keep engine-specific wrappers thin and backed by `buildBackupObjectKey()`/`buildManifestObjectKey()`. Avoid string-building object keys in new backup engines. | No code change needed. |
| Credential conversion for providers | `src/lib/providers/helpers.ts` `toConnectionLike()` | Some Gate code (`gates/route.ts`, `gates/tables`, `gates/destination-matcher`, Gate resolve, push executor) still decrypts connection credentials inline before calling providers. | Medium. Inline decrypt lacks the centralized plaintext-fallback/test behavior and can diverge in error handling. | Prefer `toConnectionLike()` in new provider calls. A future targeted Gate provider-connection cleanup can replace inline decrypts where tests prove identical behavior. | No. Changing now could alter dev/test plaintext fallback and Gate error behavior. |

## Low-Risk Fixes Applied

No runtime duplicate fixes were applied. Every candidate duplicate found was either:

- a compatibility shim,
- a domain-specific helper with different semantics,
- already using the canonical helper,
- or a refactor-sized consolidation risk.

The only change made in this pass is documentation:

- Added this audit.
- Added a `Known Canonical Helpers` section to `AGENTS.md`.

## Validation Results

- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 121 test files and 1457 tests.
- `npm run build`: passed with existing lint warnings.
- `npm run lint`: passed with existing warnings.
