export type BlueprintStatus = "DRAFT" | "VALIDATED" | "ACTIVE" | "ARCHIVED";

const BLUEPRINT_STATUSES: readonly BlueprintStatus[] = [
  "DRAFT",
  "VALIDATED",
  "ACTIVE",
  "ARCHIVED",
];

const ATTACHABLE_STATUSES = new Set<BlueprintStatus>(["VALIDATED", "ACTIVE"]);
const EDITABLE_STATUSES = new Set<BlueprintStatus>(["DRAFT", "VALIDATED", "ACTIVE"]);
const CONTENT_CHANGE_FIELDS = new Set([
  "steps",
  "sourceSchema",
  "analysisLog",
  "afterFormatting",
  "beforeSample",
  "afterSample",
]);

export function isBlueprintStatus(value: unknown): value is BlueprintStatus {
  return typeof value === "string" && BLUEPRINT_STATUSES.includes(value as BlueprintStatus);
}

export function canAttachBlueprintStatus(status: BlueprintStatus): boolean {
  return ATTACHABLE_STATUSES.has(status);
}

export function canEditBlueprintStatus(status: BlueprintStatus): boolean {
  return EDITABLE_STATUSES.has(status);
}

export function normalizeBlueprintStatus(value: unknown): BlueprintStatus {
  if (isBlueprintStatus(value)) return value;
  throw new Error("Invalid blueprint status");
}

export function validateStatusTransition(input: {
  from: BlueprintStatus;
  to: BlueprintStatus;
  hasValidationEvidence?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const { from, to, hasValidationEvidence = false } = input;

  if (from === to) return { ok: true };

  if (from === "DRAFT" && to === "VALIDATED") {
    return hasValidationEvidence
      ? { ok: true }
      : {
          ok: false,
          error: "Blueprint must pass validation before it can be marked VALIDATED.",
        };
  }

  if (from === "DRAFT" && to === "ACTIVE") {
    return hasValidationEvidence
      ? { ok: true }
      : {
          ok: false,
          error: "Blueprint must be validated before it can be activated.",
        };
  }

  if (from === "VALIDATED" && to === "ACTIVE") return { ok: true };
  if (from === "DRAFT" && to === "ARCHIVED") return { ok: true };
  if (from === "VALIDATED" && to === "ARCHIVED") return { ok: true };
  if (from === "ACTIVE" && to === "ARCHIVED") return { ok: true };
  if (from === "ACTIVE" && to === "DRAFT") return { ok: true };
  if (from === "VALIDATED" && to === "DRAFT") return { ok: true };
  if (from === "ARCHIVED" && to === "DRAFT") return { ok: true };

  if (from === "ARCHIVED") {
    return {
      ok: false,
      error: "Archived blueprints must be restored to DRAFT before changing status.",
    };
  }

  return {
    ok: false,
    error: `Invalid blueprint status transition from ${from} to ${to}.`,
  };
}

export function shouldDemoteToDraftOnContentChange(input: {
  currentStatus: BlueprintStatus;
  changes: Record<string, unknown>;
}): boolean {
  if (input.currentStatus !== "ACTIVE" && input.currentStatus !== "VALIDATED") {
    return false;
  }

  return Object.keys(input.changes).some((key) => CONTENT_CHANGE_FIELDS.has(key));
}

export function hasBlueprintContentChanges(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some((key) => CONTENT_CHANGE_FIELDS.has(key));
}

export function hasValidationEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const validation = value as { passed?: unknown; overallMatchRate?: unknown };
  return (
    validation.passed === true &&
    typeof validation.overallMatchRate === "number" &&
    Number.isFinite(validation.overallMatchRate)
  );
}
