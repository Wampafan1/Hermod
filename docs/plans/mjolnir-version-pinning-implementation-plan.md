# Mjolnir Tenant-Published Version Pinning Implementation Plan

Date: 2026-05-09

Status: planning only. No schema or code changes are included in this document.

## Goals

Move Mjolnir from user-owned mutable production attachments to a hybrid model:

- Personal draft blueprints remain useful for experimentation.
- Production consumers attach only tenant-published immutable blueprint versions.
- Reports, Bifrost routes, and RealmGates pin a specific version, so later edits or rollbacks do not silently change execution.
- Existing mutable `blueprintId` fields remain temporarily during migration for compatibility and backfill.

This plan addresses the deep dive findings:

- F-01: ambiguous `Blueprint` ownership.
- F-02: same-user cross-tenant attach ambiguity.
- F-07: mutable `Blueprint.steps` used in production execution.
- F-08: `ForgeBlueprintVersion` exists but is detached from actual Mjolnir production execution truth.
- F-13: `Blueprint.version` does not represent real immutable versions.

## Non-Goals

- Do not redesign backups.
- Do not upgrade or reconfigure Next.js.
- Do not run a broad critical audit.
- Do not remove legacy fields in the first migration.
- Do not force all personal drafts into tenant ownership.
- Do not make RealmGate select Forge blueprints from Bifrost route history as the long-term model without a product decision.

## 1. Current State Map

### Models

`Blueprint`

- Current purpose: Mjolnir user-owned blueprint created from BEFORE/AFTER workbook analysis.
- Ownership: `userId` only.
- Status: `DRAFT`, `VALIDATED`, `ACTIVE`, `ARCHIVED`.
- Mutable production-relevant fields:
  - `steps`
  - `sourceSchema`
  - `analysisLog`
  - `afterFormatting`
  - `beforeSample`
  - `afterSample`
  - `status`
  - `name`
  - `description`
- `version` exists but is a simple integer defaulting to `1`; it is not tied to immutable version rows.
- Relations:
  - `Report.blueprintId`
  - `BifrostRoute.blueprintId`

`Report`

- Tenant-scoped with `tenantId`.
- User-scoped with `userId`.
- Currently stores `blueprintId`.
- `blueprintId` has `onDelete: SetNull`.
- Execution calls `executeReportPipeline()` with `report.blueprintId`.

`BifrostRoute`

- Tenant-scoped with `tenantId`.
- User-scoped with `userId`.
- Currently stores `transformEnabled` and `blueprintId`.
- `blueprintId` has `onDelete: SetNull`.
- Runtime engine and Raven resume load `Blueprint.steps` from `route.blueprintId`.
- Also has a separate one-to-one `forgeBlueprint` relation to `ForgeBlueprint`.

`ForgeBlueprint`

- Route-scoped parent object keyed by `routeId @unique`.
- Optional `tenantId`.
- Has `currentVersion`.
- Used by Bifrost route version history APIs and execution tracking.
- Not used as the source of report execution truth.
- RealmGate can store `forgeBlueprintId`.

`ForgeBlueprintVersion`

- Immutable-ish append-only record for `ForgeBlueprint`.
- Stores `steps`, `stepsHash`, source metadata, AI metadata, lock flags, and execution relation.
- Unique by `(blueprintId, version)`.
- Represents route forge history, not generic Mjolnir tenant-published blueprint versions.

`ForgeBlueprintExecution`

- Tracks executions for `ForgeBlueprintVersion`.
- Bifrost engine attempts to record execution against the latest route `ForgeBlueprintVersion` when a route-level `ForgeBlueprint` exists.
- Report execution does not record this.
- RealmGate execution does not currently have equivalent version-pinned execution truth.

`RealmGate`

- Tenant-scoped with required `tenantId`.
- Has `forgeEnabled` and `forgeBlueprintId`.
- `forgeBlueprintId` points to `ForgeBlueprint`, not `Blueprint`.
- Current hardening validates the ForgeBlueprint tenant/route boundary, but does not pin a version.

### Current Attachment Rules

Reports and Bifrost routes:

- Validate `Blueprint` ownership by `userId`.
- Do not require tenant ownership because `Blueprint` has no `tenantId`.
- Reject `DRAFT` and `ARCHIVED` for new attachments.
- Allow `VALIDATED` and `ACTIVE`.
- Bifrost additionally validates streaming compatibility.
- Existing legacy attachments can remain.

RealmGate:

- Uses `forgeBlueprintId`, not Mjolnir `blueprintId`.
- Validates the active tenant and owning route boundary.
- Does not pin a `ForgeBlueprintVersion`.

### Execution Paths Using Mutable `Blueprint.steps`

Report runner:

- `src/lib/report-runner.ts` loads `prisma.blueprint.findUnique({ where: { id: input.blueprintId } })`.
- It executes `blueprint.steps`.
- It uses `blueprint.sourceSchema` and `blueprint.afterFormatting`.
- Editing the attached `Blueprint` changes future report output.

Bifrost engine:

- `src/lib/bifrost/engine.ts` loads `prisma.blueprint.findUniqueOrThrow({ where: { id: route.blueprintId } })`.
- It executes `blueprint.steps`.
- It separately records execution against the latest `ForgeBlueprintVersion` for the route if one exists, but the executed steps came from the mutable `Blueprint`, not necessarily that version.

Bifrost Raven resume:

- `src/lib/bifrost/jobs/raven-resume.handler.ts` also loads `Blueprint.steps` from `route.blueprintId`.

Ad hoc report/test-send/schedule wrappers:

- `src/app/api/reports/[id]/test-send/route.ts` and schedule send-now paths pass the report `blueprintId` into the same report pipeline.

### Where `ForgeBlueprintVersion` Is Not Source Of Truth

- Report execution does not use `ForgeBlueprintVersion`.
- Bifrost execution loads mutable `Blueprint.steps`, then may record latest `ForgeBlueprintVersion` metadata for the route.
- RealmGate stores a `ForgeBlueprint`, not a version.
- Rollback creates a new `ForgeBlueprintVersion` for a Bifrost route's ForgeBlueprint, but does not automatically repin reports, Bifrost route `blueprintId`, or RealmGates.

## 2. Target Model

### Personal Draft Blueprint

Personal drafts remain the working copy for experimentation:

- Owned by a user.
- Optionally associated with a tenant for default workspace context.
- Editable while `DRAFT`, `VALIDATED`, or `ACTIVE` under current lifecycle rules.
- Not attachable to new production consumers directly after the migration.
- Publishable to a tenant-owned immutable version.

Recommended semantics:

- `Blueprint.scope = PERSONAL_DRAFT`.
- `Blueprint.userId` remains required.
- `Blueprint.tenantId` is nullable and records the workspace where it was created or last intentionally scoped.
- `Blueprint.steps` remains mutable working-copy data.
- `Blueprint.version` is deprecated and later removed or renamed after migration.

### Tenant-Published Blueprint

Tenant-published blueprint is the stable production parent:

- Tenant-owned.
- Created by publishing a personal draft.
- Holds name, description, status, and metadata.
- Does not itself carry mutable execution steps.
- Has immutable version rows.

Recommended semantics:

- `PublishedBlueprint` or an enhanced `Blueprint` row with `scope = TENANT_PUBLISHED`.
- Required `tenantId`.
- Required creator/publisher audit fields.
- Status controls whether new attachments are allowed.
- Archiving blocks new attachments but does not break pinned existing executions.

### Immutable Version Record

Immutable version is the execution source of truth:

- Append-only.
- Stores `steps`, `sourceSchema`, `afterFormatting`, sanitized analysis metadata, `stepsHash`, version number, and publish metadata.
- Once attached or executed, never mutate or delete.
- Soft-retain old versions; prune only unattached and never-executed versions after a long retention window if product approves.

Recommended semantics:

- `BlueprintVersion` is the generic Mjolnir production version table.
- Reuse logic from `src/lib/mjolnir/blueprint-versioning.ts` for step identity, hashing, diff, lock, and execution tracking where practical.
- Do not reuse `ForgeBlueprintVersion` as-is for generic Mjolnir production pinning because it is currently route-owned through `ForgeBlueprint.routeId @unique`.

### Report Attachment To Version

Reports should store:

- `blueprintVersionId` as the production execution pointer.
- Legacy `blueprintId` during migration only.
- Optional denormalized `blueprintId` or `publishedBlueprintId` for easier UI usage if needed, but execution must load by version ID.

Runtime rule:

- If `blueprintVersionId` is present, report execution uses that version's steps/schema/formatting.
- Legacy `blueprintId` fallback is allowed only during migration and should log/report a warning.

### Bifrost Route Attachment To Version

Bifrost routes should store:

- `blueprintVersionId` for Mjolnir transformation.
- Legacy `blueprintId` during migration only.
- Existing `ForgeBlueprint` route history can continue for route-specific Forge tooling until merged or deprecated.

Runtime rule:

- If `transformEnabled` and `blueprintVersionId` are present, Bifrost loads that immutable version.
- Streaming compatibility is validated at publish and attach time.
- Legacy `blueprintId` fallback is allowed only during migration.

### RealmGate Attachment To Version

RealmGate currently attaches to `ForgeBlueprint`, so there are two viable target paths:

Option A - recommended generic Mjolnir pin:

- Add `blueprintVersionId` to `RealmGate`.
- Keep `forgeBlueprintId` temporarily for current route-forge integrations.
- `forgeEnabled` means use a pinned Mjolnir/Forge version.
- New RealmGate attachments use `blueprintVersionId`.

Option B - route Forge pin:

- Add `forgeBlueprintVersionId` to `RealmGate`.
- Continue to require `forgeBlueprintId`.
- Runtime uses `ForgeBlueprintVersion.steps`.

Recommendation:

- Use generic `blueprintVersionId` for RealmGate if RealmGate is meant to consume tenant-published Mjolnir transformations.
- Keep `forgeBlueprintVersionId` only if product wants RealmGate to attach specifically to a Bifrost route's Forge history.
- The plan below includes both fields as alternatives, with Option A as the primary path.

## 3. Schema Migration Proposal

### Enums

```prisma
enum BlueprintScope {
  PERSONAL_DRAFT
  TENANT_PUBLISHED
}

enum BlueprintVersionSource {
  PUBLISH
  REPUBLISH
  ROLLBACK
  BACKFILL
  IMPORT
}
```

### Blueprint Changes

Keep `Blueprint` as the draft table at first, then optionally evolve it into a parent table later.

Phase 1 additive fields:

```prisma
model Blueprint {
  id              String          @id @default(cuid())
  name            String
  description     String?
  version         Int             @default(1) // deprecated after version table exists
  steps           Json
  sourceSchema    Json?
  analysisLog     Json?
  afterFormatting Json?
  beforeSample    String?
  afterSample     String?
  status          BlueprintStatus @default(DRAFT)

  scope           BlueprintScope  @default(PERSONAL_DRAFT)
  tenantId        String?
  tenant          Tenant?         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  publishedFromId String?
  publishedFrom   Blueprint?      @relation("BlueprintPublishLineage", fields: [publishedFromId], references: [id], onDelete: SetNull)
  publishedCopies Blueprint[]     @relation("BlueprintPublishLineage")

  userId          String
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  versions        BlueprintVersion[]
  reports         Report[]
  bifrostRoutes   BifrostRoute[]
  realmGates      RealmGate[]
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([userId, scope, updatedAt])
  @@index([tenantId, scope, status, updatedAt])
  @@index([publishedFromId])
}
```

Notes:

- For phase 1, do not make `tenantId` required.
- For phase 1, do not move production consumers to `Blueprint.scope = TENANT_PUBLISHED` until backfill and attach validation are ready.
- If using a separate `PublishedBlueprint` table, keep `Blueprint` untouched except `tenantId`; however, that creates more transition code. Reusing `Blueprint` as parent plus `scope` is lower-risk for Prisma relations.

### New Generic Version Model

```prisma
model BlueprintVersion {
  id              String                 @id @default(cuid())
  blueprintId     String
  blueprint       Blueprint              @relation(fields: [blueprintId], references: [id], onDelete: Cascade)
  tenantId        String
  tenant          Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  version         Int

  steps           Json
  stepsHash       String
  sourceSchema    Json?
  afterFormatting Json?
  analysisLog     Json?

  source          BlueprintVersionSource @default(PUBLISH)
  sourceDraftId   String?
  sourceDraft     Blueprint?             @relation("BlueprintVersionSourceDraft", fields: [sourceDraftId], references: [id], onDelete: SetNull)

  changeReason    String?
  changeSummary   Json?
  validation       Json?
  aiModelUsed      String?
  aiConfidence     Float?

  isLocked        Boolean                @default(true)
  lockedAt        DateTime?              @default(now())
  lockedBy        String?
  createdAt       DateTime               @default(now())
  createdBy       String?

  reports         Report[]
  bifrostRoutes   BifrostRoute[]
  realmGates      RealmGate[]
  executions      BlueprintVersionExecution[]

  @@unique([blueprintId, version])
  @@index([tenantId, blueprintId, version])
  @@index([tenantId, createdAt])
  @@index([stepsHash])
}
```

### Execution Audit Model

```prisma
model BlueprintVersionExecution {
  id                  String           @id @default(cuid())
  blueprintVersionId  String
  blueprintVersion    BlueprintVersion @relation(fields: [blueprintVersionId], references: [id], onDelete: Restrict)
  tenantId            String
  tenant              Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  consumerType        String           // "report" | "bifrost_route" | "realm_gate"
  consumerId          String
  runLogId            String?
  routeLogId          String?
  gatePushId          String?

  stepsHash           String
  status              String           // "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED"
  inputRowCount       Int?
  outputRowCount      Int?
  inputHash           String?
  outputHash          String?
  errorMessage        String?
  errorStep           Int?
  startedAt           DateTime         @default(now())
  completedAt         DateTime?

  @@index([blueprintVersionId, startedAt])
  @@index([tenantId, consumerType, consumerId, startedAt])
}
```

This can replace or coexist with `ForgeBlueprintExecution`. Coexistence is safer during migration.

### Report Fields

```prisma
model Report {
  blueprintId        String?           // legacy fallback, remove in phase 7
  blueprint          Blueprint?        @relation(fields: [blueprintId], references: [id], onDelete: SetNull)
  blueprintVersionId String?
  blueprintVersion   BlueprintVersion? @relation(fields: [blueprintVersionId], references: [id], onDelete: Restrict)

  @@index([tenantId, blueprintVersionId])
}
```

On-delete recommendation:

- `blueprintVersionId`: `Restrict`.
- Do not allow deleting a version that is attached or has execution records.
- Archive parent instead of deleting production history.

### BifrostRoute Fields

```prisma
model BifrostRoute {
  blueprintId        String?           // legacy fallback, remove in phase 7
  blueprint          Blueprint?        @relation(fields: [blueprintId], references: [id], onDelete: SetNull)
  blueprintVersionId String?
  blueprintVersion   BlueprintVersion? @relation(fields: [blueprintVersionId], references: [id], onDelete: Restrict)

  @@index([tenantId, blueprintVersionId])
}
```

### RealmGate Fields

Recommended Option A:

```prisma
model RealmGate {
  forgeBlueprintId   String?           // legacy/current route-forge pointer
  forgeBlueprint     ForgeBlueprint?   @relation(fields: [forgeBlueprintId], references: [id], onDelete: SetNull)
  blueprintVersionId String?
  blueprintVersion   BlueprintVersion? @relation(fields: [blueprintVersionId], references: [id], onDelete: Restrict)

  @@index([tenantId, blueprintVersionId])
}
```

Alternative Option B:

```prisma
model RealmGate {
  forgeBlueprintVersionId String?
  forgeBlueprintVersion   ForgeBlueprintVersion? @relation(fields: [forgeBlueprintVersionId], references: [id], onDelete: Restrict)

  @@index([tenantId, forgeBlueprintVersionId])
}
```

Recommendation:

- Implement Option A unless product confirms RealmGate must be bound to Bifrost route Forge history.
- If both are needed, make them mutually exclusive at API validation time.

## 4. Backfill Strategy

Backfill must be additive, idempotent, and resumable.

### Classification Pass

Build a script or migration helper that scans:

- All `Blueprint` rows.
- `Report` rows with `blueprintId`.
- `BifrostRoute` rows with `blueprintId`.
- `RealmGate` rows with `forgeBlueprintId`.
- Existing `ForgeBlueprint` and `ForgeBlueprintVersion` rows.

For each `Blueprint`, compute:

- Attached consumer count.
- Distinct tenant IDs across attached reports/routes.
- Whether any attached consumer lacks `tenantId`.
- Whether the owning user has membership in each tenant.
- Whether status is `VALIDATED` or `ACTIVE`.
- `stepsHash` for current `steps`.

### Unattached Blueprints

Rule:

- Leave as `scope = PERSONAL_DRAFT`.
- Set `tenantId` to null unless there is a trustworthy active tenant provenance.
- Do not create a `BlueprintVersion`.

Reason:

- Unattached blueprints are not production execution artifacts.

### Attached Single-Tenant Blueprints

Rule:

- Create or convert a tenant-published parent for that tenant.
- Create immutable version `v1` from the current sanitized `Blueprint` fields.
- Set `Report.blueprintVersionId` and `BifrostRoute.blueprintVersionId` for consumers in that tenant.
- Keep legacy `blueprintId` unchanged for fallback until phase 7.

If reusing `Blueprint` as parent:

- Option 1: convert current row to `TENANT_PUBLISHED` and create a personal draft copy.
- Option 2, safer: keep current row as personal draft and create a new tenant-published copy with `publishedFromId`.

Recommendation:

- Use Option 2. It preserves the user's editable draft exactly and avoids surprising UI changes.

### Multi-Tenant Same-User Attachments

Rule:

- Create one tenant-published parent per tenant.
- Create one immutable version per tenant from the same current `Blueprint.steps`.
- Attach each tenant's reports/routes to that tenant's version.
- Keep the original `Blueprint` as the personal draft.

Reason:

- This resolves same-user cross-tenant ambiguity without inventing a shared ownership model.

### Ambiguous Cases

Flag for manual review:

- Attached consumer has `tenantId = null`.
- Attached consumer tenant is not in the blueprint owner's memberships.
- Multiple users appear to depend on a route Forge artifact in a way that cannot be explained by current relations.
- Blueprint status is `DRAFT` but attached to production consumer.
- Current `Blueprint.steps` fails current validation limits or streaming validation for a Bifrost consumer.
- `Blueprint` is `ARCHIVED` but still attached.
- Consumers have conflicting expectations for `sourceSchema` or formatting that cannot be represented by one version.

Manual review table recommendation:

```prisma
model BlueprintMigrationReview {
  id           String   @id @default(cuid())
  blueprintId  String?
  consumerType String?
  consumerId   String?
  tenantId     String?
  reason       String
  details      Json?
  resolvedAt   DateTime?
  resolvedBy   String?
  createdAt    DateTime @default(now())

  @@index([blueprintId])
  @@index([tenantId, resolvedAt])
}
```

This table is optional. A generated CSV plus idempotent script may be enough for the first pass.

### Legacy Compatibility

During migration:

- Keep `Report.blueprintId`.
- Keep `BifrostRoute.blueprintId`.
- Keep `RealmGate.forgeBlueprintId`.
- Add version IDs and prefer them in runtime.
- Emit warnings when runtime falls back to legacy fields.
- Add metrics/counts for remaining legacy attachments.

## 5. API Migration Plan

### New Mjolnir Publish Endpoint

Add:

`POST /api/mjolnir/blueprints/[id]/publish`

Body:

```json
{
  "tenantId": "active tenant only or omitted",
  "name": "Published blueprint name",
  "description": "optional",
  "changeReason": "Initial publish",
  "status": "ACTIVE"
}
```

Rules:

- `withAuth` required.
- Only publish the user's own personal draft.
- `tenantId` must equal active tenant.
- Draft must be `VALIDATED` or `ACTIVE`, or include fresh validation evidence.
- Sanitize/retain fields using the existing retention helpers before version creation.
- Create tenant-published parent if none exists for this draft/tenant/name lineage.
- Create immutable version from the draft's current `steps`, `sourceSchema`, `afterFormatting`, and safe metadata.
- Compute `stepsHash`.
- Return parent and version summary.

Optional:

- `POST /api/mjolnir/blueprints/[id]/publish-preview` to show what will be published, whether a new version is needed, and impacted consumers.

### Published Version Selector Endpoint

Add:

`GET /api/mjolnir/published-blueprints?status=ACTIVE&includeVersionId=...`

Return:

- Tenant-published parents for active tenant only.
- Latest attachable version summary by default.
- Include currently attached legacy or archived versions as disabled options when requested.
- No sample raw metadata.

### Attach Validation Helper

Replace `validateOptionalAttachableBlueprint()` for production consumers with:

`validateOptionalAttachableBlueprintVersion(input)`

Input:

```ts
{
  blueprintVersionId: string | null | undefined;
  tenantId: string;
  userId: string;
  context: "report" | "bifrost-route" | "realm-gate";
  requireStreamingCompatible?: boolean;
}
```

Rules:

- Absent ID is OK and returns null.
- Version must exist.
- Version tenant must equal active tenant.
- Parent must be `TENANT_PUBLISHED`.
- Parent status must be `ACTIVE` or equivalent attachable published status.
- Version must be locked/immutable.
- Bifrost must validate streaming compatibility against `version.steps`.
- Return only safe IDs/name/version/hash/status metadata.

### Report Create/Update

Update:

- Accept `blueprintVersionId` in Zod schema.
- Continue accepting `blueprintId` temporarily only for legacy UI/old clients.
- Prefer `blueprintVersionId`.
- Validate version tenant boundary.
- Store `Report.blueprintVersionId`.
- Optionally clear `Report.blueprintId` for new attachments once version ID is present.
- Reject new `blueprintId` attaches after a feature flag flips.

### Bifrost Create/Update

Update:

- Accept `blueprintVersionId`.
- Validate version tenant boundary.
- Validate streaming compatibility.
- Store `BifrostRoute.blueprintVersionId`.
- Keep `blueprintId` fallback during migration.
- If `transformEnabled = true`, require either `blueprintVersionId` or legacy `blueprintId` until phase 7; after phase 7 require version ID.

### RealmGate Create/Update

Option A:

- Accept `blueprintVersionId`.
- Validate version tenant boundary.
- Store `RealmGate.blueprintVersionId`.
- Keep `forgeBlueprintId` compatibility only for existing route-Forge attachments.
- If both `blueprintVersionId` and `forgeBlueprintId` are provided, reject unless product defines a precedence rule.

Option B:

- Accept `forgeBlueprintVersionId`.
- Validate version's `ForgeBlueprint.tenantId` or owning route tenant/user boundary.
- Store `forgeBlueprintVersionId`.

### Execution Loaders

Add shared loader:

`loadPinnedBlueprintVersionForExecution(input)`

Input:

```ts
{
  blueprintVersionId?: string | null;
  legacyBlueprintId?: string | null;
  tenantId: string | null;
  userId: string;
  context: "report" | "bifrost-route" | "realm-gate";
  allowLegacyFallback: boolean;
}
```

Behavior:

- Prefer `blueprintVersionId`.
- Enforce tenant match for version.
- Return immutable steps/schema/formatting/hash/version metadata.
- If falling back to legacy `blueprintId`, enforce existing status rules and emit warning/metric.

### Rollback Endpoint

Current route:

- `POST /api/blueprints/[routeId]/rollback` creates a new `ForgeBlueprintVersion`.

Target for Mjolnir published versions:

- `POST /api/mjolnir/published-blueprints/[id]/versions/[version]/rollback`

Body:

```json
{
  "changeReason": "Rollback after customer format issue",
  "attachConsumers": [
    { "type": "report", "id": "..." }
  ]
}
```

Rules:

- Rollback creates a new immutable version copied from target version.
- It does not automatically repin any consumer unless explicitly requested.
- If `attachConsumers` is present, each target must belong to active tenant and currently use the same published parent.
- Return new version ID and list of consumers changed.

### Archive/Delete Behavior

Published parent archive:

- Blocks new attachments.
- Existing pinned consumers keep working.
- UI warns if consumers still use archived parent/version.

Version delete:

- Disallow if any consumer references it.
- Disallow if any execution references it.
- Prefer retention pruning for never-executed, never-attached versions only.

Draft delete:

- Allow if not a source draft for unresolved published lineage, or keep lineage via `onDelete: SetNull`.

## 6. Runtime Migration Plan

### Report Runner

Phase behavior:

1. Add `blueprintVersionId` to `PipelineInput`.
2. If present, load `BlueprintVersion`.
3. Execute `BlueprintVersion.steps`.
4. Validate raw query columns against `BlueprintVersion.sourceSchema`.
5. Use `BlueprintVersion.afterFormatting`.
6. Record execution with `blueprintVersionId`, `stepsHash`, report ID, and run log ID.
7. If absent and `legacyBlueprintId` exists, use current `Blueprint` fallback and log a warning.

Result:

- Editing the personal draft after publication does not alter report output.

### Bifrost Engine

Phase behavior:

1. Add `blueprintVersionId` to route type and include it in route query.
2. If `transformEnabled && blueprintVersionId`, load version once before chunk loop.
3. Validate streaming compatibility against pinned `version.steps`.
4. Execute pinned steps for every chunk.
5. Record execution with route log ID, version ID, and steps hash.
6. If no version ID, fallback to legacy `blueprintId` during migration only.

Raven resume must mirror the same loader.

### RealmGate Runtime

RealmGate push execution should:

- Load `blueprintVersionId` when `forgeEnabled`.
- Execute pinned version steps.
- Record execution with gate push ID.
- If using `forgeBlueprintVersionId` alternative, load `ForgeBlueprintVersion.steps` and record in existing Forge execution table or the new generic execution table.
- Keep `forgeBlueprintId` fallback only behind a migration flag.

### Execution Logs

Add execution metadata:

- Report `RunLog` may get `blueprintVersionId` and `blueprintStepsHash`, or rely on `BlueprintVersionExecution`.
- Bifrost `RouteLog` may get `blueprintVersionId` and `blueprintStepsHash`, or rely on `BlueprintVersionExecution`.
- GatePush may get `blueprintVersionId` and `blueprintStepsHash`, or rely on `BlueprintVersionExecution`.

Recommendation:

- Use `BlueprintVersionExecution` as normalized audit table.
- Add denormalized IDs on run logs only if UI/reporting needs fast lookup.

### Legacy Fallback

Temporary fallback:

- Reports: `blueprintVersionId ?? blueprintId`.
- Bifrost: `blueprintVersionId ?? blueprintId`.
- RealmGate: `blueprintVersionId ?? forgeBlueprintVersionId ?? forgeBlueprintId`.

Fallback warnings:

- Emit structured log once per run.
- Include consumer ID, tenant ID, and legacy field used.
- Do not include SQL, credentials, or sample values.

Removal criteria:

- Backfill completed.
- No production consumer has null version ID while transform/forge is enabled.
- UI no longer sends legacy fields.
- Observability shows zero fallback executions for at least one release cycle.

### Rollback Semantics

Rollback must be explicit:

- Creating a rollback version affects no consumers automatically.
- Repinning a consumer to rollback version is a separate audited action.
- Bulk repin must list exact consumers and show a used-by summary.

## 7. UI Migration Plan

### Personal Drafts List

Mjolnir page should split views:

- Personal drafts: user-owned editable working copies.
- Tenant published: active tenant production-ready blueprints.
- Archived: hidden by default, visible with filter.

Draft cards:

- Show `DRAFT`, `VALIDATED`, `ACTIVE` as working-copy status.
- Show tenant context if known.
- Show "Publish to tenant" action when validated.
- Show warning if draft has legacy attachments that need migration.

### Publish To Tenant Flow

Add modal:

- Shows target tenant.
- Shows current draft status and validation evidence.
- Shows steps count and steps hash.
- Shows retention summary.
- Allows change reason.
- Shows whether this creates v1 or a later version.
- Requires confirmation that published version is immutable.

### Version History

Published parent page:

- Show versions ordered newest first.
- Show version number, steps hash, created by, created at, source, validation summary, execution count, attachment count.
- Show diff between versions.
- Show "Pin consumer to this version" only through explicit consumer edit flow.
- Show "Create rollback version from this version".

### Used-By List

Expand usage helper to include:

- Reports using `blueprintVersionId`.
- Bifrost routes using `blueprintVersionId`.
- RealmGates using `blueprintVersionId` or `forgeBlueprintVersionId`.
- Legacy reports/routes still using `blueprintId`.

Usage should display:

- Consumer type.
- Name.
- Tenant.
- Current status/enabled state.
- Version number and hash when pinned.
- Legacy warning when not pinned.

### Status And Scope Labels

Use clear labels:

- `Personal Draft`
- `Tenant Published`
- `v1`, `v2`, etc.
- `Pinned`
- `Legacy Mutable`
- `Archived`

Avoid implying that a draft `ACTIVE` status is production-pinned after migration. Product copy should say:

- Draft status: "Validated working copy".
- Published status: "Attachable in tenant".

### Production Selectors

Report/Bifrost/RealmGate selectors should:

- Query tenant-published active versions only.
- Store `blueprintVersionId`.
- Include current attached version even if archived/legacy, as disabled or warning option.
- Hide personal drafts.
- Show version number and publish date.
- Optionally show "newer version available" badge if the same parent has a newer version.

### Legacy Attached Blueprint Warnings

When a consumer still uses `blueprintId`:

- Show "Legacy mutable blueprint attachment".
- Explain that edits to the draft can affect execution.
- Offer "Pin current blueprint as tenant version" migration action.
- Do not auto-migrate from the UI without confirmation.

## 8. Test Plan

### Unit Tests

Publish/version helper tests:

- Publish creates tenant-published parent when none exists.
- Publish creates immutable version with copied steps/schema/formatting.
- Publish computes stable `stepsHash`.
- Re-publish identical steps either rejects as no-op or returns existing latest version based on chosen product behavior.
- Publishing `DRAFT` without validation evidence rejects.
- Publishing to another tenant rejects.
- Version rows are not mutated by draft edits.

Attach validation tests:

- Report attach accepts active tenant-published version.
- Bifrost attach accepts active tenant-published streaming-compatible version.
- RealmGate attach accepts active tenant-published version.
- Cross-tenant version attach rejects.
- Personal draft version attach rejects.
- Archived parent attach rejects for new attachments.
- Archived current pinned version can remain visible but not newly selected.

Runtime loader tests:

- Loader prefers `blueprintVersionId` over legacy `blueprintId`.
- Loader rejects tenant mismatch.
- Loader falls back to legacy only when `allowLegacyFallback = true`.
- Loader returns steps hash and version metadata.

### Integration/API Tests

Publish API:

- `POST /api/mjolnir/blueprints/[id]/publish` creates version.
- Publish requires auth and active tenant.
- Publish only allows owning user draft.
- Publish returns safe metadata and no raw sample values.

Report API:

- Create/update accepts `blueprintVersionId`.
- Create/update rejects `blueprintVersionId` from another tenant.
- Legacy `blueprintId` path still works during migration if feature flag allows it.
- New clients cannot send both `blueprintId` and `blueprintVersionId` unless compatibility policy defines precedence.

Bifrost API:

- Create/update accepts streaming-compatible version.
- Create/update rejects stateful version.
- Cross-tenant attach rejects.

RealmGate API:

- Create/update with no blueprint still works.
- Create/update with same-tenant `blueprintVersionId` works.
- Missing/cross-tenant version rejects.
- Existing `forgeBlueprintId` tests remain.

Rollback API:

- Rollback creates a new immutable version.
- Rollback does not repin consumers unless explicit.
- Explicit repin changes only listed consumers.
- Unauthorized/cross-tenant repin rejects.

Backfill tests:

- Unattached blueprints remain personal drafts.
- Single-tenant attachment produces one published parent and v1.
- Multi-tenant same-user attachments produce one parent/version per tenant.
- Ambiguous null-tenant consumers are flagged.
- Attached DRAFT blueprint is flagged or converted with warning based on chosen policy.
- Script is idempotent.

### Runtime Regression Tests

Report:

- Report execution uses pinned version after original draft steps are edited.
- Report execution records version ID and steps hash.
- Legacy fallback logs warning.

Bifrost:

- Bifrost execution uses pinned version after original draft steps are edited.
- Raven resume uses the same pinned version loader.
- Streaming validation uses pinned steps.

RealmGate:

- Gate push uses pinned version after source draft or parent latest changes.
- Gate push records version ID/hash.

Archive/delete:

- In-use published parent cannot be hard-deleted.
- In-use version cannot be deleted.
- Archive blocks new attachments but existing pinned execution still loads.
- Draft deletion does not break published versions.

## 9. Risk Analysis

### Safe Incremental Steps

- Add nullable schema fields and new version tables.
- Add helper functions without changing runtime behavior.
- Add publish endpoint behind UI-disabled or feature flag.
- Add selectors that can read both old and new shapes.
- Add execution loader with legacy fallback.
- Add observability for fallback usage.

### Risky Schema Changes

- Making `Blueprint.tenantId` non-null.
- Converting existing `Blueprint` rows in place to tenant-published rows.
- Removing `Report.blueprintId` or `BifrostRoute.blueprintId`.
- Reusing `ForgeBlueprintVersion` for all Mjolnir production versioning despite route-specific `ForgeBlueprint.routeId @unique`.
- Deleting or pruning old versions before attachment/execution references are fully migrated.

### Operations Needing Manual Review

- Same user has one blueprint attached across multiple tenants.
- Attached `DRAFT` or `ARCHIVED` blueprints.
- Consumers with `tenantId = null`.
- Blueprints with invalid step payloads under current validation limits.
- RealmGate attachments where product intent is unclear between generic Mjolnir version and Bifrost route Forge version.

### Compatibility Hazards

- Old UI sending `blueprintId`.
- Schedules and test-send paths that call shared report pipeline.
- Bifrost Raven resume path diverging from regular Bifrost engine.
- Report formatting behavior if `afterFormatting` moves from parent draft to version row.
- Rollback expectations: users may assume rollback changes all consumers, but pinned versions make that explicit.

### Rollback Plan

For each phase:

- Use additive migrations first.
- Keep legacy fields and fallback until final phase.
- Feature flag new attach behavior.
- If production issue appears, disable new publish/attach UI while leaving existing pinned executions readable.
- Keep backfill script idempotent and record each migrated consumer.
- Do not drop legacy fields until backups, monitoring, and zero fallback metrics confirm readiness.

## 10. Recommended Implementation Phases

Each phase is sized as a small Codex-safe prompt.

### Phase 1 - Schema Scaffolding

Prompt:

Add additive Mjolnir version-pinning schema scaffolding only. Add nullable `Blueprint.tenantId`, `Blueprint.scope`, new `BlueprintVersion`, optional `BlueprintVersionExecution`, and nullable `blueprintVersionId` fields on `Report`, `BifrostRoute`, and `RealmGate`. Do not remove legacy fields. Add Prisma validation and focused schema relation tests/mocks where practical.

Deliverables:

- Prisma schema additive migration.
- Generated client.
- Type-only compile fixes for new fields if needed.
- No runtime behavior change.

### Phase 2 - Publish API

Prompt:

Implement tenant publish API for personal Mjolnir drafts. Publish should create or reuse a tenant-published parent, create immutable `BlueprintVersion`, compute `stepsHash`, copy sanitized fields, enforce active tenant/user ownership, and return safe metadata. Add tests for publish and version immutability. Do not change report/Bifrost/RealmGate attach behavior yet.

Deliverables:

- Publish helper.
- Publish endpoint.
- Version detail/list endpoints for published parent.
- Tests.

### Phase 3 - Report Pinning

Prompt:

Add report `blueprintVersionId` attach and execution support. Report create/update should validate tenant-published version IDs and store `blueprintVersionId`; report runner should load pinned version first and legacy `blueprintId` only as fallback. Add execution audit recording and tests proving draft edits do not change pinned report output.

Deliverables:

- Report validation schemas updated.
- Report create/update updated.
- Report selector uses published versions.
- Report runner uses pinned version.
- Tests.

### Phase 4 - Bifrost Pinning

Prompt:

Add Bifrost route `blueprintVersionId` attach and execution support. Create/update should validate tenant-published version IDs and streaming compatibility; engine and Raven resume should load pinned versions before legacy fallback. Add tests proving pinned Bifrost output is stable after draft edits.

Deliverables:

- Bifrost validation schemas updated.
- Bifrost create/update updated.
- Bifrost selectors updated.
- Engine and Raven resume loaders updated.
- Tests.

### Phase 5 - RealmGate Pinning

Prompt:

Add RealmGate pinned blueprint version support using `blueprintVersionId` unless product explicitly chooses `forgeBlueprintVersionId`. Gate create/update should validate tenant-published versions and store the pinned version. Gate push runtime should execute pinned steps and record version execution. Keep existing `forgeBlueprintId` compatibility.

Deliverables:

- Gate create/update validation.
- Gate runtime loader.
- UI selection or hidden API readiness.
- Tests.

### Phase 6 - Migration/Backfill

Prompt:

Implement an idempotent backfill for legacy mutable Mjolnir attachments. Unattached blueprints remain personal drafts; single-tenant attachments create one tenant-published version; multi-tenant same-user attachments create one version per tenant; ambiguous cases are reported for manual review. Do not drop legacy fields.

Deliverables:

- Backfill script.
- Dry-run mode.
- Review report output.
- Idempotency tests.
- Migration runbook.

### Phase 7 - Remove Legacy Fallback

Prompt:

After metrics show zero legacy fallback executions, remove new legacy attach paths and then remove runtime fallback. In a later migration, drop legacy `Report.blueprintId` and `BifrostRoute.blueprintId` only after confirming no rows depend on them. Keep old historical relation data exported or mapped to published versions.

Deliverables:

- Feature flag flipped to require version IDs.
- Runtime fallback removed.
- Legacy selector support removed.
- Final cleanup migration only after explicit approval.

## Open Product Decisions

1. Should published blueprint parent reuse `Blueprint` with `scope = TENANT_PUBLISHED`, or use a separate `PublishedBlueprint` model?
2. Should RealmGate attach generic Mjolnir `BlueprintVersion` or route-specific `ForgeBlueprintVersion`?
3. Should `ACTIVE` be required to publish, or is `VALIDATED` enough with publish setting parent status to `ACTIVE`?
4. Should rollback create a new version only, or can it optionally repin selected consumers in the same request?
5. How long should never-attached, never-executed versions be retained?

## Recommended Decisions

1. Reuse `Blueprint` as the parent with `scope`, but create tenant-published copies instead of converting personal drafts in place.
2. Use generic `BlueprintVersion` for reports, Bifrost, and RealmGate; keep `ForgeBlueprintVersion` route-specific until a separate convergence pass.
3. Allow publish from `VALIDATED`; do not require draft `ACTIVE`.
4. Rollback creates a new version and repins only explicitly selected consumers.
5. Keep all executed or attached versions indefinitely; prune only never-attached, never-executed versions after a product-approved retention window.
