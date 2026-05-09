import { validateOptionalAttachableBlueprint } from "@/lib/mjolnir/blueprint-attach";
import { validateOptionalAttachableBlueprintVersion } from "@/lib/mjolnir/blueprint-version-attach";

export type BifrostBlueprintAttachmentMode =
  | "PINNED_VERSION"
  | "LEGACY_MUTABLE"
  | "NONE";

export type BifrostBlueprintAttachmentValidationResult =
  | {
      ok: true;
      data: {
        blueprintVersionId: string | null;
        blueprintId: string | null;
        mode: BifrostBlueprintAttachmentMode;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      statefulSteps?: string[];
      suggestion?: string | null;
    };

function normalizeAttachmentId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function validateBifrostBlueprintAttachment(input: {
  blueprintVersionId?: string | null;
  legacyBlueprintId?: string | null;
  userId: string;
  tenantId: string;
  transformEnabled: boolean;
}): Promise<BifrostBlueprintAttachmentValidationResult> {
  const blueprintVersionId = normalizeAttachmentId(input.blueprintVersionId);
  const legacyBlueprintId = normalizeAttachmentId(input.legacyBlueprintId);

  if (blueprintVersionId) {
    const versionValidation = await validateOptionalAttachableBlueprintVersion({
      blueprintVersionId,
      tenantId: input.tenantId,
      context: "bifrost-route",
      requireStreamingCompatible: input.transformEnabled,
    });

    if (!versionValidation.ok) {
      return {
        ok: false,
        status: versionValidation.status,
        error: versionValidation.error,
        statefulSteps: versionValidation.statefulSteps,
        suggestion: versionValidation.suggestion,
      };
    }

    return {
      ok: true,
      data: {
        blueprintVersionId: versionValidation.blueprintVersion?.id ?? blueprintVersionId,
        blueprintId: null,
        mode: "PINNED_VERSION",
      },
    };
  }

  if (legacyBlueprintId) {
    const legacyValidation = await validateOptionalAttachableBlueprint({
      blueprintId: legacyBlueprintId,
      userId: input.userId,
      tenantId: input.tenantId,
      context: "bifrost-route",
      requireStreamingCompatible: input.transformEnabled,
    });

    if (!legacyValidation.ok) {
      return {
        ok: false,
        status: legacyValidation.status,
        error: legacyValidation.error,
        statefulSteps: legacyValidation.statefulSteps,
        suggestion: legacyValidation.suggestion,
      };
    }

    return {
      ok: true,
      data: {
        blueprintVersionId: null,
        blueprintId: legacyValidation.blueprint?.id ?? legacyBlueprintId,
        mode: "LEGACY_MUTABLE",
      },
    };
  }

  return {
    ok: true,
    data: {
      blueprintVersionId: null,
      blueprintId: null,
      mode: "NONE",
    },
  };
}
