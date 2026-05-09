# Mjolnir / Nidavellir Deep Dive

## Executive Summary

- Recommended ownership model: Hybrid. Keep personal Mjolnir drafts for experimentation, but require tenant-owned, version-pinned published blueprints before a blueprint can be attached to a report, Bifrost route, or RealmGate.
- Highest-risk issues: user-owned `Blueprint` records can be attached across tenants by the same user, sensitive sample-derived data is persisted in several fields, report and Bifrost execution use mutable current blueprint steps instead of pinned versions, and `ForgeBlueprintVersion` rollback/version history is detached from the actual execution path.
- Product decisions needed: decide whether cross-tenant personal libraries are intended, decide what sample data may be retained, decide whether attachments require validated or active status, and decide whether routes/reports must pin blueprint versions.
- P0 under the strict critical rule: none confirmed. I did not find a confirmed cross-user auth bypass, credential leak, destructive data-loss path, production build failure, schema startup failure, unbounded destructive worker behavior, or wrong-target restore behavior. The most serious findings are P1 product/security hardening risks.
- Recommended implementation order:
  1. Add explicit tenant/scope rules and block ambiguous cross-tenant attach paths.
  2. Add sensitive sample retention controls and redaction.
  3. Require validated/published blueprints for report and route attach.
  4. Pin report and route execution to immutable blueprint versions.
  5. Wire version history, rollback, pruning, and delete/archive behavior to the same execution model.
  6. Add API and integration tests around ownership, lifecycle, retention, and execution.

## Current Ownership Model

`Blueprint` is currently a personal user asset.

- `prisma/schema.prisma:39-62`: `User` owns `blueprints Blueprint[]`.
- `prisma/schema.prisma:362-380`: `Blueprint` has `userId`, `reports`, and `bifrostRoutes`, but no `tenantId`.
- `prisma/schema.prisma:261-283`: `Report` is tenant-scoped with `tenantId`, but optionally references a user-owned `Blueprint`.
- `prisma/schema.prisma:930-985`: `BifrostRoute` is tenant-scoped with `tenantId`, but optionally references a user-owned `Blueprint`.

`ForgeBlueprint` is route/tenant-oriented, but optional and not the primary execution source today.

- `prisma/schema.prisma:391-410`: `ForgeBlueprint` has `routeId @unique`, optional `tenantId`, `createdBy`, versions, executions, and RealmGate references.
- `prisma/schema.prisma:412-440`: `ForgeBlueprintVersion` stores immutable-ish version records with `steps`, hashes, AI metadata, and lock state.
- `src/lib/bifrost/engine.ts:322-335`: Bifrost executes `BifrostRoute.blueprintId` by loading mutable `Blueprint.steps`.
- `src/lib/bifrost/engine.ts:337-360`: the engine may record execution against the latest `ForgeBlueprintVersion`, but that version is not the source of executed steps.

Current classification: mixed and unclear.

- Personal: Mjolnir `Blueprint` list/create/update/delete.
- Tenant-scoped: reports, Bifrost routes, RealmGates, ForgeBlueprint API routes.
- Unclear bridge: report and Bifrost attach paths validate the target report/route by tenant, but validate the blueprint only by `userId`.

Ownership filters observed:

| Surface | Operation | Scope used |
| --- | --- | --- |
| `src/app/(app)/mjolnir/page.tsx` | List blueprints | `userId` only |
| `src/app/api/mjolnir/blueprints/route.ts` | List/create blueprints | `userId` only |
| `src/app/api/mjolnir/blueprints/[id]/route.ts` | Read/update/delete blueprint | `id + userId`; update/delete by `id` after precheck |
| `src/app/api/reports/[id]/route.ts` | Attach blueprint | report `id + userId + tenantId`; blueprint `id + userId` |
| `src/app/api/reports/route.ts` | Create report | report `userId + tenantId`; create schema ignores `blueprintId` |
| `src/lib/report-runner.ts` | Execute report blueprint | `blueprintId` only |
| `src/app/api/bifrost/routes/route.ts` | Attach blueprint on create | route `userId + tenantId`; blueprint `id + userId` |
| `src/app/api/bifrost/routes/[id]/route.ts` | Attach blueprint on update | route `id + userId + tenantId`; blueprint `id + userId` |
| `src/lib/bifrost/engine.ts` | Execute route blueprint | route by `id`; blueprint by `id` only |
| `src/app/api/blueprints/[routeId]/**` | ForgeBlueprint history/rollback/lock/diff | route `routeId + userId + tenantId` |
| `src/lib/mjolnir/blueprint-versioning.ts` | ForgeBlueprint create/version/rollback/prune | helper-level routeId/blueprintId/version only; caller must authorize |
| `src/app/api/gates/route.ts` | RealmGate create with `forgeBlueprintId` | gate `userId + tenantId`; no observed validation of `forgeBlueprintId` |

## Product Decision: Personal vs Tenant Blueprints

### Option A - Personal Blueprint Library

Blueprints remain owned by users and can follow a user across tenants.

Pros:

- Fastest to preserve current behavior.
- Useful for consultants or operators who intentionally reuse the same transformation patterns across realms.
- Avoids immediate migration for existing `Blueprint` rows.

Cons:

- Conflicts with the broader tenant-scoped app model.
- Makes it easy for a user with multiple tenants to attach one tenant's sample-derived blueprint to another tenant's report or route.
- Delete/archive/update of a personal blueprint can affect reports/routes in multiple tenants.
- Requires careful privacy messaging because filenames, schema names, format samples, formulas, and inferred constants may cross tenant context.

Required guardrails:

- Label blueprints as personal in all selectors.
- Show all tenant usages before update/archive/delete.
- Add explicit confirmation when attaching a personal blueprint to a tenant asset.
- Prevent personal blueprints from retaining sensitive samples unless the user opts in.
- Pin report/route usage to versions so personal edits do not silently change tenant workloads.
- Require `VALIDATED` or `ACTIVE` status before attach.

### Option B - Tenant-Owned Blueprints

Every attachable blueprint belongs to exactly one tenant.

Pros:

- Matches the rest of Hermod's tenant isolation model.
- Simplifies auth checks: list, attach, execute, update, archive, and delete can all include `tenantId`.
- Makes usage, retention, deletion, and audit policies easier to reason about.
- Reduces accidental cross-tenant sample metadata exposure.

Cons:

- Removes convenient cross-tenant reuse unless explicit copy/export behavior is added.
- Requires a migration/backfill for existing blueprints.
- Existing personal workflows need a transition path.

Required migration:

- Add nullable `tenantId` to `Blueprint`, backfill cautiously, then make tenant ownership mandatory for published/attachable blueprints.
- Add tenant indexes and tenant-scoped API checks.
- Add a "copy to tenant" or "publish to tenant" flow for existing personal blueprints.
- Backfill existing report and route attachments only where the blueprint owner and tenant membership can be verified.

### Option C - Hybrid: Personal Drafts, Tenant-Published Blueprints

Mjolnir drafts remain personal while published/attachable blueprints become tenant-owned, versioned artifacts.

Pros:

- Preserves a useful forge workspace while aligning production execution with tenant boundaries.
- Gives a clean lifecycle: personal draft -> validated draft -> tenant-published immutable version -> report/route attachment.
- Supports intentional reuse through explicit copy/publish actions instead of accidental cross-tenant reuse.
- Creates the right place for retention policy, approvals, and version pinning.

Cons:

- More schema and UI work than pure tenant ownership.
- Requires clear status and scope language.
- Requires compatibility handling for existing user-owned blueprints attached to tenant assets.

Required schema/API changes:

- Add blueprint scope, tenant ownership for published blueprints, and immutable version IDs used by reports/routes.
- Add publish/copy APIs that validate tenant membership and retention policy.
- Require reports/routes/RealmGates to attach only tenant-owned published versions.
- Keep personal drafts out of production selectors unless explicitly copied or published.

Recommendation: Option C.

It best matches Hermod's product shape. Mjolnir can stay a personal forge while report, Bifrost, and RealmGate execution become tenant-safe and version-stable. This is more work than Option B, but it avoids forcing all exploratory drafts into a tenant prematurely and gives the cleanest long-term lifecycle.

## Findings

### F-01 - Ambiguous personal-vs-tenant ownership

- Severity: P1
- Files:
  - `prisma/schema.prisma:362-380`
  - `prisma/schema.prisma:261-283`
  - `prisma/schema.prisma:930-985`
  - `src/app/(app)/mjolnir/page.tsx:9-23`
  - `src/app/api/mjolnir/blueprints/route.ts:11-69`
- Evidence: `Blueprint` has `userId` and no `tenantId`; reports and Bifrost routes have `tenantId` and can reference `Blueprint`.
- Impact: The app reads as tenant-scoped, but Mjolnir blueprints behave as personal assets. A multi-tenant user can naturally see and select the same blueprint in multiple tenants, even when the blueprint was forged from tenant-specific sample files.
- Minimal fix: Add an explicit scope decision. If blueprints are personal, label them as personal and add cross-tenant attach warnings. If blueprints are tenant-owned or hybrid, add `tenantId`/scope and tenant-scoped selectors.
- Tests needed: list only expected blueprints for active tenant or, if personal behavior is intended, test that personal blueprints are labeled and guarded during attach.
- Product decision required: yes.

### F-02 - Same-user cross-tenant blueprint attach is allowed

- Severity: P1
- Files:
  - `src/app/api/reports/[id]/route.ts:69-80`
  - `src/app/api/bifrost/routes/route.ts:67-88`
  - `src/app/api/bifrost/routes/[id]/route.ts:76-84`
  - `src/lib/report-runner.ts:163-192`
  - `src/lib/bifrost/engine.ts:322-335`
- Evidence: Report and Bifrost routes are checked by `userId + tenantId`, but blueprint validation checks only `id + userId`. Execution later loads the blueprint by `id`.
- Impact: A user with access to multiple tenants can attach a blueprint forged in one tenant context to another tenant's report or route. Another user cannot attach it through these APIs, so this is not a confirmed cross-user auth bypass, but it is a serious tenant-boundary ambiguity.
- Minimal fix: Until the product decision is made, block attach unless the blueprint is explicitly marked as personal-reusable or belongs to the active tenant. For tenant/hybrid ownership, enforce `tenantId` in attach and execution queries.
- Tests needed: report update rejects blueprint from another tenant; Bifrost create/update rejects blueprint from another tenant; execution cannot load a blueprint outside the route/report tenant.
- Product decision required: yes.

### F-03 - Sensitive sample-derived data is persisted in blueprint records

- Severity: P1
- Files:
  - `src/app/api/mjolnir/blueprints/route.ts:37-69`
  - `src/components/mjolnir/mjolnir-forge.tsx:213-255`
  - `src/lib/mjolnir/engine/structural-diff.ts:459-617`
  - `src/lib/mjolnir/engine/structural-diff.ts:765-787`
  - `src/lib/mjolnir/engine/style-extractor.ts:147-257`
- Evidence: Saved blueprint fields include `sourceSchema`, `analysisLog`, `afterFormatting`, `beforeSample`, `afterSample`, and `steps`. `formatChanges` include raw before/after sample values. Deterministic format step descriptions can embed before/after sample values. `afterFormatting` stores header values and workbook layout metadata.
- Impact: Raw sample values, formulas, customer-specific headers, filenames, column names, and formatting metadata can persist indefinitely in the database. If blueprints remain personal and cross-tenant reusable, this also creates a cross-tenant metadata exposure path for the same user.
- Minimal fix: Add a retention policy before save: redact or omit raw sample values from `analysisLog`, sanitize step descriptions/configs, store only needed style metadata, and make filename retention optional. Add a tenant opt-out for retaining examples.
- Tests needed: saving a blueprint with sensitive cell values does not persist those values in `analysisLog`, `steps`, `afterFormatting`, `sourceSchema`, or filename fields unless retention is explicitly enabled.
- Product decision required: yes.

### F-04 - AI analysis sends raw samples and fingerprints outside the app boundary

- Severity: P1
- Files:
  - `src/lib/mjolnir/engine/ai-inference.ts:50-99`
  - `src/lib/mjolnir/engine/ai-inference.ts:119-155`
  - `src/lib/mjolnir/engine/ai-inference.ts:160-208`
  - `src/lib/mjolnir/engine/ai-inference.ts:214-270`
  - `src/lib/mjolnir/engine/fingerprint.ts:220-283`
- Evidence: AI contexts include sample rows, formula contexts, removed/kept row samples, target values, top values, and min/max values.
- Impact: Sensitive workbook data may be sent to an AI provider during analysis. This is not necessarily a bug if disclosed and governed, but production needs an explicit retention/processing policy and opt-out path.
- Minimal fix: Add a tenant-level "AI sample analysis allowed" setting, redact or hash value samples by default, and make AI analysis fail closed or use deterministic inference when disabled.
- Tests needed: AI prompt builder omits raw cell values when the opt-out/redaction setting is active.
- Product decision required: yes.

### F-05 - Temporary upload cleanup is success-only

- Severity: P1
- Files:
  - `src/app/api/mjolnir/upload/route.ts:10-55`
  - `src/app/api/mjolnir/analyze/route.ts:14-115`
  - `src/app/api/mjolnir/validate/route.ts:12-53`
  - `src/lib/mjolnir/cleanup.ts:16-23`
- Evidence: Uploaded `.xlsx` files are written to `tmpdir()/hermod-mjolnir/{userId}/{fileId}.xlsx`. `cleanupTempFiles(session.user.id)` is called only after successful blueprint save.
- Impact: Abandoned uploads, failed analysis, failed validation, browser close, or skipped save can leave raw sample workbooks on disk.
- Minimal fix: Add TTL cleanup for Mjolnir temp directories and call cleanup on explicit reset/cancel where possible. Consider per-file expiry metadata.
- Tests needed: stale temp files older than TTL are deleted; cleanup does not cross user temp directories; failed save does not delete files still needed by the current session unless expired.
- Product decision required: no.

### F-06 - Bifrost route update can bypass streaming validation

- Severity: P1
- Files:
  - `src/app/api/bifrost/routes/route.ts:67-88`
  - `src/app/api/bifrost/routes/[id]/route.ts:76-84`
  - `src/lib/bifrost/forge/forge-validator.ts:12-64`
  - `src/lib/bifrost/engine.ts:322-335`
- Evidence: Bifrost route create validates selected blueprint steps for streaming. Route update validates blueprint ownership only, then saves `blueprintId`. Runtime validation exists, but update can persist a stateful blueprint before failing during execution.
- Impact: A route can be configured into a known-invalid streaming state after creation. Failures are likely handled at runtime, but this moves a preventable configuration error into production execution.
- Minimal fix: Reuse `validateBlueprintForStreaming()` in route update whenever `transformEnabled` or `blueprintId` changes.
- Tests needed: update route rejects `sort`, `aggregate`, `pivot`, `deduplicate`, `lookup`, `custom_sql`, and other stateful steps in streaming mode.
- Product decision required: no.

### F-07 - Report and Bifrost execution use mutable blueprint steps

- Severity: P1
- Files:
  - `src/lib/report-runner.ts:163-192`
  - `src/lib/bifrost/engine.ts:322-335`
  - `src/app/api/mjolnir/blueprints/[id]/route.ts:33-70`
- Evidence: Reports and Bifrost routes store `blueprintId` and execute the current `Blueprint.steps`. Updating a blueprint changes all attached reports/routes immediately.
- Impact: A benign edit, rollback attempt, validation change, or accidental update can alter scheduled report output or route transformations without touching the report/route configuration.
- Minimal fix: Introduce immutable blueprint versions for production usage and store `blueprintVersionId` on reports/routes. Updating a draft should not change existing production attachments until republished and reattached.
- Tests needed: editing a blueprint after attachment does not change existing report/route execution until the attachment is updated to a new version.
- Product decision required: yes.

### F-08 - ForgeBlueprint versioning is detached from actual execution

- Severity: P1
- Files:
  - `prisma/schema.prisma:391-440`
  - `src/lib/mjolnir/blueprint-versioning.ts:139-240`
  - `src/lib/bifrost/engine.ts:337-360`
  - `src/components/mjolnir/blueprint-version-history.tsx:53-230`
- Evidence: `ForgeBlueprintVersion` creates immutable version rows and rollback creates a new version, but Bifrost execution loads mutable `Blueprint.steps` from `BifrostRoute.blueprintId`. The engine may record execution against the latest Forge version, even though those exact steps are not what it executed.
- Impact: Version history and rollback can mislead operators. Rollback currently does not change route/report behavior. Execution tracking can imply a version was executed when the mutable user blueprint was actually used.
- Minimal fix: Choose one execution source. Prefer using tenant-owned immutable blueprint versions for execution and make ForgeBlueprint version records the source of truth for routes/gates. Remove or clearly separate the legacy user-owned `Blueprint` path.
- Tests needed: rollback changes the executed pinned version only after an explicit route/report update; execution log version matches the exact steps executed.
- Product decision required: yes.

### F-09 - Status lifecycle is not enforced

- Severity: P2
- Files:
  - `src/lib/validations/mjolnir.ts:39-44`
  - `src/components/mjolnir/mjolnir-forge.tsx:518-523`
  - `src/components/reports/report-config.tsx:73-76`
  - `src/app/api/bifrost/routes/route.ts:67-88`
  - `src/lib/bifrost/engine.ts:322-335`
- Evidence: Save requires only name and steps. The UI exposes "Skip Validation". Report selectors include `DRAFT`, `VALIDATED`, and `ACTIVE`. Bifrost attach accepts any same-user blueprint status. Bifrost runtime loads steps without checking status.
- Impact: Draft or unvalidated transformations can be attached and executed. Status names imply stronger guarantees than the code enforces.
- Minimal fix: Define allowed transitions and attach rules. Recommended: only `ACTIVE` published versions can attach to reports/routes/gates; `VALIDATED` can be published; `DRAFT` cannot attach.
- Tests needed: DRAFT attach rejected; archived attach rejected; arbitrary status transition rejected; skip validation cannot produce an attachable blueprint.
- Product decision required: yes.

### F-10 - Delete/archive behavior is unsafe and opaque

- Severity: P2
- Files:
  - `src/app/api/mjolnir/blueprints/[id]/route.ts:72-93`
  - `prisma/schema.prisma:261-283`
  - `prisma/schema.prisma:930-985`
  - `src/components/mjolnir/blueprint-list.tsx:46-65`
  - `src/components/mjolnir/blueprint-list.tsx:134-140`
- Evidence: DELETE hard-deletes a blueprint. Report and route relations use `onDelete: SetNull`. The UI warning says routes lose transformation, but it does not show which reports/routes are affected.
- Impact: A personal blueprint delete can silently remove transformations from reports/routes, potentially across multiple tenants for the same user. This can change scheduled outputs or Bifrost behavior without a targeted route/report edit.
- Minimal fix: Prefer archive over hard delete when in use. Return usage counts and names, block hard delete unless no usages remain, and add explicit detach flows.
- Tests needed: delete in-use blueprint is blocked or archives only; detach behavior is explicit; usage counts include reports and Bifrost routes.
- Product decision required: no.

### F-11 - API validation is too loose for production inputs

- Severity: P2
- Files:
  - `src/lib/validations/mjolnir.ts:4-44`
  - `src/app/api/mjolnir/blueprints/route.ts:11-35`
  - `src/app/api/mjolnir/upload/route.ts:10-55`
  - `src/app/api/blueprints/[routeId]/rollback/route.ts:7-35`
- Evidence: Step config is `z.record(z.unknown())`; `steps` has no maximum count; JSON metadata has no size/depth limit; status query values are not enum-validated; rollback body is parsed manually with minimal checks. Upload has a 50 MB file limit but no row/column limits after parse.
- Impact: Malformed or huge configs can be saved and later fail in execution, consume memory, or persist more metadata than intended.
- Minimal fix: Add per-step config schemas, max step count, max JSON payload sizes, status enum validation, row/column caps, and rollback body validation.
- Tests needed: invalid step configs rejected; oversize steps/metadata rejected; invalid status query rejected; row/column cap enforced; rollback reason length enforced.
- Product decision required: no.

### F-12 - Report create UI/API contract drops `blueprintId`

- Severity: P2
- Files:
  - `src/lib/validations/reports.ts:3-10`
  - `src/app/api/reports/route.ts:38-77`
  - `src/components/reports/report-editor.tsx:287-289`
- Evidence: The report editor sends `blueprintId` on save, but `createReportSchema` does not include it, so Zod strips it and new reports are created without the selected blueprint.
- Impact: Users can believe a report was created with a blueprint attached when the API silently ignored it. The next scheduled/manual run may not match the UI expectation.
- Minimal fix: Add nullable `blueprintId` to create validation and reuse the same ownership/status/tenant validation as update.
- Tests needed: creating a report with a valid blueprint persists it; invalid cross-tenant or invalid-status blueprint is rejected.
- Product decision required: no.

### F-13 - Main Blueprint version field does not represent real versions

- Severity: P2
- Files:
  - `prisma/schema.prisma:362-380`
  - `src/app/api/mjolnir/blueprints/[id]/route.ts:33-70`
- Evidence: `Blueprint.version` defaults to `1`, but the update route can replace `steps` without incrementing version or storing previous steps.
- Impact: The UI/model suggests versioned behavior, but production execution has no rollback or audit trail for the main blueprint path.
- Minimal fix: Either remove/display-hide the misleading field for drafts, or introduce real `BlueprintVersion` rows and increment/pin versions on publish.
- Tests needed: updating a blueprint creates a new immutable version or intentionally leaves draft version unchanged with no production impact.
- Product decision required: yes.

### F-14 - Version pruning is mostly safe but incomplete

- Severity: P2
- Files:
  - `src/lib/mjolnir/blueprint-versioning.ts:347-373`
  - `src/lib/worker.ts:146-153`
  - `prisma/schema.prisma:412-469`
- Evidence: Retention keeps 50 newest versions and skips locked or executed versions. It does not explicitly exempt `currentVersion`, relies on job data containing only `blueprintId`, and has no purge policy for `ForgeBlueprintExecution` growth.
- Impact: Current behavior is unlikely to delete active latest versions when normal version numbers are increasing, but the invariant is implicit. Execution records can grow without a visible retention policy.
- Minimal fix: Explicitly protect `currentVersion`, scope jobs to authorized internal callers, and define execution retention.
- Tests needed: pruning never deletes current version, locked version, or executed version; pruning deletes only eligible old versions; execution retention behaves as configured.
- Product decision required: no.

### F-15 - Mjolnir UI lacks production safety cues

- Severity: P3
- Files:
  - `src/components/mjolnir/mjolnir-forge.tsx:557-620`
  - `src/components/mjolnir/blueprint-list.tsx:110-140`
  - `src/components/reports/report-config.tsx:73-76`
  - `src/components/bifrost/route-editor.tsx:215-224`
  - `src/components/bifrost/sync-builder.tsx:301-317`
- Evidence: Save flow lacks privacy warning and ownership label. Blueprint list shows filenames but not retained sample metadata. Report/Bifrost selectors do not show tenant/personal ownership. There is no visible used-by report/route list in the Mjolnir list.
- Impact: Users lack the information needed to make safe choices about retention, reuse, delete/archive, and cross-tenant attach.
- Minimal fix: Add ownership/scope labels, privacy copy before save, usage counts, status badges tied to enforced lifecycle, and tenant-aware selector text.
- Tests needed: UI renders ownership labels, privacy warning, usage counts, and disables unsafe attach/delete actions.
- Product decision required: yes.

### F-16 - RealmGate forge blueprint attachment needs the same ownership checks

- Severity: P2
- Files:
  - `prisma/schema.prisma:1191-1227`
  - `src/app/api/gates/route.ts`
- Evidence: `RealmGate` can store `forgeBlueprintId`; the create route validates gate ownership by `userId + tenantId`, but no matching validation of `forgeBlueprintId` was found.
- Impact: If the UI or API starts sending a `forgeBlueprintId`, a gate may be attached to a ForgeBlueprint outside the intended tenant/route boundary.
- Minimal fix: Validate `forgeBlueprintId` by active tenant and allowed route/gate ownership before save.
- Tests needed: gate create rejects missing, cross-tenant, or unauthorized `forgeBlueprintId`; valid same-tenant forge blueprint is accepted.
- Product decision required: no.

## Sensitive Data Retention Review

| Field or path | What can be retained | Assessment |
| --- | --- | --- |
| `Blueprint.beforeSample` | Original before filename | Risky. Filenames can include customer, report, date, or environment names. |
| `Blueprint.afterSample` | Original after filename | Risky for the same reason. |
| `Blueprint.sourceSchema` | Column names, types, schema details, sometimes workbook-derived metadata | Risky. Usually not raw rows, but column names can be sensitive. |
| `Blueprint.analysisLog` | Structural diff subset saved from UI; `formatChanges` can include raw before/after sample cell values | Risky. This is the most direct persisted raw sample value path. |
| `Blueprint.afterFormatting` | Header values, row/column styles, widths, merges, freeze panes, workbook presentation metadata | Risky. Header values can include customer names, reporting dates, totals labels, or other non-row data. |
| `Blueprint.steps` | Step config, formulas, filter constants, inferred format descriptions, custom SQL configs | Risky. Steps can include literal values and formula text derived from sample files. |
| Temp files under `tmpdir()/hermod-mjolnir/{userId}` | Full uploaded before/after workbooks | Risky. Raw files remain until successful save cleanup or external temp cleanup. |
| Upload API response | `fileId`, filename, columns, row count, sample rows | Risky in transit/UI memory. Not directly persisted by upload, but later save persists selected metadata. |
| Analyze API prompt context | Sample rows, formula examples, removed/kept rows, top values, min/max values | Risky. Sent to AI provider when AI inference is enabled. |
| Analyze API response | Inferred steps, warnings, diff subset, formatting | Risky. User can save it into `Blueprint`. |
| Validate API | Reads temp files and compares output | Unknown/safe-ish. No DB persistence found, but it processes raw samples in memory. |
| `ForgeBlueprintVersion.steps` | Versioned step configs and literals | Risky if used for sample-derived values. |
| `ForgeBlueprintVersion.beforeFileHash` / `afterFileHash` | Hashes only | Safer. Hashes can still be correlatable if source files are known, but they are not raw samples. |
| `ForgeBlueprintExecution` | Input/output hashes, row counts, duration, error message | Safer for rows; risky for error messages if they include raw values. |
| `BlueprintDiffModal` version details | Displays full step configs | Risky if configs contain sensitive literals. |
| Logs and dead letters | Bifrost transform errors and chunks may be dead-lettered | Unknown in this audit. Execution errors are captured; dead-letter payload sensitivity should be audited separately if chunks include tenant data. |

Current answer to the retention questions:

- Raw before/after sample files are not stored in the database, but full workbooks are retained temporarily on disk.
- Raw sample rows can be persisted indirectly through `analysisLog.formatChanges`, `steps`, and `afterFormatting.headerValues`.
- Filenames are persisted in `beforeSample` and `afterSample`.
- Workbook formatting is persisted through `afterFormatting`, including header values and style metadata.
- Formulas and styles can contain sensitive values or references.
- AI prompts/responses are not saved as full prompts in the inspected API, but AI-derived steps/diff/formatting can be saved, and raw samples are sent to AI inference.
- Temporary files are cleaned after successful blueprint save only.
- No old-sample deletion or tenant opt-out policy was found.

## Blueprint Execution Review

Report execution:

- `Report.blueprintId` points to mutable `Blueprint`.
- `src/lib/report-runner.ts:163-192` loads by `blueprintId` only, skips only archived blueprints, and applies current `steps`.
- `sourceSchema` mismatches become warnings, not blockers.
- `afterFormatting` can be applied from the mutable blueprint.

Bifrost execution:

- `BifrostRoute.blueprintId` points to mutable `Blueprint`.
- `src/lib/bifrost/engine.ts:322-335` loads current `Blueprint.steps` by id.
- Runtime streaming validation blocks stateful steps before execution.
- Transform failures are dead-lettered through Helheim paths and processing continues at chunk granularity.
- `ForgeBlueprintVersion` can be looked up for execution tracking, but it is not the execution source.

Mutable vs versioned behavior:

- Mutable `Blueprint.steps` are the actual production behavior for reports and Bifrost routes.
- `ForgeBlueprintVersion.steps` are versioned records, but currently detached from production report/route execution.
- Rollback creates a new Forge version; it does not change the mutable `Blueprint` used by reports/routes.

Recommendation:

- Reports, Bifrost routes, and RealmGates should pin immutable blueprint versions.
- Draft edits should never change production behavior until a new version is published and explicitly attached.
- Execution logs should record the exact version ID and steps hash that were executed.
- Rollback should either update a route/report's pinned version explicitly or create a new published version that operators can attach. Silent rollback of all consumers is not recommended.

## Migration Plan

If tenant ownership or the recommended hybrid model is adopted:

Schema changes:

- Add a scope field to `Blueprint`, for example `PERSONAL_DRAFT` and `TENANT_PUBLISHED`.
- Add nullable `tenantId` to `Blueprint` during migration; require it for published/attachable blueprints.
- Add `BlueprintVersion` or reuse/merge `ForgeBlueprintVersion` as the immutable execution artifact for reports/routes/gates.
- Add `blueprintVersionId` to `Report`, `BifrostRoute`, and `RealmGate` where applicable.
- Add indexes such as `Blueprint(userId, updatedAt)`, `Blueprint(tenantId, status, updatedAt)`, and version lookup indexes.
- Add retention-policy fields if tenant-specific retention is needed.

Backfill strategy:

- Leave existing unattached `Blueprint` rows as personal drafts.
- For attached blueprints, identify all report/route tenants that reference each blueprint.
- If a blueprint is referenced by one tenant, create a tenant-published version for that tenant and pin the report/route to it.
- If a blueprint is referenced by multiple tenants, create one tenant-published copy per tenant, preserving steps and redacted metadata.
- If the owner no longer belongs to a tenant that references the blueprint, flag it for manual review rather than auto-publishing.
- Preserve old `Blueprint.id` references until all reports/routes have version pins, then remove or deprecate mutable execution references.

API changes:

- List personal drafts separately from tenant-published blueprints.
- Publish/copy endpoints must validate active tenant membership.
- Report/Bifrost/RealmGate attach endpoints must validate `tenantId`, status, and immutable version ID.
- Execution must load by `blueprintVersionId` and tenant ownership, not mutable `blueprintId`.
- Delete should block when versions are in use; archive should not silently detach production consumers.

UI changes:

- Add scope labels: personal draft, tenant published, archived.
- Add a publish-to-tenant flow.
- Add retained data disclosure before save/publish.
- Add used-by reports/routes/gates visibility.
- Add version history and rollback UI only after it is wired to actual execution behavior.
- Remove DRAFT from production selectors.

Compatibility with existing blueprints:

- Keep existing personal blueprints visible to their owner.
- Keep current attachments functional during migration through compatibility reads.
- Make new attachments use the new tenant-published version path.
- Provide an admin or owner review queue for ambiguous multi-tenant attached blueprints.

## Test Plan

Ownership and tenant tests:

- Mjolnir list returns only personal drafts plus active-tenant published blueprints, depending on the chosen model.
- Report update rejects a blueprint/version outside the active tenant.
- Bifrost route create rejects a blueprint/version outside the active tenant.
- Bifrost route update rejects a blueprint/version outside the active tenant.
- Execution cannot load a blueprint/version outside the report or route tenant.
- Same-user, multi-tenant cross-attach behavior is either rejected or explicitly allowed with guardrail tests.

Sensitive retention tests:

- Saving a blueprint with sensitive sample cell values does not persist raw values when retention is disabled.
- `analysisLog.formatChanges` is redacted or omitted.
- `afterFormatting.headerValues` is redacted or omitted according to policy.
- `steps` descriptions/configs do not include raw sample literals unless explicitly allowed.
- Original filenames are sanitized or omitted according to policy.
- AI prompt builders omit raw rows when AI sample analysis is disabled.
- Temp cleanup removes expired abandoned uploads and preserves non-expired active uploads.

Lifecycle and status tests:

- DRAFT blueprints cannot attach to reports/routes/gates.
- Archived blueprints cannot attach or execute.
- Status transitions reject invalid jumps.
- Skip-validation save cannot produce an attachable production blueprint.
- Delete in-use blueprint is blocked or archives only.
- Usage counts include reports, Bifrost routes, and RealmGates.

Versioning and rollback tests:

- Publishing creates an immutable version with a steps hash.
- Report execution uses the pinned version even after draft edits.
- Bifrost execution uses the pinned version even after draft edits.
- Execution log version ID and steps hash match the executed steps.
- Rollback creates or selects a version without silently changing unrelated consumers.
- Pruning never deletes current, locked, or executed versions.
- Pruning removes only eligible old versions.

Execution safety tests:

- Bifrost create rejects stateful steps in streaming mode.
- Bifrost update also rejects stateful steps in streaming mode.
- Runtime validation still protects legacy routes.
- Transform failures go to Helheim/dead-letter with tenant context.
- Archived or missing pinned versions fail clearly rather than silently falling back to different behavior.

API validation tests:

- Invalid step config is rejected per step type.
- Oversize step arrays are rejected.
- Oversize JSON metadata is rejected.
- Invalid status filters are rejected.
- Upload row and column caps are enforced.
- Rollback request body is zod-validated.
- Report create persists a valid blueprint/version attachment.

UI tests:

- Mjolnir save flow shows retention/privacy warning.
- Blueprint selectors show scope and tenant labels.
- Production selectors hide DRAFT blueprints.
- Delete/archive confirmation shows concrete used-by records.
- Version history/rollback UI appears only for blueprints where rollback affects execution.
- Stale state after save is cleared or refreshed.

## First Hardening Patch Results

Files changed:

- `src/lib/mjolnir/blueprint-attach.ts`
- `src/lib/validations/reports.ts`
- `src/app/api/reports/route.ts`
- `src/app/api/reports/[id]/route.ts`
- `src/app/api/bifrost/routes/route.ts`
- `src/app/api/bifrost/routes/[id]/route.ts`
- `src/app/api/gates/route.ts`
- `src/__tests__/mjolnir/blueprint-attach.test.ts`
- `src/__tests__/mjolnir/blueprint-attach-api.test.ts`
- `src/__tests__/gates-api.test.ts`
- `src/__tests__/helpers/mock-prisma.ts`
- `docs/audits/mjolnir-deep-dive.md`

What was fixed:

- Added a shared Mjolnir blueprint attach helper that validates current user ownership, rejects missing blueprints, rejects archived blueprints, and optionally enforces Bifrost streaming compatibility.
- Kept current backward-compatible behavior that allows `DRAFT`, `VALIDATED`, and `ACTIVE` blueprints to attach.
- Fixed report create so `blueprintId` is accepted by Zod, validated, and persisted instead of being silently dropped.
- Replaced report update's inline blueprint lookup with the shared helper.
- Replaced Bifrost route create's inline blueprint lookup and streaming validation with the shared helper.
- Fixed Bifrost route update so changing `transformEnabled` or `blueprintId` validates the effective blueprint/effective transform state before persisting.
- Added a low-risk RealmGate guardrail: if `forgeEnabled` and `forgeBlueprintId` are provided, the ForgeBlueprint must belong to the active tenant.

What was intentionally not fixed:

- No `tenantId` was added to `Blueprint`.
- No schema migration was introduced.
- No tenant-published blueprint model was introduced.
- No immutable blueprint version pinning was introduced.
- Cross-tenant same-user personal blueprint reuse was not blocked yet.
- DRAFT attach behavior was not narrowed yet.
- Sensitive sample retention/redaction was not changed yet.
- Existing report/Bifrost execution still uses mutable `Blueprint.steps`.

Why tenant ownership and version pinning are deferred:

- The audit found that `Blueprint` is currently modeled as a personal user asset, while reports and Bifrost routes are tenant-scoped. Changing that now would be a product/schema decision, not a narrow compatibility patch.
- Version pinning requires schema changes and migration/backfill decisions for existing report and route attachments.
- This patch centralizes and hardens the current semantics first so the later ownership/versioning migration has one attach boundary to replace.

Tests added:

- Shared helper tests for valid, DRAFT, missing, archived, and streaming-incompatible blueprints.
- Report create tests for no blueprint, valid blueprint persistence, missing blueprint rejection, and archived blueprint rejection.
- Report update tests for valid blueprint, missing blueprint rejection, and archived blueprint rejection.
- Bifrost create tests for valid streaming-compatible blueprint, missing blueprint rejection, archived blueprint rejection, and stateful blueprint rejection.
- Bifrost update tests for turning transform on with a stateful blueprint, changing to a stateful blueprint, unrelated update without revalidation, and turning transform off with a stateful blueprint attached.
- RealmGate test for rejecting a ForgeBlueprint outside the active tenant.

Validation results:

- `npx vitest run src/__tests__/mjolnir/blueprint-attach.test.ts src/__tests__/mjolnir/blueprint-attach-api.test.ts src/__tests__/gates-api.test.ts`: passed, 22 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: initially hit the known Windows EPERM Prisma DLL rename issue, then passed after moving `node_modules/.prisma` aside and regenerating.
- `npm run lint`: passed with pre-existing warnings.
- `npm run test`: failed in unrelated backup/provider/security tests due test timeouts and Vitest worker startup timeouts; the focused Mjolnir/Bifrost/report/gate tests passed.
- `npm run build`: compiled successfully and completed lint/type checking, then failed during Next page-data collection timeouts across many unrelated routes.
- `npx tsc --noEmit --pretty false`: failed on pre-existing test type errors in backup, provider, Mjolnir engine, Raven jobs, and report runner tests; no errors pointed at the first hardening patch files.

## Sensitive Retention Patch Results

Files changed:

- `src/lib/mjolnir/retention.ts`
- `src/lib/mjolnir/cleanup.ts`
- `src/lib/mjolnir/index.ts`
- `src/lib/validations/mjolnir.ts`
- `src/app/api/mjolnir/upload/route.ts`
- `src/app/api/mjolnir/analyze/route.ts`
- `src/app/api/mjolnir/validate/route.ts`
- `src/app/api/mjolnir/blueprints/route.ts`
- `src/app/api/mjolnir/blueprints/[id]/route.ts`
- `src/app/api/mjolnir/cleanup/route.ts`
- `src/components/mjolnir/mjolnir-forge.tsx`
- `src/lib/worker.ts`
- `src/__tests__/mjolnir/retention.test.ts`
- `src/__tests__/mjolnir/temp-cleanup.test.ts`
- `src/__tests__/mjolnir/retention-api.test.ts`
- `docs/audits/mjolnir-deep-dive.md`

Default retention mode:

- Default is `STANDARD`.
- `MINIMAL` can be selected through `MJOLNIR_RETENTION_MODE=MINIMAL` or `MJOLNIR_SAMPLE_RETENTION_MODE=MINIMAL`.
- `FULL_DEBUG` is available only through explicit `MJOLNIR_RETENTION_MODE=FULL_DEBUG` or `MJOLNIR_SAMPLE_RETENTION_MODE=FULL_DEBUG`.
- `FULL_DEBUG` is not the default because it can retain sample-derived data.

What is redacted or omitted by default:

- `Blueprint.beforeSample` and `Blueprint.afterSample` are sanitized to base filenames in `STANDARD` mode and stored as `null` in `MINIMAL` mode.
- `analysisLog.formatChanges` keeps structural fields such as `column` and `changeType`, but removes raw before/after/sample values.
- raw sample row collections, examples, before/after values, old/new values, source/target values, top/min/max values, and AI prompt/sample context keys are omitted or redacted from retained metadata.
- `afterFormatting.headerValues` redacts sensitive-looking values in `STANDARD` mode and is replaced with `{}` in `MINIMAL` mode.
- forge step descriptions are scrubbed for sensitive quoted literals and before/after sample snippets.
- forge step config literals are redacted when they look like sensitive sample values.
- blueprint update now runs the same sanitizer for `steps`, `analysisLog`, `afterFormatting`, `sourceSchema`, `beforeSample`, and `afterSample`.

What is still retained:

- executable transformation structure: step order, type, confidence, column names, mappings, formula structure, format patterns, sort settings, and reorder metadata.
- structural diff metadata such as matched/added/removed columns, row counts, sort detection, reorder detection, and ambiguous-case structural context.
- formatting metadata needed to reproduce output shape: widths, row heights, styles, merges, freeze panes, data row styles, and formatting column mapping.
- column names remain where needed for replay and schema validation.

Temp file TTL and cleanup:

- Temp root remains `tmpdir()/hermod-mjolnir`.
- Default TTL is 24 hours.
- TTL can be configured with `MJOLNIR_TEMP_FILE_TTL_HOURS`.
- Expired cleanup is recursive, bounded for request-time calls, best-effort, and path-safe.
- Cleanup errors are logged without full sensitive filenames.
- Expired cleanup runs in upload, analyze, validate, and worker startup.
- Successful blueprint save still cleans the current user's temp directory.

Cleanup endpoint:

- Added `POST /api/mjolnir/cleanup`.
- Requires `withAuth`.
- Accepts only `{ expiredOnly?: boolean }`.
- Rejects arbitrary path fields.
- `expiredOnly: true` deletes only expired files for the current user.
- `expiredOnly: false` deletes the current user's Mjolnir temp directory.
- Returns `{ filesDeleted, dirsDeleted }` when practical.

UI changes:

- The save step now shows a compact privacy and retention notice.
- Start Over resets local state immediately and calls `POST /api/mjolnir/cleanup` with `expiredOnly: false` without blocking the UI.

Tests added:

- `src/__tests__/mjolnir/retention.test.ts`: filename sanitization, analysis log redaction, after-formatting header handling, forge step redaction, blueprint payload sanitization, and explicit `FULL_DEBUG` behavior.
- `src/__tests__/mjolnir/temp-cleanup.test.ts`: expired deletion, non-expired preservation, outside-root safety, per-user cleanup, per-user expired cleanup, legacy `cleanupUserTempFiles`, and traversal rejection.
- `src/__tests__/mjolnir/retention-api.test.ts`: sanitized blueprint create/update persistence, auth-required cleanup endpoint, arbitrary-path rejection, current-user cleanup, and current-user expired cleanup.

Validation results:

- `npx prisma validate`: passed.
- `npx prisma generate`: initially hit the known Windows EPERM Prisma DLL rename issue, then passed after moving `node_modules/.prisma` aside and regenerating.
- `npm run test`: passed, 81 test files and 1143 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

What was intentionally not changed:

- No backup code or backup behavior was changed.
- No `tenantId` was added to `Blueprint`.
- No ownership model migration was introduced.
- No blueprint version pinning was introduced.
- The AI prompt/sample-processing product decision remains deferred; this patch controls what is retained after analysis, not whether samples may be sent for AI analysis.

Remaining product decisions:

- tenant-level retention controls.
- AI sample analysis opt-out.
- personal vs tenant-published ownership.
- immutable version pinning.

## Delete / Archive Safety Patch Results

Files changed:

- `src/lib/mjolnir/blueprint-usage.ts`
- `src/app/api/mjolnir/blueprints/[id]/route.ts`
- `src/app/api/mjolnir/blueprints/[id]/usage/route.ts`
- `src/app/api/mjolnir/blueprints/[id]/archive/route.ts`
- `src/app/api/mjolnir/blueprints/[id]/detach/route.ts`
- `src/lib/validations/mjolnir.ts`
- `src/app/(app)/mjolnir/page.tsx`
- `src/components/mjolnir/mjolnir-forge.tsx`
- `src/components/mjolnir/blueprint-list.tsx`
- `src/__tests__/mjolnir/blueprint-usage.test.ts`
- `src/__tests__/mjolnir/blueprint-delete-archive.test.ts`
- `docs/audits/mjolnir-deep-dive.md`

Usage helper:

- Added `getBlueprintUsage({ blueprintId, userId })`.
- Usage is scoped by `userId` under the current personal-blueprint ownership model.
- Reports and Bifrost routes are selected with minimal fields: id, name, tenant id/name, enabled/schedule state, and updated timestamp.
- The helper does not select SQL query text, connection credentials, source config, or destination config.

Usage API endpoint:

- Added `GET /api/mjolnir/blueprints/[id]/usage`.
- Requires `withAuth`.
- Verifies the blueprint belongs to the current user before returning usage.
- Returns 404 for missing or non-owned blueprints.

Delete behavior:

- `DELETE /api/mjolnir/blueprints/[id]` now checks usage after ownership validation.
- In-use blueprints return 409 with `{ error, usage, suggestion }`.
- Unused blueprints can still be hard-deleted.
- Reports/routes are no longer silently detached by hard-delete in the in-use case.

Archive behavior:

- Added `POST /api/mjolnir/blueprints/[id]/archive`.
- Requires `withAuth`.
- Sets `status = "ARCHIVED"` and returns the updated blueprint plus usage summary.
- The endpoint is idempotent when the blueprint is already archived.
- Existing attach validation continues to reject archived blueprints.
- Archiving does not detach existing reports or routes.

Detach behavior:

- Added `POST /api/mjolnir/blueprints/[id]/detach`.
- Accepts `{ type: "report" | "bifrost_route", targetId }`.
- Verifies the blueprint belongs to the current user.
- Verifies the target belongs to the current user and active tenant and currently references the blueprint.
- Sets the target `blueprintId` to `null`.

UI changes:

- The Mjolnir page preloads lightweight usage counts without selecting sensitive fields.
- Blueprint cards show usage counts such as `Used by 2 reports, 1 route`.
- Delete now fetches exact usage before confirmation.
- In-use blueprints show affected reports/routes and offer archive as the safe action.
- Unused blueprints keep the hard-delete confirmation.
- Archived blueprints show the existing `ARCHIVED` badge and disable archive actions.

Tests added:

- `src/__tests__/mjolnir/blueprint-usage.test.ts`: usage summary shape, safe minimal selects, and user scoping.
- `src/__tests__/mjolnir/blueprint-delete-archive.test.ts`: unused delete, in-use 409, non-owned 404, usage endpoint ownership, archive/idempotency, attach rejection for archived blueprints, and tenant-scoped detach behavior.

Validation results:

- Focused Mjolnir usage/delete/archive/attach tests passed: 4 test files and 33 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 83 test files and 1156 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

Remaining follow-ups:

- Add detach controls to the UI if product wants one-click detach from the usage dialog.
- tenant-published ownership.
- immutable version pinning.
- used-by counts across RealmGates / ForgeBlueprint if those surfaces become connected to Mjolnir blueprints.

## Status Lifecycle Patch Results

New status semantics:

- `DRAFT`: editable and visible in Mjolnir, but not attachable to reports or Bifrost routes.
- `VALIDATED`: editable, attachable, and eligible for activation.
- `ACTIVE`: attachable and intended for production use.
- `ARCHIVED`: visible in Mjolnir history/list views, not attachable, and muted in the UI.

Allowed transitions:

- `DRAFT -> VALIDATED` with validation evidence.
- `DRAFT -> ACTIVE` only with validation evidence.
- `VALIDATED -> ACTIVE`.
- `DRAFT`, `VALIDATED`, or `ACTIVE -> ARCHIVED`.
- `ARCHIVED -> DRAFT` when explicitly restored through an update path.
- `ACTIVE` or `VALIDATED -> DRAFT` when editable content changes without fresh validation evidence.

Attach rules:

- Reports and Bifrost routes can attach only `VALIDATED` and `ACTIVE` blueprints.
- `DRAFT` returns: `Blueprint must be validated before it can be attached.`
- `ARCHIVED` returns: `Archived blueprints cannot be attached.`
- Bifrost streaming compatibility validation still runs for attachable blueprints.
- Ownership remains user-scoped; no `tenantId` was added to `Blueprint`.

Create/update behavior:

- New blueprints default to `DRAFT`.
- Save with passed validation evidence can create a `VALIDATED` blueprint.
- Normal save cannot create `ACTIVE` or `ARCHIVED` blueprints.
- Update uses lifecycle transition validation instead of trusting arbitrary status changes.
- Editing `steps`, `sourceSchema`, `analysisLog`, `afterFormatting`, `beforeSample`, or `afterSample` demotes `VALIDATED`/`ACTIVE` to `DRAFT` unless fresh validation evidence accompanies a production-ready status.
- Archived blueprints must be restored to `DRAFT` before normal edits.

UI changes:

- Mjolnir save copy now explains whether the blueprint will be saved as `DRAFT` or `VALIDATED`.
- Passed validation save sends validation evidence and requests `VALIDATED`; skipped or failed validation saves as `DRAFT`.
- Blueprint list shows status badges, DRAFT/ACTIVE/ARCHIVED hints, muted archived rows, Activate for `VALIDATED`, and Archive where allowed.
- Report and Bifrost production selectors request `VALIDATED,ACTIVE` by default.
- Existing legacy/current DRAFT or ARCHIVED attachments can be included as disabled current options so users can see what is attached without selecting those statuses for new attachments.

Runtime compatibility behavior:

- Report execution warns when running a legacy `DRAFT` blueprint but does not break existing scheduled reports.
- Report execution continues to skip `ARCHIVED` blueprints and falls back to column config mapping.
- Bifrost runtime warns for legacy `DRAFT` blueprints and fails clearly for `ARCHIVED` blueprints.

Tests added or updated:

- `src/__tests__/mjolnir/blueprint-status.test.ts`: enum detection, attach/edit status rules, transitions, validation evidence, and demotion detection.
- `src/__tests__/mjolnir/blueprint-status-api.test.ts`: create defaults, validation-backed create, direct ACTIVE rejection, transition enforcement, and content-change demotion.
- `src/__tests__/mjolnir/blueprint-attach.test.ts`: DRAFT rejection, VALIDATED/ACTIVE acceptance, ARCHIVED rejection, and streaming validation preservation.
- `src/__tests__/mjolnir/blueprint-attach-api.test.ts`: report and Bifrost create/update rejection for DRAFT blueprints.
- `src/__tests__/mjolnir/validations.test.ts`: create status default and arbitrary status rejection.

Validation results:

- Focused Mjolnir lifecycle/attach/API validation tests passed: 7 test files and 84 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 85 test files and 1177 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

Remaining follow-ups:

- tenant-published ownership.
- immutable version pinning.
- publish-to-tenant flow.
- legacy DRAFT attachment migration.

## API Validation Hardening Patch Results

Limits added:

- `MAX_BLUEPRINT_STEPS = 100`.
- `MAX_STEP_CONFIG_DEPTH = 8`.
- `MAX_STEP_CONFIG_JSON_BYTES = 250,000`.
- `MAX_ANALYSIS_LOG_JSON_BYTES = 500,000`.
- `MAX_AFTER_FORMATTING_JSON_BYTES = 500,000`.
- `MAX_BLUEPRINT_NAME_LENGTH = 200`.
- `MAX_DESCRIPTION_LENGTH = 5,000`.
- `MAX_UPLOAD_ROWS_FOR_ANALYSIS = 10,000`.
- `MAX_UPLOAD_COLUMNS_FOR_ANALYSIS = 500`.

What is rejected:

- Blueprint create/update payloads with arbitrary status strings.
- Empty or unknown `status` query filters on `GET /api/mjolnir/blueprints`.
- Blueprint step arrays above the step cap.
- Step configs that are not plain JSON objects.
- Step configs with non-JSON values, excessive depth, circular references, too many entries, or excessive serialized byte size.
- Oversized `sourceSchema`, `analysisLog`, and `afterFormatting` metadata.
- Uploaded workbooks whose parsed row or column counts exceed the Mjolnir analysis caps.
- Malformed rollback bodies, invalid rollback versions, and rollback reasons above the allowed length.

What remains flexible:

- Step configs are still schema-flexible by step type so existing valid forge workflows keep working.
- Structural metadata, column names, formatting metadata, and validation evidence remain accepted within the size/depth limits.
- Upload parsing still supports the existing `.xlsx` flow and workbook shape detection before enforcing the analysis caps.

Tests added:

- `src/__tests__/mjolnir/mjolnir-validation.test.ts`: valid create payloads, step count cap, huge/deep config rejection, invalid status rejection, status query rejection, oversized metadata rejection, upload row/column cap behavior, and rollback body validation.

Validation results:

- Focused Mjolnir validation test passed: 1 test file and 15 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 87 test files and 1200 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

## RealmGate Forge Blueprint Validation Patch Results

API paths checked:

- `POST /api/gates`: accepts `forgeEnabled` and `forgeBlueprintId` during RealmGate creation.
- `PATCH /api/gates/[gateId]`: now explicitly handles `forgeEnabled` and `forgeBlueprintId` updates.
- `GET /api/gates` and `GET /api/gates/[gateId]`: read-only paths; no attachment writes.
- Report and Bifrost route APIs accept Mjolnir `blueprintId`, not RealmGate `forgeBlueprintId`; existing Mjolnir attach validation remains unchanged.

Validation behavior:

- Added `src/lib/mjolnir/forge-blueprint-attach.ts`.
- Missing or empty `forgeBlueprintId` remains valid and stores no attachment.
- Provided ForgeBlueprint IDs must exist.
- ForgeBlueprints with a tenant must match the active tenant.
- ForgeBlueprints with a null tenant must still have an owning route in the active tenant.
- The owning Bifrost route must belong to the current user and active tenant.
- `ARCHIVED` ForgeBlueprints are rejected.
- Validation selects only IDs, status, tenant, and owning route boundary fields; it does not return credentials, SQL, source configs, or destination configs.

Tests added or updated:

- `src/__tests__/mjolnir/forge-blueprint-attach.test.ts`: absent IDs, same-tenant attach, null-tenant/route-bound attach, missing ID rejection, cross-tenant rejection, cross-user route rejection, archived rejection, and sensitive detail omission.
- `src/__tests__/gates-api.test.ts`: create without forge blueprint, create with same-tenant forge blueprint, missing create rejection, cross-tenant create rejection, cross-tenant update rejection, and sensitive detail omission.

Validation results:

- Focused RealmGate forge blueprint tests passed: 2 test files and 13 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 87 test files and 1207 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

Remaining follow-ups:

- Tenant-published ownership for production blueprints.
- Immutable version pinning for report, Bifrost, and RealmGate attachments.
- A fuller RealmGate UI flow for selecting available ForgeBlueprints when product rules are finalized.

## AI Sample Privacy Patch Results

Default AI sample mode:

- `REDACTED`.
- `FULL_DEBUG` is available only through explicit `MJOLNIR_AI_SAMPLE_MODE=FULL_DEBUG`.
- `STRUCTURAL_ONLY` is available through `MJOLNIR_AI_SAMPLE_MODE=STRUCTURAL_ONLY`.

What AI can receive:

- In `REDACTED` mode, AI prompt context may include column names, structural diff metadata, row counts, matched/added/removed column signals, and formula/formatting context with sensitive literals redacted.
- In `STRUCTURAL_ONLY` mode, AI prompt context is reduced to structure: columns, row counts, matched/added/removed/reorder signals, sanitized fingerprints, and formatting change shape.
- In `FULL_DEBUG` mode, the older richer prompt context is preserved for debugging and may include sample-derived workbook values.

What is redacted or removed:

- Emails, phone numbers, URLs, SSNs, UUIDs, long tokens, long numeric IDs, paths, and workbook-like filenames.
- Row/sample payloads such as `sampleRows`, `sampleData`, `beforeRow`, `afterRow`, `removedRows`, and `keptRows`.
- Sample scalar fields such as `beforeValue`, `afterValue`, `sampleValue`, `targetValue`, `sourceValue`, `oldValue`, `newValue`, `topValues`, `minValue`, `maxValue`, `value`, and `values` when they appear in outbound AI context.
- Formula string literals are sanitized before prompt construction in default mode.
- Fingerprint values that reveal sample-derived content, including `sampleHash`, `topValues`, `minValue`, and `maxValue`, are omitted from AI context in non-debug modes.

UI/API behavior:

- `POST /api/mjolnir/analyze` now returns an `aiSamplePolicy` description.
- The Mjolnir forge review step displays a subtle AI sample privacy notice.
- The existing save-step retention notice remains in place for persisted blueprint data.

Tests added or updated:

- `src/__tests__/mjolnir/ai-sample-policy.test.ts`: default mode, structural-only removal, redaction coverage, explicit `FULL_DEBUG`, non-mutating sanitization, and formula literal redaction.
- `src/__tests__/mjolnir/ai-inference.test.ts`: provider prompt payloads no longer include raw sensitive values in default mode and omit row samples in `STRUCTURAL_ONLY` mode.

Validation results:

- Focused AI sample policy tests passed: 2 test files and 22 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 88 test files and 1215 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

Remaining product decisions:

- Tenant-level AI sample analysis opt-out or mode selection.
- User-visible AI consent for sample analysis.
- Model/provider retention disclosures.

## Blueprint Execution Visibility Patch Results

Descriptors recorded:

- Added `src/lib/mjolnir/blueprint-execution-descriptor.ts`.
- Mutable main `Blueprint.steps` executions now produce a descriptor with `blueprintId`, `blueprintName`, `blueprintStatus`, `blueprintVersionId: null`, a stable `stepsHash`, `executionMode: "MUTABLE_LEGACY"`, and a warning string.
- `hashBlueprintSteps()` hashes executable step shape and config with stable object key ordering, while ignoring non-execution prose like step descriptions.
- `executionMode: "PINNED_VERSION"` is reserved for the future immutable version-pinning migration.

What remains mutable legacy:

- Report execution still loads current mutable `Blueprint.steps` when `Report.blueprintId` is present.
- Bifrost route execution still loads current mutable `Blueprint.steps` when `transformEnabled` and `blueprintId` are present.
- Existing legacy DRAFT runtime behavior is unchanged; new DRAFT attachments remain blocked by status attach rules.
- ARCHIVED runtime safeguards remain unchanged.

Report and route execution visibility:

- `src/lib/report-runner.ts` now computes the descriptor for mutable blueprint executions, returns it in the in-memory pipeline result, and logs a structured warning.
- `src/lib/bifrost/engine.ts` now computes the descriptor for mutable route transforms, returns it in `RouteJobResult`, and logs a structured warning.
- When Bifrost keeps the existing `ForgeBlueprintExecution` tracking against the latest `ForgeBlueprintVersion`, it now logs that this is `versionTrackingOnly=true` and that the executed source was mutable `Blueprint.steps`, not the ForgeBlueprintVersion record.
- `RunLog` and `RouteLog` do not currently have JSON metadata/detail fields, so descriptors are not persisted to history without a schema migration.

UI visibility:

- Report and Bifrost history badges were skipped in this patch because the existing history APIs cannot expose descriptor metadata without storing it first.
- Future UI should show "Mutable blueprint" or "Version pinned" once immutable version execution metadata is persisted.

Tests added or updated:

- `src/__tests__/mjolnir/blueprint-execution-descriptor.test.ts`: stable hash, hash changes on executable changes, mutable legacy descriptor mode, warning text, and no warning for pinned descriptors.
- `src/__tests__/report-pipeline.test.ts`: report pipeline returns a mutable descriptor and skips descriptors for archived blueprints.
- `src/__tests__/bifrost/bifrost-engine.test.ts`: Bifrost returns a mutable descriptor and warns when ForgeBlueprintVersion tracking is not the source of executed steps.

Validation results:

- Focused execution visibility tests passed: 3 test files and 38 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 89 test files and 1222 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

Remaining follow-up:

- Full immutable version pinning migration for reports, Bifrost routes, and RealmGates.
- Optional `RunLog`/`RouteLog` metadata fields so execution descriptors can be persisted and shown in history UI.

## Version Pruning and Execution Retention Patch Results

Current version protection:

- `src/lib/mjolnir/blueprint-versioning.ts` now explicitly loads `ForgeBlueprint.currentVersion` before pruning versions.
- The current version is always protected, even when it falls outside the retained latest-version window.
- Version 1 remains protected by default and can only be pruned through an explicit helper option when it is not current, locked, or executed.

Locked and executed version protection:

- Locked `ForgeBlueprintVersion` records remain protected.
- Versions referenced by any `ForgeBlueprintExecution` remain protected.
- The newest `MJOLNIR_VERSION_RETENTION_COUNT` versions remain protected by retention order.
- Default version retention remains 50 versions.

Execution retention policy:

- Added explicit defaults:
  - `DEFAULT_BLUEPRINT_VERSION_RETENTION = 50`
  - `DEFAULT_BLUEPRINT_EXECUTION_RETENTION_DAYS = 180`
  - `DEFAULT_BLUEPRINT_EXECUTION_MAX_RECORDS = 5000`
- Added env overrides:
  - `MJOLNIR_VERSION_RETENTION_COUNT`
  - `MJOLNIR_EXECUTION_RETENTION_DAYS`
  - `MJOLNIR_EXECUTION_RETENTION_MAX`
- Added `pruneBlueprintExecutions()` with optional `blueprintId`, `tenantId`, `olderThanDays`, and `maxRecordsPerBlueprint` filters.
- Execution pruning deletes old completed executions in bounded batches, never deletes `RUNNING` executions, keeps recent executions, and protects executions tied to current or locked versions when practical.

Worker/job behavior:

- The existing `prune-blueprint-versions` worker job now also prunes old execution records for the same ForgeBlueprint.
- Added a `prune-blueprint-executions` worker job for execution-retention cleanup after execution completion.
- `completeExecution()` now enqueues execution pruning with a per-blueprint singleton key, keeping cleanup asynchronous and bounded.

Tests added:

- `src/__tests__/mjolnir/blueprint-retention.test.ts`: current version protection, locked version protection, executed version protection, old unlocked/unexecuted version pruning, env retention count override, non-deletion of `RUNNING` executions, old completed execution pruning, max-record pruning, and bounded batch behavior.

Validation results:

- Focused blueprint retention tests passed: 1 test file and 7 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 90 test files and 1229 tests.
- `npm run build`: passed; pre-existing lint warnings were reported during the build.
- `npm run lint`: passed with pre-existing warnings.

## Production Safety UI Patch Results

Status badges:

- Added `src/components/mjolnir/blueprint-status-badge.tsx`.
- Shared labels now cover `DRAFT`, `VALIDATED`, `ACTIVE`, and `ARCHIVED`.
- Helper text is explicit:
  - `DRAFT`: Validate before attaching.
  - `VALIDATED`: Ready to attach.
  - `ACTIVE`: Production-ready.
  - `ARCHIVED`: Not attachable.
- The Mjolnir saved blueprint list now uses the shared status badge and a personal-scope badge, and archived rows remain visually muted.

Selector filtering:

- Report and Bifrost production selectors use shared helpers to present only attachable `VALIDATED` and `ACTIVE` blueprints as normal options.
- Native select labels include status, for example `Monthly Cleanup (VALIDATED)`.
- DRAFT and ARCHIVED blueprints are not offered as normal new selections.

Legacy blueprint warnings:

- If an existing report or route already references a DRAFT or ARCHIVED blueprint, the selector displays `Current legacy blueprint: <name> (<status>)` as a disabled current option.
- Warning copy explains that the legacy blueprint remains attached for existing use but cannot be selected for new attachments.

Used-by visibility:

- BlueprintList now exposes a lazy `Used By` action per blueprint.
- The existing usage endpoint is fetched only when the user opens usage details.
- Usage details show report and Bifrost route names, tenant context, and enabled/disabled state without exposing SQL, route configs, credentials, or source/destination configuration.

Privacy cues:

- The existing save-step retention notice remains in place.
- The forge upload step now reminds users to use small representative samples and notes that raw values are redacted before save by default.

Tests added:

- `src/__tests__/mjolnir/blueprint-ui-helpers.test.ts`: status labels/helper text, attachable status checks, production selector filtering, native option labels, legacy current blueprint labels, and usage summary text.

Validation results:

- Focused blueprint UI helper tests passed: 1 test file and 6 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 91 test files and 1235 tests.
- `npm run build`: passed with existing lint warnings reported during the build.
- `npm run lint`: passed with existing warnings.

## Recommended Next Prompt

Make the product decision for Mjolnir ownership and retention before the next schema change:

1. Decide whether production blueprints should be tenant-owned or hybrid personal-draft/tenant-published.
2. Decide what sample-derived fields may be retained by default.
3. Decide whether production attach should require `ACTIVE` tenant-published versions.
4. Then implement the schema/API migration for tenant-published immutable blueprint versions and report/Bifrost/RealmGate version pins.

Do not start the migration until those product decisions are made.

## Tenant-Published Publish Flow Note

- Phase 2 of immutable version pinning adds a tenant-published publish flow without switching production consumers yet.
- `POST /api/mjolnir/blueprints/[id]/publish` creates or reuses a tenant-published parent for the active tenant and creates a locked immutable `BlueprintVersion`.
- `GET /api/mjolnir/published-blueprints` lists active-tenant published parents and optional latest version summaries without raw steps or analysis metadata.
- Personal drafts remain editable, and report/Bifrost/RealmGate execution still uses legacy mutable `blueprintId` / `forgeBlueprintId` paths until the dedicated pinning phases.
