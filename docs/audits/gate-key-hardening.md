# Adaptive Gate Key Hardening

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
