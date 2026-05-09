import { validateOptionalAttachableBlueprintVersion } from "@/lib/mjolnir/blueprint-version-attach";
import { validateAttachableForgeBlueprint } from "@/lib/mjolnir/forge-blueprint-attach";

export type RealmGateBlueprintAttachmentMode =
  | "PINNED_VERSION"
  | "LEGACY_FORGE_BLUEPRINT"
  | "NONE";

export type RealmGateBlueprintAttachmentValidationResult =
  | {
      ok: true;
      data: {
        blueprintVersionId: string | null;
        forgeBlueprintId: string | null;
        mode: RealmGateBlueprintAttachmentMode;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function normalizeAttachmentId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function validateRealmGateBlueprintAttachment(input: {
  blueprintVersionId?: string | null;
  legacyForgeBlueprintId?: string | null;
  userId: string;
  tenantId: string;
  forgeEnabled: boolean;
}): Promise<RealmGateBlueprintAttachmentValidationResult> {
  const blueprintVersionId = normalizeAttachmentId(input.blueprintVersionId);
  const legacyForgeBlueprintId = normalizeAttachmentId(input.legacyForgeBlueprintId);

  if (!input.forgeEnabled) {
    return {
      ok: true,
      data: {
        blueprintVersionId: null,
        forgeBlueprintId: null,
        mode: "NONE",
      },
    };
  }

  if (blueprintVersionId) {
    const versionValidation = await validateOptionalAttachableBlueprintVersion({
      blueprintVersionId,
      tenantId: input.tenantId,
      context: "realm-gate",
    });

    if (!versionValidation.ok) {
      return {
        ok: false,
        status: versionValidation.status,
        error: versionValidation.error,
      };
    }

    return {
      ok: true,
      data: {
        blueprintVersionId: versionValidation.blueprintVersion?.id ?? blueprintVersionId,
        forgeBlueprintId: null,
        mode: "PINNED_VERSION",
      },
    };
  }

  if (legacyForgeBlueprintId) {
    const forgeValidation = await validateAttachableForgeBlueprint({
      forgeBlueprintId: legacyForgeBlueprintId,
      tenantId: input.tenantId,
      userId: input.userId,
      context: "realm-gate",
    });

    if (!forgeValidation.ok) {
      return {
        ok: false,
        status: forgeValidation.status,
        error: forgeValidation.error,
      };
    }

    return {
      ok: true,
      data: {
        blueprintVersionId: null,
        forgeBlueprintId: forgeValidation.forgeBlueprint?.id ?? legacyForgeBlueprintId,
        mode: "LEGACY_FORGE_BLUEPRINT",
      },
    };
  }

  return {
    ok: true,
    data: {
      blueprintVersionId: null,
      forgeBlueprintId: null,
      mode: "NONE",
    },
  };
}
