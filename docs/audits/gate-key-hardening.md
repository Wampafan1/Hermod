# Adaptive Gate Key Hardening

## Operator Runbooks

- [Gate Key Hardening Runbook](../runbooks/gate-key-hardening-runbook.md)
- [Gate Key Hardening Test Matrix](../runbooks/gate-key-hardening-test-matrix.md)

## Phase 1 Results

This patch stops RealmGate pushes from reporting false success when the active UPSERT key no longer fits the uploaded file.

### Behavior Added

- Gate pushes now return and persist an explicit execution status: `SUCCESS`, `FAILED`, `PARTIAL`, or `KEY_DRIFT`.
- `SUCCESS` is never used when `rowsErrored > 0`.
- `PARTIAL` is used when some rows are delivered and some rows error.
- `FAILED` is used when all attempted rows error or push execution crashes.
- `KEY_DRIFT` is used when repeat-upload UPSERT preflight finds duplicate or blank values in the current key.
- Fully blank mapped rows are skipped before APPEND, TRUNCATE_RELOAD, or UPSERT execution and persisted as `blankRowsSkipped`.
- Nonblank rows with blank or duplicate current-key values are held for review instead of being dropped or partially pushed.

### KEY_DRIFT

`KEY_DRIFT` means the configured UPSERT key may still be a valid business identifier historically, but the current upload cannot be safely upserted with that key. Hermod does not attempt the UPSERT in this state.

Persisted `keyDrift` metadata includes:

- `oldKey`
- duplicate key examples with row indexes
- blank key examples with row indexes
- a deterministic reason
- empty placeholders for future candidate key and recommendation data

The examples intentionally include only key columns and row numbers, not full row payloads.

### Blank Row Definition

A fully blank mapped row is a row where every mapped destination value is `null`, `undefined`, an empty string, or a whitespace-only string. These rows are counted in `blankRowsSkipped` and are not included in destination load payloads.

### Staged File Retention

When a push enters `KEY_DRIFT`, the staged temp upload is preserved so a future review or resolution flow can reuse it. Existing clear/cancel behavior can still remove the preserved staged file.

### Schema Additions

- `GatePush.keyDrift`
- `GatePush.blankRowsSkipped`
- `RealmGate.keyConstraintName`
- `RealmGate.keyHistory`

`GatePush.status` remains a string field, so `KEY_DRIFT` and `PARTIAL` are represented consistently without introducing a Prisma enum migration in this phase.

### Current Limitations

- No destination DDL replacement yet.
- No approval/resolution workflow for selecting a new key yet.

## Phase 2 Candidate Discovery Results

When a push enters `KEY_DRIFT`, Hermod now runs unique-column-combination discovery on the nonblank mapped upload rows before persisting the review state.

### UCC Search Behavior

- Discovery runs on mapped destination columns, not raw source column names.
- Fully blank mapped rows are excluded from discovery and still counted in `blankRowsSkipped`.
- Candidate combinations are tested up to width 4 by default.
- Candidates with blank/null values are rejected by default.
- Candidates with duplicates are rejected.
- Candidate search is capped by maximum analyzed columns and maximum combinations to keep review latency bounded.
- Candidate ranking prefers verified null-free keys, narrower keys, and stable-looking business columns such as IDs, codes, job numbers, order numbers, and line numbers.

### AI Ranking Limits

AI ranking is optional and opt-in through `GATE_KEY_RECOMMENDATION_AI=1`.

When enabled:

- AI receives only verified candidate metadata, current-key failure counts, and validation stats.
- AI does not receive full row payloads.
- AI cannot add or invent candidates.
- If AI recommends anything outside the verified candidate list, Hermod discards it and uses deterministic ranking.

### Deterministic Fallback

If AI is disabled, unavailable, or invalid, Hermod uses deterministic ranking. If no null-free unique candidate exists, `keyDrift.noReliableKeyReason` is populated and the upload remains staged for review.

### Existing-Destination Validation

Phase 2 fully validates candidate uniqueness inside the uploaded nonblank mapped rows. Existing destination table validation is recorded as `UPLOAD_ONLY` in `validationStats` and remains a Phase 3 follow-up before any approved key replacement is applied to the destination.

### Tests Added

- `src/__tests__/gates/key-discovery.test.ts`
- `src/__tests__/gates/key-recommendation-ai.test.ts`

### Validation Results

- `npx prisma validate`
- `npx prisma generate`
- `npm run test`
- `npm run build`
- `npm run lint`

## Key Discovery Fortification Results

Hermod now uses a multi-stage candidate discovery path so it does not falsely report `No reliable key found` when a verified key exists in the mapped upload rows.

### Multi-Stage Discovery

- Stage A keeps the quick heuristic search for simple files.
- Stage B runs duplicate-cluster discriminator search when the current key fails on duplicate groups.
- Stage C runs a thorough all-column UCC search up to the configured width and combination limits.
- The default thorough search width is 6.
- Candidate discovery now considers all mapped destination columns by default instead of only the top 24 heuristic columns.

### Duplicate Discriminator Search

- Duplicate current-key groups are inspected across all mapped destination columns.
- Columns that differ inside duplicate groups are forced into the search even when their names look like `value`, `amount`, `date`, or other historically volatile fields.
- Hermod explicitly tests current key plus one, two, and three discriminator columns when width limits allow.
- The regression case `job_number + 7501_line_number + line_entered_value` is now found and ranked as a verified candidate.

### Thorough UCC Search And Caps

- `keyDrift` metadata now records discovery mode, search exhaustiveness, columns considered, excluded columns, discriminator stats, duplicate group count, and candidate search limits.
- If discovery is capped by width, column, or combination limits, `searchExhaustive` is false and the no-key message says the search hit limits.
- If discovery is exhaustive within the configured bounds, the no-key message says all mapped columns were checked up to the configured width.
- Hermod no longer uses column-name volatility as an exclusion rule; name heuristics affect ranking only after uniqueness is verified.

### Blank Row Handling

- Fully blank mapped rows are excluded before current-key preflight, duplicate detection, and key discovery.
- Fully blank mapped rows increment `blankRowsSkipped` and do not appear as blank current-key examples.
- Nonblank rows with blank key values still enter `KEY_DRIFT`.

### Manual Key Validation

- Added `validateSelectedGateKey()` to validate a user-selected key against nonblank mapped rows.
- The helper returns null counts, duplicate counts, and safe examples that include only selected key fields and row indexes.
- The UI now shows discovery diagnostics and warns when discovery hit search limits. A full manual key selection UI remains a follow-up.

### Tests Added

- `src/__tests__/gates/key-discovery-regression.test.ts`
- Expanded `src/__tests__/gates/key-discovery.test.ts`
- Expanded `src/__tests__/gates/gate-push-preflight.test.ts`
- Expanded `src/__tests__/gates/key-drift-ui.test.ts`

### Validation Results

- Focused Gate key discovery tests passed: 5 files, 34 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed after the existing Windows Prisma DLL-lock workaround.
- `npm run test`: passed, 107 files and 1365 tests.
- `npm run build`: passed with existing warnings.
- `npm run lint`: passed with existing warnings.

### Remaining Follow-Up

- Destination-table combined validation currently remains part of the approval/DDL path, not Phase 2 upload discovery.
- Add a manual key selection UI that calls the selected-key validation helper before DDL preview.

## Phase 3 Key Approval And DDL Results

Hermod can now turn a `KEY_DRIFT` review into an explicit, user-approved key hardening action. The staged upload is re-read, remapped, blank-row filtered, and revalidated against the selected key immediately before any destination DDL is generated or executed.

### Provider Support

- Postgres: unique constraint and primary key replacement SQL generation.
- SQL Server: unique constraint and primary key replacement SQL generation.
- MySQL: unique index and primary key replacement SQL generation.
- Unsupported providers remain blocked from key replacement.

### Safety Blocks

- The selected key must match one of the verified `keyDrift.candidateKeys`.
- The staged upload must still be null-free and unique for the selected key.
- Existing destination rows are checked for nulls and duplicate key combinations before DDL.
- Hermod drops only a known Hermod-managed constraint/index or an exact matching key constraint.
- Primary key replacement is blocked when foreign key dependencies are detected.
- Confirmed DDL must exactly match the current generated plan before execution.

### DDL Preview

`GET /api/gates/[gateId]/push/[pushId]/resolve?selectedKey=a,b,c` returns the generated DDL, warnings, blocked status, and confirmation requirement without executing anything.

### Approval Flow

`POST /api/gates/[gateId]/push/[pushId]/resolve` supports:

- `CANCEL`: cancels the `KEY_DRIFT` review and removes the staged upload.
- `APPROVE_KEY_HARDENING`: validates the approved key, applies confirmed DDL, updates `RealmGate.primaryKeyColumns`, records `RealmGate.keyConstraintName`, appends `RealmGate.keyHistory`, then re-runs the staged push.

Post-DDL push status comes from the actual push result. `SUCCESS` is not returned when row errors occur, and staged files are deleted only on successful reviewed pushes or explicit cancel.

### keyHistory Behavior

Each approved hardening records the push id, old key, new destination key, stored source-key form, generated constraint name, applied DDL, warnings, and timestamp in `RealmGate.keyHistory`.

### Tests Added

- `src/__tests__/gates/key-ddl.test.ts`
- `src/__tests__/gates/key-hardening-resolve.test.ts`

### Validation Results

- `npx prisma validate`
- `npx prisma generate`
- `npm run test`
- `npm run build`
- `npm run lint`

### Remaining Phase 4

- Build the UI review panel for candidate evidence, DDL preview, confirmation, cancel, and reviewed push results.

## Phase 4 Key Drift UI Results

Hermod now surfaces `KEY_DRIFT` as a review-first workflow in the Gates UI instead of leaving it as a hidden staged state.

### UI Panel Behavior

- `src/components/gates/key-drift-review-panel.tsx` renders the current failed key, failure reason, duplicate examples, blank-key examples, skipped blank-row count, candidate keys, recommendation details, validation stats, and no-reliable-key states.
- Candidate key selection defaults to the deterministic or AI recommendation when one is present.
- Candidate cards show columns, width, coverage, null count, duplicate count, score, and recommendation reason.
- Full row payloads are not rendered; examples are limited to key fields and row indexes.

### Approval And Cancel Behavior

- Approving requires a selected candidate, nonblocked DDL preview, and the explicit checkbox: `I approve changing the destination key constraint.`
- Approval posts `APPROVE_KEY_HARDENING` with the selected key, confirmed DDL, and `confirm: true`.
- Cancel posts `CANCEL`, clears the staged upload, refreshes the gate, and removes the review state.
- Successful reviewed pushes hide the panel after refresh; partial or failed reviewed pushes surface their status/result details.

### DDL Preview Behavior

- The panel calls the existing resolve preview path when the selected key changes.
- Generated DDL statements, warnings, and block reasons are shown before approval.
- Approval is disabled while the preview is loading or if the DDL plan is blocked.

### List And History Visibility

- Gate detail renders the review panel when the latest push is `KEY_DRIFT`.
- Push history continues to show `KEY_DRIFT` as an amber review state with summarized key evidence.
- Gate list cards now show a visible `Key review needed` state when the latest push requires review.

### Tests Added

- `src/__tests__/gates/key-drift-ui.test.ts`

### Validation Results

- `npx prisma validate`
- `npx prisma generate`
- `npm run test`
- `npm run build`
- `npm run lint`

## Manual Key Selection Patch Results

Hermod no longer dead-ends a `KEY_DRIFT` review when automatic discovery misses, caps, or ranks the business-correct key below another verified candidate.

### Manual Key Metadata

- `keyDrift.mappedColumns` now stores safe mapped-column metadata for the review UI.
- Stored metadata includes destination column, source column, nonblank count, blank count, distinct count, current-key flag, and discriminator flag.
- Full row payloads and non-key cell values are not stored in manual-selection metadata.
- Source column names are included because the Gate mapping UI already exposes them.

### Manual Validation And Preview

- `GET /api/gates/[gateId]/push/[pushId]/resolve?selectedKey=a,b,c` now accepts either a verified candidate or a manual selected key.
- Manual keys re-read the staged upload, remap rows, skip fully blank mapped rows, and validate selected-key nulls and duplicates before DDL preview.
- Invalid manual keys return `409 KEY_DRIFT` with safe duplicate/null examples and keep the staged upload available.
- Valid manual keys continue through existing destination validation and DDL preview without executing DDL or loading rows.

### Manual Approval

- `POST /api/gates/[gateId]/push/[pushId]/resolve` now allows manually selected keys after staged-upload and destination validation.
- DDL execution still requires `confirm: true` and an exact `confirmedDdl` match.
- Manual approval records `keyDrift.manualSelection`, `keyDrift.manualValidation`, and `keyDrift.selectedKey`.
- Rows are pushed only after validation passes, DDL is approved, and the generated DDL matches the confirmed DDL.

### UI Changes

- The `KEY_DRIFT` review panel now shows a manual mapped-column picker.
- The picker defaults to the recommendation when present, otherwise the current key.
- No-candidate states now direct users to manually select and validate columns.
- The panel shows whether the selected key is unique in the staged upload and hides approval controls for invalid manual keys.

### Real-World Regression Case

- Added a fixture for the `job_number + 7501_line_number` failure where adding `line_entered_value` makes the upload unique.
- Tests verify the blank mapped row is counted separately, current-key drift is detected, discovery finds the hardened key, and manual validation accepts the same key.

### Tests Added

- `src/__tests__/gates/fixtures/key-drift-job-line-value.ts`
- `src/__tests__/gates/key-hardening-manual-selection.test.ts`
- Expanded `src/__tests__/gates/key-hardening-resolve.test.ts`
- Expanded `src/__tests__/gates/key-drift-ui.test.ts`

### What Remains

- Existing destination-table validation still runs in the approval/preview path, not automatic upload discovery.
- Provider-specific DDL limitations remain governed by the existing key DDL safety checks.

## End-to-End Acceptance Results

The Gate key hardening flow is now covered as one product path from repeat upload through reviewed execution.

### Regression Path

- The acceptance fixture reproduces the `job_number + 7501_line_number` failure where rows `1144/1145`, `1205/1206`, and `1548/1549` duplicate under the current key.
- The stronger key `job_number + 7501_line_number + line_entered_value` is verified in the staged upload.
- One fully blank mapped row is skipped and counted separately.

### KEY_DRIFT Creation

- Repeat upload validation creates a `GatePush` with `status = KEY_DRIFT` before any destination provider query runs.
- `keyDrift.oldKey` records the current key.
- Duplicate examples include only current-key values and row indexes.
- Fully blank mapped rows do not appear in blank-key examples.
- Raw non-key row values are intentionally omitted from `keyDrift` API responses and UI helper output.

### Candidate And Manual Selection

- Automatic candidate discovery finds the stronger regression key.
- Manual selected keys are also accepted for preview when they are not already verified candidates.
- Manual keys re-read the staged file, remap rows, skip fully blank mapped rows, and validate nulls/duplicates before DDL preview.
- Invalid manual keys return `409 KEY_DRIFT`, include safe evidence, and keep the staged upload in review.

### DDL Preview And Approval

- DDL preview validates the selected key against the staged upload and existing destination table before returning SQL.
- Generated DDL uses the provider-specific quoting and safety checks in `key-ddl.ts`.
- Mismatched `confirmedDdl` is rejected before any key metadata changes.
- DDL execution still requires explicit user approval.
- Destination validation failures, DDL failures, and expired staged files do not change the key constraint or mark the push successful.

### Reviewed Push Status

- After approval, Hermod updates `RealmGate.primaryKeyColumns`, stores `RealmGate.keyConstraintName`, appends `RealmGate.keyHistory`, and re-runs the staged push.
- Final status comes from the actual push result.
- `SUCCESS` is returned only when there are no row errors.
- Post-DDL UPSERT failures are recorded as `FAILED` or `PARTIAL`, never `SUCCESS`.

### Staged Temp Files

- Staged files are preserved while a push is in `KEY_DRIFT`.
- Staged files are deleted on successful reviewed push.
- Staged files are deleted on explicit cancel.
- Staged files are preserved after failed or partial execution so the attempt is not silently abandoned before review or expiry.

### Tests Added

- `src/__tests__/gates/gate-key-hardening-e2e.test.ts`
- Expanded `src/__tests__/gates-api.test.ts` for failed execution temp-file preservation.

### Validation Results

- Focused Gate acceptance tests passed.
- Full validation results are recorded in the implementation commit.

### Remaining Follow-Ups

- Add real provider integration tests for Postgres, SQL Server, and MySQL key replacement when test containers are available.
- Document operator guidance for approving key changes in production.
- Continue to improve combined destination-plus-upload validation limits for very large destination tables.

## Validation Responsiveness Patch Results

Gate upload validation no longer relies on one long synchronous request to analyze the file, check schema drift, and run key-drift preflight before the UI receives a push id.

### Previous Hang Risk

- The Gate detail UI entered `VALIDATING` and waited for `POST /api/gates/[gateId]/push` to complete.
- That request previously performed file analysis, schema diffing, temp-file staging, and key preflight before returning.
- If any step stalled, the UI could remain on `VALIDATING SCHEMA...` without an inspectable `GatePush`.

### Staged And Polled Validation

- `POST /api/gates/[gateId]/push` now creates a `GatePush` in `VALIDATING` as soon as the upload metadata is accepted.
- The uploaded file is staged under that push and validation is enqueued as `gate-validate-push`.
- The API returns `{ pushId, status: "VALIDATING", validationStage: "RECEIVED" }` so the UI can poll.
- `GET /api/gates/[gateId]/push/[pushId]` returns safe status fields, schema drift, key drift, row counts, blank-row counts, and validation progress.

### Validation Stages

- `RECEIVED`
- `READING_FILE`
- `ANALYZING_FILE`
- `VALIDATING_SCHEMA`
- `CHECKING_KEY`
- `DISCOVERING_KEY`
- `READY`
- `FAILED`

The stages are stored in `GatePush.errorDetails.gateValidation` to avoid a schema migration in this patch.

### Timeout Behavior

- Validation heartbeat metadata is updated before each major worker step.
- `GATE_PUSH_VALIDATION_TIMEOUT_MS` controls stale validation timeout, defaulting to five minutes.
- The status endpoint marks stale `VALIDATING` pushes as `FAILED` before returning them.
- Worker startup also marks stale `VALIDATING` pushes as `FAILED`.

### UI Behavior

- Gate detail now polls the push status every two seconds while validation is running.
- Stage-specific copy replaces the single static `VALIDATING SCHEMA...` message.
- Long-running validation shows a visible message with options to keep waiting, refresh, or clear the staged upload.
- Users can clear/cancel a staged validation through the existing push clear path.

### Tests Added

- `src/__tests__/gates/gate-push-validation-status.test.ts`
- Expanded `src/__tests__/gates/gate-key-hardening-e2e.test.ts` to verify early `VALIDATING` creation and async validation completion.

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed.
- `npm run test` passed: 111 files, 1397 tests.
- `npm run build` passed with existing lint warnings.
- `npm run lint` passed with existing warnings.

### Remaining Follow-Ups

- Add a dedicated worker timeout test around pg-boss runtime behavior if the worker harness is expanded.
- Consider explicit Prisma fields for validation progress if the metadata needs to be queried directly at scale.

## UCC Discovery Integration Results

Gate `KEY_DRIFT` candidate discovery now uses Hermod's DuckDB-backed UCC discovery pipeline instead of the capped Gate-only combination finder.

### What Changed

- Added `src/lib/gates/gate-ucc-discovery.ts` as a Gate-specific wrapper around `discoverUCCs()`.
- Gate candidate discovery loads already-mapped destination rows into DuckDB and runs UCC discovery with pruning disabled for thorough mapped-column coverage.
- `GatePush.keyDrift.candidateKeys`, `recommendation`, and `validationStats` now come from the UCC wrapper.
- `validationStats.discoveryMode` is now `UCC` for the automatic KEY_DRIFT candidate path.
- Gate schema analysis now calls `analyzeFile()` with `skipUCC: true`; KEY_DRIFT candidate discovery performs the UCC pass through the Gate UCC wrapper.

### Current-Key Discriminator Handling

- UCC discovery returns minimal keys, which can be narrower than the business-preferred hardened key.
- The Gate wrapper now also runs narrow DuckDB verification for `current key + discriminator` combinations found inside duplicate current-key groups.
- This keeps the known `job_number + 7501_line_number + line_entered_value` path visible while still using full-table DuckDB verification rather than the old broad custom search.

### Preserved Behavior

- Duplicate and blank current-key examples still come from current-key preflight.
- Fully blank mapped rows are still skipped and counted before key drift and UCC discovery.
- Manual key selection, DDL preview, exact `confirmedDdl` matching, and user approval remain unchanged.
- No nonblank rows are loaded until key validation, DDL safety checks, and explicit approval succeed.

### Tests Added

- `src/__tests__/gates/gate-ucc-discovery.test.ts`
- Updated `src/__tests__/gates/key-discovery-regression.test.ts`
- Re-ran the Gate key hardening end-to-end acceptance test for the known job/line/value case.

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed after applying the documented Windows Prisma locked-DLL workaround.
- `npm run test` passed: 114 files, 1408 tests.
- `npm run build` passed with existing Next/React lint warnings.
- `npm run lint` passed with existing warnings.

## Gate Validation Heartbeat Fix

Gate validation could previously report a timeout while the worker was still alive in a long DuckDB stage. The status endpoint used stale heartbeat metadata, but long-running operations only updated the heartbeat before starting.

### What Changed

- Added `runWithGateValidationHeartbeat()` to refresh GatePush validation heartbeat metadata throughout long validation stages.
- Wrapped staged-file reading, schema analysis, and KEY_DRIFT preflight so active work keeps `validationHeartbeatAt` fresh.
- Worker startup stale cleanup now checks heartbeat freshness instead of failing every old `VALIDATING` push by `createdAt` alone.
- Timeout errors now explain that the worker did not refresh heartbeat and point operators to `[GateValidation] push=<id>` logs.
- Worker logs now include stage timings for `READING_FILE`, `ANALYZING_FILE`, and `DISCOVERING_KEY`, plus final status, candidate count, recommendation columns, and elapsed time.

### UCC Behavior

- Repeat Gate validation skips the Configure Gate UCC pass during `analyzeFile()` because it only needs schema/profile at that stage.
- KEY_DRIFT candidate discovery still uses Hermod's existing UCC engine through `discoverGateKeyCandidates()`.
- No new key discovery algorithm was added.

### Tests Added

- `src/__tests__/gates/gate-validation-worker.test.ts`
- Updated `src/__tests__/gates/gate-push-validation-status.test.ts`
- Updated `src/__tests__/gates/gate-validation-copy.test.ts`

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed after applying the documented Windows Prisma locked-DLL workaround.
- `npm run test` passed: 115 files, 1418 tests.
- `npm run build` passed with existing Next/React lint warnings.
- `npm run lint` passed with existing warnings.

## Nullable UCC Candidate Approval Results

UCC can verify a replacement key even when one or more staged rows have blank key components. Those candidates now remain reviewable instead of being treated as invalid.

### What Changed

- Verified UCC candidates with null key values return DDL preview as a review state, not as "Selected key is not valid."
- Preview responses include `requiresIncompleteRowApproval`, `incompleteRowsHeld`, and limited incomplete-row examples.
- Approval requires both destination-key DDL confirmation and `incompleteRowAction: "EXCLUDE_REVIEWED_ROWS"` when incomplete rows exist.
- The final reviewed push excludes only the explicitly reviewed incomplete row indexes.
- Fully blank mapped rows remain counted separately as `blankRowsSkipped`.
- Duplicate selected-key rows and destination validation failures still block DDL.

### Tests Added

- `src/__tests__/gates/key-hardening-nullable-ucc-approval.test.ts`
- Updated `src/__tests__/gates/key-hardening-resolve.test.ts`
- Updated `src/__tests__/gates/key-drift-ui.test.ts`
- Updated `src/__tests__/gates/gate-push-preflight.test.ts`

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed after applying the documented Windows Prisma locked-DLL workaround.
- `npm run test` passed: 116 files, 1426 tests.
- `npm run build` passed after clearing stale generated `.next` cache; existing warnings remain.
- `npm run lint` passed with existing warnings.

## Blank Current-Key Row Review Results

Blank-only current-key failures are now treated differently from duplicate key drift. If the current UPSERT key has missing values in staged nonblank rows but no duplicate complete key combinations, Hermod keeps the existing key as the primary path.

### What Changed

- KEY_DRIFT metadata now records `driftType` as `DUPLICATE_KEY`, `BLANK_KEY`, or `DUPLICATE_AND_BLANK_KEY`.
- Blank-only current-key drift records `currentKeyStillUniqueForBusinessRows`, `requiresIncompleteRowApproval`, `incompleteRowsHeld`, and `recommendedAction: "REVIEW_INCOMPLETE_ROWS"`.
- The resolve API supports `APPROVE_INCOMPLETE_ROW_EXCLUSION` for keeping the current key and excluding only reviewed incomplete row indexes.
- No DDL is generated or executed for the keep-current-key row review path.
- `RealmGate.primaryKeyColumns`, `keyConstraintName`, and key constraint history are not changed for blank-only row review.
- Duplicate key drift still uses the existing UCC-backed hardening and DDL approval flow.

### Tests Added

- `src/__tests__/gates/key-drift-blank-current-key.test.ts`
- Updated `src/__tests__/gates/key-drift-ui.test.ts`

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed after applying the documented Windows Prisma locked-DLL workaround.
- `npm run test` passed: 117 files, 1431 tests.
- `npm run build` passed with existing Next/React lint warnings.
- `npm run lint` passed with existing warnings.

## Real-World Gate Acceptance Results

The final regression pass locks the two LOVES upload paths that exposed the key-hardening edge cases.

### 2025 Duplicate-Key Hardening Path

- A repeat upload with duplicate `job_number + 7501_line_number` groups enters KEY_DRIFT.
- UCC candidate discovery surfaces `job_number + 7501_line_number + line_entered_value` with `source: "UCC"`.
- Nullable verified candidates remain visible with review-required metadata instead of producing `candidateKeys: []` or "No reliable key found."
- DDL preview is available for the verified hardened key.
- Approval requires both destination-key DDL confirmation and `incompleteRowAction: "EXCLUDE_REVIEWED_ROWS"` when incomplete rows exist.
- After approval, Hermod executes DDL, updates `RealmGate.primaryKeyColumns`, stores `keyConstraintName`, appends `keyHistory`, and reruns the push excluding only the reviewed incomplete row indexes.

### 2026 Blank-Current-Key Row Review Path

- A repeat upload where the persisted key `job_number + 7501_line_number + line_entered_value` has no duplicate complete key groups but has incomplete nonblank rows enters `driftType: "BLANK_KEY"`.
- The current key remains the primary path with `recommendedAction: "REVIEW_INCOMPLETE_ROWS"`.
- Users approve `APPROVE_INCOMPLETE_ROW_EXCLUSION`, which excludes only reviewed incomplete row indexes and reruns the push.
- No DDL is generated or executed for the keep-current-key path.
- `RealmGate.primaryKeyColumns`, `keyConstraintName`, and key replacement history are not changed.

### Tests Added

- `src/__tests__/gates/gate-key-hardening-real-world-acceptance.test.ts`
- Updated `src/__tests__/gates/key-drift-ui.test.ts`

### Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` passed after applying the documented Windows Prisma locked-DLL workaround.
- `npm run test` passed: 118 files, 1434 tests.
- `npm run build` passed with existing Next/React lint warnings.
- `npm run lint` passed with existing warnings.
