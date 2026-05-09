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
