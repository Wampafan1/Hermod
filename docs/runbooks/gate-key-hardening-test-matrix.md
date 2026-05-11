# Gate Key Hardening Test Matrix

Use this matrix before release and after changes near Gate upload validation, KEY_DRIFT review, UCC discovery, DDL preview/approval, temp-file cleanup, or worker validation.

## Release Checklist

- Gate validation worker is running in the target environment.
- `GET /api/system/worker-health` returns a safe worker health payload.
- `npm run test` passes.
- `npm run build` passes.
- `npm run lint` passes.
- Latest `docs/audits/gate-key-hardening.md` links to the operator runbooks.
- No backup business logic, Mjolnir versioning behavior, or data loading behavior changed in a docs-only release.

## Matrix

| Scenario | Setup | Expected result | Key assertions |
| --- | --- | --- | --- |
| 2025 duplicate-key hardening | Current key is `job_number + 7501_line_number`; staged rows include duplicate current-key groups; `line_entered_value` differentiates them; at least one incomplete nonblank key row exists. | Push enters `KEY_DRIFT`; UCC candidate `job_number + 7501_line_number + line_entered_value` is visible; DDL preview is available; approval requires DDL confirmation and incomplete-row approval when needed. | `driftType` is `DUPLICATE_KEY` or `DUPLICATE_AND_BLANK_KEY`; `candidateKeys` includes the UCC candidate; nullable candidate stays visible with `requiresReview`; missing `incompleteRowAction` rejects approval; matching `confirmedDdl` plus `EXCLUDE_REVIEWED_ROWS` executes DDL and pushes. |
| 2026 blank-current-key review | Current key is already `job_number + 7501_line_number + line_entered_value`; no duplicate complete key groups; one or more nonblank rows have blank key components. | Push enters `KEY_DRIFT`; primary path keeps current key and reviews incomplete rows; no DDL is generated or executed for the primary path. | `driftType = BLANK_KEY`; `currentKeyStillUniqueForBusinessRows = true`; `recommendedAction = REVIEW_INCOMPLETE_ROWS`; approval action is `APPROVE_INCOMPLETE_ROW_EXCLUSION`; `RealmGate.primaryKeyColumns` and `keyConstraintName` do not change. |
| Schema drift | Staged file has added, removed, or type-changed columns relative to saved schema, after accounting for known mappings. | Push enters `SCHEMA_DRIFT`; resolution options are returned safely. | Response includes `schemaDiff` and `resolutionOptions`; no raw rows, credentials, or connection configs are returned; staged file remains available for resolution/cancel. |
| Destination validation failure | Selected candidate is valid in staged upload but fails destination-table validation or provider safety checks. | DDL is blocked; push remains in `KEY_DRIFT`. | Preview/approval returns blocked result; no DDL executes; no push runs; temp file remains staged. |
| DDL mismatch | User submits `confirmedDdl` that does not exactly match generated DDL. | Approval is rejected. | Status remains `KEY_DRIFT`; no DDL executes; no key metadata changes; no rows push. |
| Provider DDL failure | Provider fails while executing approved DDL. | Push does not become `SUCCESS`. | Status becomes `FAILED` or remains reviewable according to the implemented failure path; `rowsErrored > 0` never maps to `SUCCESS`; staged file is preserved unless explicit cleanup rules apply. |
| Post-DDL push partial/failed | DDL succeeds, but final UPSERT/load returns row errors. | Final status is `PARTIAL` when some rows succeeded, or `FAILED` when all rows failed. | `SUCCESS` is impossible when `rowsErrored > 0`; row counts and safe error metadata are persisted; temp file is preserved for failure/partial according to current staged-review rules. |
| Cancel/clear staged upload | User cancels a `KEY_DRIFT`, `SCHEMA_DRIFT`, `VALIDATING`, `VALIDATED`, `PARTIAL`, or `FAILED` staged attempt. | Push is marked `CANCELLED` and staged temp file is deleted when appropriate. | `tempFileId` is cleared; clear action is rejected for `PUSHING` and successful history; no DDL or data push occurs. |

## Detailed Acceptance Checks

### 2025 Duplicate-Key Hardening

1. Upload a repeat file where `job_number + 7501_line_number` duplicates exist.
2. Confirm `GatePush.status = KEY_DRIFT`.
3. Confirm duplicate examples show only key columns and row indexes.
4. Confirm fully blank mapped rows are counted in `blankRowsSkipped`.
5. Confirm UCC candidate discovery returns the stronger key.
6. Confirm nullable UCC candidates are review-required, not hidden.
7. Preview DDL for the stronger key.
8. Submit approval without incomplete-row action when incomplete rows exist; expect rejection.
9. Submit approval with exact DDL and `incompleteRowAction: "EXCLUDE_REVIEWED_ROWS"`.
10. Confirm DDL runs, key metadata updates, reviewed rows are excluded, and the final push status reflects actual row errors.

### 2026 Blank-Current-Key Review

1. Upload a repeat file where the persisted key has blank components in nonblank rows but no duplicate complete key groups.
2. Confirm `GatePush.status = KEY_DRIFT`.
3. Confirm `driftType = BLANK_KEY`.
4. Confirm UI primary action is incomplete-row review, not key replacement.
5. Approve `APPROVE_INCOMPLETE_ROW_EXCLUSION` with `EXCLUDE_REVIEWED_ROWS`.
6. Confirm no DDL is generated or executed.
7. Confirm RealmGate key fields do not change.
8. Confirm only reviewed incomplete row indexes are excluded.
9. Confirm final status is `SUCCESS`, `PARTIAL`, or `FAILED` based on actual push result.

## Existing Test Coverage

Primary regression coverage lives in:

- `src/__tests__/gates/gate-key-hardening-real-world-acceptance.test.ts`
- `src/__tests__/gates/gate-key-hardening-e2e.test.ts`
- `src/__tests__/gates/key-drift-blank-current-key.test.ts`
- `src/__tests__/gates/key-hardening-nullable-ucc-approval.test.ts`
- `src/__tests__/gates/key-hardening-resolve.test.ts`
- `src/__tests__/gates/gate-push-preflight.test.ts`
- `src/__tests__/gates/push-executor-status.test.ts`
- `src/__tests__/gates/gate-validation-worker.test.ts`
- `src/__tests__/gates/gate-push-validation-status.test.ts`
- `src/__tests__/gates/key-drift-ui.test.ts`

## Operational Evidence To Capture

For a release validation note, capture:

- latest `GatePush.id`
- latest `GatePush.status`
- `keyDrift.driftType`
- `keyDrift.validationStats.discoveryMode`
- candidate count
- selected key
- whether DDL was applied
- incomplete rows excluded count
- `blankRowsSkipped`
- final `rowsInserted`, `rowsUpdated`, `rowsErrored`
- whether staged temp file was deleted or preserved according to status

Do not capture full row payloads, credentials, SQL connection configs, or staged file contents.
