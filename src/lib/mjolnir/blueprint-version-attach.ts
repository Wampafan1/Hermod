import { validateBlueprintForStreaming } from "@/lib/bifrost/forge/forge-validator";
import { prisma } from "@/lib/db";
import {
  canAttachBlueprintStatus,
  normalizeBlueprintStatus,
} from "@/lib/mjolnir/blueprint-status";

export type BlueprintVersionAttachContext = "report" | "bifrost-route" | "realm-gate";

export type AttachableBlueprintVersion = {
  id: string;
  blueprintId: string;
  tenantId: string;
  version: number;
  steps: unknown;
  stepsHash: string;
  isLocked: boolean;
  blueprint: {
    scope: string;
    status: string;
  };
};

export type OptionalBlueprintVersionAttachValidationResult =
  | {
      ok: true;
      blueprintVersion: AttachableBlueprintVersion | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      statefulSteps?: string[];
      suggestion?: string | null;
    };

function normalizeBlueprintVersionId(
  blueprintVersionId: string | null | undefined
): string | null {
  const trimmed = blueprintVersionId?.trim();
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

export async function validateOptionalAttachableBlueprintVersion(input: {
  blueprintVersionId: string | null | undefined;
  tenantId: string;
  context: BlueprintVersionAttachContext;
  requireStreamingCompatible?: boolean;
}): Promise<OptionalBlueprintVersionAttachValidationResult> {
  const blueprintVersionId = normalizeBlueprintVersionId(input.blueprintVersionId);
  if (!blueprintVersionId) {
    return { ok: true, blueprintVersion: null };
  }

  const blueprintVersion = await prisma.blueprintVersion.findFirst({
    where: {
      id: blueprintVersionId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      blueprintId: true,
      tenantId: true,
      version: true,
      steps: true,
      stepsHash: true,
      isLocked: true,
      blueprint: {
        select: {
          scope: true,
          status: true,
        },
      },
    },
  });

  if (!blueprintVersion) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint version not found",
    };
  }

  if (!blueprintVersion.isLocked) {
    return {
      ok: false,
      status: 400,
      error: "Blueprint version must be locked before it can be attached.",
    };
  }

  if (blueprintVersion.blueprint.scope !== "TENANT_PUBLISHED") {
    return {
      ok: false,
      status: 400,
      error: "Blueprint version is not tenant-published.",
    };
  }

  let parentStatus;
  try {
    parentStatus = normalizeBlueprintStatus(blueprintVersion.blueprint.status);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Blueprint version parent has an invalid status.",
    };
  }

  if (!canAttachBlueprintStatus(parentStatus)) {
    return {
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    };
  }

  if (input.requireStreamingCompatible) {
    const steps = normalizeStreamingSteps(blueprintVersion.steps);
    if (!steps) {
      return {
        ok: false,
        status: 400,
        error: "Blueprint version steps are invalid and cannot be used for streaming transforms.",
      };
    }

    const validation = validateBlueprintForStreaming(steps);
    if (!validation.valid) {
      return {
        ok: false,
        status: 400,
        error: "Blueprint version contains stateful steps not supported in streaming mode",
        statefulSteps: validation.statefulSteps,
        suggestion: validation.suggestion,
      };
    }
  }

  return { ok: true, blueprintVersion };
}
