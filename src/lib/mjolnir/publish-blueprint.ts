import {
  Prisma,
  type BlueprintScope,
  type BlueprintStatus as PrismaBlueprintStatus,
  type BlueprintVersionSource,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  createLockedBlueprintVersion,
  type CreateBlueprintVersionInput,
} from "@/lib/mjolnir/blueprint-version";
import {
  hasValidationEvidence,
  normalizeBlueprintStatus,
  type BlueprintStatus,
} from "@/lib/mjolnir/blueprint-status";
import { sanitizeBlueprintCreatePayload } from "@/lib/mjolnir/retention";

type JsonValue = Prisma.InputJsonValue | Prisma.JsonValue | null | undefined;

export class PublishBlueprintError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublishBlueprintError";
    this.status = status;
  }
}

export interface PublishBlueprintToTenantInput {
  draftBlueprintId: string;
  userId: string;
  tenantId: string;
  name?: string;
  description?: string | null;
  changeReason?: string | null;
  status?: "VALIDATED" | "ACTIVE";
  validation?: unknown;
}

export interface PublishedBlueprintSummary {
  id: string;
  name: string;
  description: string | null;
  scope: BlueprintScope;
  tenantId: string | null;
  status: PrismaBlueprintStatus;
}

export interface PublishedBlueprintVersionSummary {
  id: string;
  blueprintId: string;
  version: number;
  stepsHash: string;
  createdAt: Date;
  source: BlueprintVersionSource;
  isLocked: boolean;
}

export interface PublishBlueprintResult {
  publishedBlueprint: PublishedBlueprintSummary;
  version: PublishedBlueprintVersionSummary;
  createdParent: boolean;
}

type DraftBlueprintSnapshot = {
  id: string;
  name: string;
  description: string | null;
  status: PrismaBlueprintStatus;
  scope: BlueprintScope;
  steps: Prisma.JsonValue;
  sourceSchema: Prisma.JsonValue | null;
  analysisLog: Prisma.JsonValue | null;
  afterFormatting: Prisma.JsonValue | null;
  beforeSample: string | null;
  afterSample: string | null;
};

interface SanitizedBlueprintSnapshot {
  name: string;
  description: string | null;
  steps: JsonValue;
  sourceSchema?: JsonValue;
  analysisLog?: JsonValue;
  afterFormatting?: JsonValue;
  beforeSample?: string | null;
  afterSample?: string | null;
}

function assertPublishableDraft(
  draft: DraftBlueprintSnapshot,
  validation: unknown
): BlueprintStatus {
  if (draft.scope !== "PERSONAL_DRAFT") {
    throw new PublishBlueprintError("Only personal draft blueprints can be published.");
  }

  const status = normalizeBlueprintStatus(draft.status);
  if (status === "ARCHIVED") {
    throw new PublishBlueprintError("Archived blueprints cannot be published.");
  }

  if (status === "DRAFT" && !hasValidationEvidence(validation)) {
    throw new PublishBlueprintError("Blueprint must pass validation before it can be published.");
  }

  return status;
}

function resolvePublishedStatus(input: {
  draftStatus: BlueprintStatus;
  requestedStatus?: "VALIDATED" | "ACTIVE";
  validation?: unknown;
}): "VALIDATED" | "ACTIVE" {
  if (input.requestedStatus === "ACTIVE") {
    if (input.draftStatus === "DRAFT") {
      throw new PublishBlueprintError("Draft blueprints can be published as VALIDATED after validation, not ACTIVE.");
    }
    return "ACTIVE";
  }

  if (input.requestedStatus === "VALIDATED") {
    return "VALIDATED";
  }

  if (input.draftStatus === "ACTIVE") {
    return "ACTIVE";
  }

  if (input.draftStatus === "VALIDATED" && hasValidationEvidence(input.validation)) {
    return "ACTIVE";
  }

  return "VALIDATED";
}

function sanitizeDraftSnapshot(input: {
  draft: DraftBlueprintSnapshot;
  name?: string;
  description?: string | null;
}): SanitizedBlueprintSnapshot {
  const rawDescription = input.description === undefined
    ? input.draft.description
    : input.description;

  return sanitizeBlueprintCreatePayload({
    name: input.name ?? input.draft.name,
    description: rawDescription,
    steps: input.draft.steps,
    sourceSchema: input.draft.sourceSchema ?? undefined,
    analysisLog: input.draft.analysisLog ?? undefined,
    afterFormatting: input.draft.afterFormatting ?? undefined,
    beforeSample: input.draft.beforeSample,
    afterSample: input.draft.afterSample,
  }) as SanitizedBlueprintSnapshot;
}

function nullableJson(value: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

async function findReusablePublishedParent(input: {
  draftBlueprintId: string;
  tenantId: string;
  userId: string;
}) {
  const matches = await prisma.blueprint.findMany({
    where: {
      scope: "TENANT_PUBLISHED",
      tenantId: input.tenantId,
      userId: input.userId,
      publishedFromId: input.draftBlueprintId,
    },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  return matches.length === 1 ? matches[0] : null;
}

function toPublishedBlueprintSummary(
  blueprint: PublishedBlueprintSummary
): PublishedBlueprintSummary {
  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    scope: blueprint.scope,
    tenantId: blueprint.tenantId,
    status: blueprint.status,
  };
}

function toVersionSummary(
  version: PublishedBlueprintVersionSummary
): PublishedBlueprintVersionSummary {
  return {
    id: version.id,
    blueprintId: version.blueprintId,
    version: version.version,
    stepsHash: version.stepsHash,
    createdAt: version.createdAt,
    source: version.source,
    isLocked: version.isLocked,
  };
}

export async function publishBlueprintToTenant(
  input: PublishBlueprintToTenantInput
): Promise<PublishBlueprintResult> {
  const draft = await prisma.blueprint.findFirst({
    where: {
      id: input.draftBlueprintId,
      userId: input.userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      scope: true,
      steps: true,
      sourceSchema: true,
      analysisLog: true,
      afterFormatting: true,
      beforeSample: true,
      afterSample: true,
    },
  });

  if (!draft) {
    throw new PublishBlueprintError("Blueprint not found", 404);
  }

  const draftStatus = assertPublishableDraft(draft, input.validation);
  const publishedStatus = resolvePublishedStatus({
    draftStatus,
    requestedStatus: input.status,
    validation: input.validation,
  });
  const sanitized = sanitizeDraftSnapshot({
    draft,
    name: input.name,
    description: input.description,
  });

  const reusableParent = await findReusablePublishedParent({
    draftBlueprintId: draft.id,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const sanitizedSteps = sanitized.steps ?? [];
  const parentData = {
    name: sanitized.name,
    description: sanitized.description ?? null,
    steps: sanitizedSteps as Prisma.InputJsonValue,
    sourceSchema: nullableJson(sanitized.sourceSchema),
    analysisLog: nullableJson(sanitized.analysisLog),
    afterFormatting: nullableJson(sanitized.afterFormatting),
    beforeSample: sanitized.beforeSample ?? null,
    afterSample: sanitized.afterSample ?? null,
    status: publishedStatus,
    scope: "TENANT_PUBLISHED" as const,
    tenantId: input.tenantId,
    publishedFromId: draft.id,
    userId: input.userId,
  };

  const publishedBlueprint = reusableParent
    ? await prisma.blueprint.update({
        where: { id: reusableParent.id },
        data: {
          name: parentData.name,
          description: parentData.description,
          steps: parentData.steps,
          sourceSchema: parentData.sourceSchema,
          analysisLog: parentData.analysisLog,
          afterFormatting: parentData.afterFormatting,
          beforeSample: parentData.beforeSample,
          afterSample: parentData.afterSample,
          status: parentData.status,
        },
        select: {
          id: true,
          name: true,
          description: true,
          scope: true,
          tenantId: true,
          status: true,
        },
      })
    : await prisma.blueprint.create({
        data: parentData,
        select: {
          id: true,
          name: true,
          description: true,
          scope: true,
          tenantId: true,
          status: true,
        },
      });

  const versionSource: CreateBlueprintVersionInput["source"] = reusableParent
    ? "REPUBLISH"
    : "PUBLISH";
  const version = await createLockedBlueprintVersion({
    blueprintId: publishedBlueprint.id,
    tenantId: input.tenantId,
    steps: sanitizedSteps,
    sourceSchema: sanitized.sourceSchema,
    afterFormatting: sanitized.afterFormatting,
    analysisLog: sanitized.analysisLog,
    source: versionSource,
    sourceDraftId: draft.id,
    changeReason: input.changeReason ?? null,
    validation: input.validation,
    createdBy: input.userId,
  });

  return {
    publishedBlueprint: toPublishedBlueprintSummary(publishedBlueprint),
    version: toVersionSummary(version),
    createdParent: !reusableParent,
  };
}
