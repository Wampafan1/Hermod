import { validateOptionalAttachableBlueprint } from "@/lib/mjolnir/blueprint-attach";
import { validateOptionalAttachableBlueprintVersion } from "@/lib/mjolnir/blueprint-version-attach";

export type ReportBlueprintAttachmentMode =
  | "PINNED_VERSION"
  | "LEGACY_MUTABLE"
  | "NONE";

export type ReportBlueprintAttachmentValidationResult =
  | {
      ok: true;
      data: {
        blueprintVersionId: string | null;
        blueprintId: string | null;
        mode: ReportBlueprintAttachmentMode;
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

export async function validateReportBlueprintAttachment(input: {
  blueprintVersionId?: string | null;
  legacyBlueprintId?: string | null;
  userId: string;
  tenantId: string;
}): Promise<ReportBlueprintAttachmentValidationResult> {
  const blueprintVersionId = normalizeAttachmentId(input.blueprintVersionId);
  const legacyBlueprintId = normalizeAttachmentId(input.legacyBlueprintId);

  if (blueprintVersionId) {
    const versionValidation = await validateOptionalAttachableBlueprintVersion({
      blueprintVersionId,
      tenantId: input.tenantId,
      context: "report",
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
      context: "report",
    });

    if (!legacyValidation.ok) {
      return {
        ok: false,
        status: legacyValidation.status,
        error: legacyValidation.error,
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
