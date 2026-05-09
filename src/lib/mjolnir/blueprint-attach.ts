import { prisma } from "@/lib/db";
import { validateBlueprintForStreaming } from "@/lib/bifrost/forge/forge-validator";
import {
  canAttachBlueprintStatus,
  normalizeBlueprintStatus,
} from "@/lib/mjolnir/blueprint-status";

export type BlueprintAttachContext = "report" | "bifrost-route" | "realm-gate";

export type AttachableBlueprint = {
  id: string;
  userId: string;
  status: string;
  steps: unknown;
  name?: string | null;
};

export type BlueprintAttachValidationResult =
  | {
      ok: true;
      blueprint: AttachableBlueprint;
    }
  | {
      ok: false;
      status: number;
      error: string;
      statefulSteps?: string[];
      suggestion?: string | null;
    };

export type OptionalBlueprintAttachValidationResult =
  | {
      ok: true;
      blueprint: AttachableBlueprint | null;
    }
  | Exclude<BlueprintAttachValidationResult, { ok: true }>;

function normalizeBlueprintId(blueprintId: string | null | undefined): string | null {
  const trimmed = blueprintId?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStreamingSteps(steps: unknown): Array<{ type: string }> | null {
  if (!Array.isArray(steps)) {
    return null;
  }

  const normalized: Array<{ type: string }> = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || !("type" in step)) {
      return null;
    }

    const type = (step as { type?: unknown }).type;
    if (typeof type !== "string") {
      return null;
    }

    normalized.push({ type });
  }

  return normalized;
}

export async function validateAttachableBlueprint(input: {
  blueprintId: string;
  userId: string;
  tenantId: string;
  context: BlueprintAttachContext;
  requireStreamingCompatible?: boolean;
}): Promise<BlueprintAttachValidationResult> {
  const blueprintId = normalizeBlueprintId(input.blueprintId);
  if (!blueprintId) {
    return {
      ok: false,
      status: 400,
      error: "Blueprint ID is required",
    };
  }

  // TODO: once Mjolnir has tenant-owned published versions, include input.tenantId
  // in this lookup and require tenant-published ACTIVE versions for production attach.
  const blueprint = await prisma.blueprint.findFirst({
    where: { id: blueprintId, userId: input.userId },
    select: {
      id: true,
      userId: true,
      status: true,
      steps: true,
      name: true,
    },
  });

  if (!blueprint) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint not found",
    };
  }

  const blueprintStatus = normalizeBlueprintStatus(blueprint.status);

  if (blueprintStatus === "ARCHIVED") {
    return {
      ok: false,
      status: 400,
      error: "Archived blueprints cannot be attached.",
    };
  }

  if (!canAttachBlueprintStatus(blueprintStatus)) {
    return {
      ok: false,
      status: 400,
      error: "Blueprint must be validated before it can be attached.",
    };
  }

  if (input.requireStreamingCompatible) {
    const steps = normalizeStreamingSteps(blueprint.steps);
    if (!steps) {
      return {
        ok: false,
        status: 400,
        error: "Blueprint steps are invalid and cannot be used for streaming transforms.",
      };
    }

    const validation = validateBlueprintForStreaming(steps);
    if (!validation.valid) {
      return {
        ok: false,
        status: 400,
        error: "Blueprint contains stateful steps not supported in streaming mode",
        statefulSteps: validation.statefulSteps,
        suggestion: validation.suggestion,
      };
    }
  }

  return { ok: true, blueprint };
}

export async function validateOptionalAttachableBlueprint(input: {
  blueprintId: string | null | undefined;
  userId: string;
  tenantId: string;
  context: BlueprintAttachContext;
  requireStreamingCompatible?: boolean;
}): Promise<OptionalBlueprintAttachValidationResult> {
  const blueprintId = normalizeBlueprintId(input.blueprintId);
  if (!blueprintId) {
    return { ok: true, blueprint: null };
  }

  return validateAttachableBlueprint({
    ...input,
    blueprintId,
  });
}
