import { createHash } from "crypto";

import type { BlueprintVersion, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type BlueprintVersionSourceInput =
  | "PUBLISH"
  | "REPUBLISH"
  | "ROLLBACK"
  | "BACKFILL"
  | "IMPORT";

export interface CreateBlueprintVersionInput {
  blueprintId: string;
  tenantId: string;
  steps: unknown;
  sourceSchema?: unknown;
  afterFormatting?: unknown;
  analysisLog?: unknown;
  source?: BlueprintVersionSourceInput;
  sourceDraftId?: string | null;
  changeReason?: string | null;
  validation?: unknown;
  aiModelUsed?: string | null;
  aiConfidence?: number | null;
  createdBy?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function normalizeStepsForHash(steps: unknown): unknown {
  if (Array.isArray(steps)) {
    return steps.map((item) => normalizeStepsForHash(item));
  }

  if (isPlainObject(steps)) {
    return Object.keys(steps)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeStepsForHash(steps[key]);
        return normalized;
      }, {});
  }

  return steps;
}

export function calculateBlueprintStepsHash(steps: unknown): string {
  const normalized = normalizeStepsForHash(steps);
  const serialized = JSON.stringify(normalized) ?? "null";

  return createHash("sha256").update(serialized).digest("hex");
}

export async function getNextBlueprintVersionNumber(input: {
  blueprintId: string;
}): Promise<number> {
  const latestVersion = await prisma.blueprintVersion.findFirst({
    where: { blueprintId: input.blueprintId },
    select: { version: true },
    orderBy: { version: "desc" },
  });

  return (latestVersion?.version ?? 0) + 1;
}

function optionalJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonValue);
}

export async function createLockedBlueprintVersion(
  input: CreateBlueprintVersionInput
): Promise<BlueprintVersion> {
  const normalizedSteps = normalizeStepsForHash(input.steps);
  const version = await getNextBlueprintVersionNumber({
    blueprintId: input.blueprintId,
  });
  const stepsHash = calculateBlueprintStepsHash(input.steps);
  const lockedAt = new Date();

  return prisma.blueprintVersion.create({
    data: {
      blueprintId: input.blueprintId,
      tenantId: input.tenantId,
      version,
      steps: normalizedSteps as Prisma.InputJsonValue,
      stepsHash,
      sourceSchema: optionalJson(input.sourceSchema),
      afterFormatting: optionalJson(input.afterFormatting),
      analysisLog: optionalJson(input.analysisLog),
      source: input.source ?? "PUBLISH",
      sourceDraftId: input.sourceDraftId ?? undefined,
      changeReason: input.changeReason ?? undefined,
      validation: optionalJson(input.validation),
      aiModelUsed: input.aiModelUsed ?? undefined,
      aiConfidence: input.aiConfidence ?? undefined,
      isLocked: true,
      lockedAt,
      lockedBy: input.createdBy ?? undefined,
      createdBy: input.createdBy ?? undefined,
    },
  });
}
