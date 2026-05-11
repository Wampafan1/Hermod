# Gate Key Hardening Runbook

This runbook is for operating and troubleshooting RealmGate repeat uploads that enter `KEY_DRIFT`.

Gate key hardening protects data trust during repeat uploads. It prevents Hermod from silently reporting success when the current UPSERT key is no longer safe for the staged file.

## What KEY_DRIFT Means

`KEY_DRIFT` means Hermod staged the uploaded file, mapped rows to destination columns, skipped fully blank mapped rows, and found that the current UPSERT key cannot safely push every nonblank staged row without review.

When a push is in `KEY_DRIFT`:

- Nonblank rows have not been loaded yet.
- Fully blank mapped rows may have been skipped and counted in `blankRowsSkipped`.
- The staged upload is preserved for review.
- The user must either approve a reviewed path or cancel/clear the staged upload.

## Drift Types

`GatePush.keyDrift.driftType` explains why review is required.

| Drift type | Meaning | Primary operator path |
| --- | --- | --- |
| `DUPLICATE_KEY` | Two or more nonblank staged rows share the same complete current-key values. | Pick a verified UCC candidate, preview DDL, approve key replacement, then push. |
| `BLANK_KEY` | No duplicate complete key groups exist, but nonblank staged rows have blank/null current-key components. | Keep the current key, approve excluding reviewed incomplete rows, then push. |
| `DUPLICATE_AND_BLANK_KEY` | The staged file has both duplicate complete key groups and incomplete nonblank key rows. | Pick a verified UCC candidate, approve DDL, and approve excluding reviewed incomplete rows if required. |

## When DDL Runs

DDL runs only after explicit approval of key hardening:

- The selected key is a verified candidate or a manually validated selected key.
- The selected key passes staged-upload validation, except review-required nullable UCC cases where incomplete rows must be explicitly excluded.
- Destination validation passes.
- The generated DDL is previewed.
- The submitted `confirmedDdl` exactly matches the generated DDL.
- The request includes `confirm: true`.
- If incomplete nonblank rows exist for the selected key, the request also includes `incompleteRowAction: "EXCLUDE_REVIEWED_ROWS"`.

DDL updates can persist:

- `RealmGate.primaryKeyColumns`
- `RealmGate.keyConstraintName`
- `RealmGate.keyHistory`
- `GatePush.keyDrift.selectedKey`
- `GatePush.keyDrift.appliedDdl`

## When DDL Does Not Run

DDL does not run for blank-only current-key review.

If `driftType` is `BLANK_KEY` and the current key is still unique for business rows:

- The primary action is `APPROVE_INCOMPLETE_ROW_EXCLUSION`.
- Hermod keeps the existing destination key.
- `RealmGate.primaryKeyColumns` does not change.
- `RealmGate.keyConstraintName` does not change.
- No key replacement entry is added to `keyHistory`.
- The reviewed push excludes only the incomplete row indexes approved by the user.

DDL also does not run when:

- The user cancels or clears the staged upload.
- Destination validation fails.
- The selected key has duplicate values.
- The selected key is missing key values and incomplete-row exclusion was not approved.
- `confirmedDdl` differs from the generated preview.

## How UCC Candidates Are Found

Gate KEY_DRIFT uses Hermod's existing UCC discovery pipeline through the Gate adapter:

- `discoverGateKeyCandidates()`
- `discoverUCCs()`
- DuckDB-backed analysis of the mapped staged rows

Gate candidate discovery should not use custom capped key-finder logic as the primary source. Candidate metadata is safe and includes column names, counts, quality information, and scores. It does not include full row payloads.

Useful `keyDrift` fields:

- `candidateKeys`
- `recommendation`
- `validationStats.discoveryMode`
- `validationStats.rowCount`
- `validationStats.columnsAnalyzed`
- `validationStats.combinationsTested`
- `validationStats.durationMs`
- `noReliableKeyReason`

## Nullable UCC Candidates

UCC can verify a candidate key even when some staged rows have null or blank values in candidate-key columns.

Hermod keeps those candidates visible and marks them as review-required:

- `requiresReview: true`
- `reviewReason: "KEY_HAS_NULLS"`
- `nullCount`

These candidates are not invalid, but incomplete nonblank rows must be handled explicitly. The user must choose between:

- excluding reviewed incomplete rows and continuing, or
- canceling and fixing the file.

## Incomplete Row Exclusion

Incomplete row exclusion is explicit and narrow.

Hermod excludes rows only when:

- the rows are nonblank,
- the rows are missing one or more selected-key components,
- the UI/API showed limited examples for review,
- the approval includes `incompleteRowAction: "EXCLUDE_REVIEWED_ROWS"`, and
- execution revalidates the staged upload before pushing.

Hermod does not exclude duplicate rows as a review shortcut. Duplicate selected-key rows still block approval.

Persisted review metadata can include:

- `GatePush.keyDrift.incompleteRowAction`
- `GatePush.keyDrift.incompleteRowsExcluded`
- `GatePush.keyDrift.excludedRowIndexes`
- `GatePush.keyDrift.manualValidation`
- `GatePush.blankRowsSkipped`

`excludedRowIndexes` are staged-file row indexes. They are audit evidence for the reviewed exclusion, not a new primary key or row payload.

## What Is Persisted

RealmGate fields:

- `primaryKeyColumns`: the active destination key columns used for UPSERT.
- `keyConstraintName`: the Hermod-managed destination key constraint or index name when known.
- `keyHistory`: audit trail for approved key replacements or related key events.

GatePush fields:

- `status`: `KEY_DRIFT`, `SUCCESS`, `PARTIAL`, `FAILED`, `CANCELLED`, etc.
- `keyDrift`: current key evidence, candidate metadata, recommendations, review decisions, selected key, applied DDL, and reviewed exclusion metadata.
- `blankRowsSkipped`: count of fully blank mapped rows skipped before validation/push.
- `rowsInserted`, `rowsUpdated`, `rowsErrored`: final push result counts.
- `tempFileId`: staged upload reference while review is pending.

## Troubleshooting Checklist

1. Confirm the Hermod worker is running and healthy.
   - Check `GET /api/system/worker-health`.
   - In development, run `npm run worker` in a separate terminal.
   - In production, check the worker process/service and worker logs.

2. Inspect the latest GatePush status.
   - Expected review statuses include `SCHEMA_DRIFT` and `KEY_DRIFT`.
   - `VALIDATING` should progress or eventually fail with worker heartbeat diagnostics.
   - `SUCCESS` should never have `rowsErrored > 0`.

3. Inspect `keyDrift.discoveryMode`.
   - Expected UCC-backed discovery mode is usually `UCC`.
   - If candidates are empty, inspect `noReliableKeyReason` and validation stats.

4. Inspect candidate count.
   - If UCC found verified candidates, `candidateKeys` should not be empty.
   - Nullable candidates should be visible with `requiresReview`.

5. Check logs.
   - Gate validation worker logs:
     - `[GateValidation] Starting gate validation pushId=...`
     - `[GateValidation] Stage ANALYZING_FILE pushId=... elapsedMs=...`
     - `[GateValidation] Stage DISCOVERING_KEY pushId=... elapsedMs=...`
     - `[GateValidation] Finished gate validation pushId=... status=... candidates=... recommendation=...`
   - Gate push execution logs:
     - `[Gate] Upsert batch ... failed: ...`
   - Worker health/failure copy:
     - stale heartbeat timeout messages point to `[GateValidation] push=<id>` logs.

## Safe SQL Snippets

Use parameterized queries in application tooling when possible. These snippets are for read-only operator inspection. Replace placeholders with known IDs.

Latest pushes for a gate:

```sql
SELECT
  id,
  "gateId",
  "tenantId",
  status,
  "fileName",
  "rowCount",
  "blankRowsSkipped",
  "rowsInserted",
  "rowsUpdated",
  "rowsErrored",
  "errorMessage",
  "createdAt",
  "completedAt"
FROM "GatePush"
WHERE "tenantId" = '<tenant_id>'
  AND "gateId" = '<gate_id>'
ORDER BY "createdAt" DESC
LIMIT 10;
```

Latest KEY_DRIFT summary:

```sql
SELECT
  id,
  status,
  "blankRowsSkipped",
  "keyDrift"->>'driftType' AS drift_type,
  "keyDrift"->>'recommendedAction' AS recommended_action,
  jsonb_array_length(COALESCE("keyDrift"->'candidateKeys', '[]'::jsonb)) AS candidate_count,
  "keyDrift"->'validationStats'->>'discoveryMode' AS discovery_mode,
  "keyDrift"->'validationStats'->>'durationMs' AS discovery_duration_ms,
  "keyDrift"->>'noReliableKeyReason' AS no_reliable_key_reason,
  "createdAt"
FROM "GatePush"
WHERE "tenantId" = '<tenant_id>'
  AND "gateId" = '<gate_id>'
ORDER BY "createdAt" DESC
LIMIT 1;
```

Current RealmGate key metadata:

```sql
SELECT
  id,
  "tenantId",
  "targetSchema",
  "targetTable",
  "mergeStrategy",
  "primaryKeyColumns",
  "keyConstraintName",
  "keyHistory",
  "updatedAt"
FROM "RealmGate"
WHERE "tenantId" = '<tenant_id>'
  AND id = '<gate_id>';
```

Incomplete-row review audit fields:

```sql
SELECT
  id,
  "keyDrift"->>'incompleteRowAction' AS incomplete_row_action,
  "keyDrift"->>'incompleteRowsExcluded' AS incomplete_rows_excluded,
  "keyDrift"->'excludedRowIndexes' AS excluded_row_indexes,
  "keyDrift"->'incompleteRowExamples' AS incomplete_row_examples
FROM "GatePush"
WHERE "tenantId" = '<tenant_id>'
  AND id = '<push_id>';
```

Do not query or export full staged rows as part of normal triage. The review flow is designed to expose only row indexes, key values, column names, counts, and DDL.
