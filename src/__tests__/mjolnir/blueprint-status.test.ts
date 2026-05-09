import { describe, expect, it } from "vitest";
import {
  canAttachBlueprintStatus,
  canEditBlueprintStatus,
  hasBlueprintContentChanges,
  hasValidationEvidence,
  isBlueprintStatus,
  normalizeBlueprintStatus,
  shouldDemoteToDraftOnContentChange,
  validateStatusTransition,
} from "@/lib/mjolnir/blueprint-status";

describe("Mjolnir blueprint status lifecycle", () => {
  it("detects valid status enum values", () => {
    expect(isBlueprintStatus("DRAFT")).toBe(true);
    expect(isBlueprintStatus("VALIDATED")).toBe(true);
    expect(isBlueprintStatus("ACTIVE")).toBe(true);
    expect(isBlueprintStatus("ARCHIVED")).toBe(true);
    expect(isBlueprintStatus("PUBLISHED")).toBe(false);
    expect(() => normalizeBlueprintStatus("PUBLISHED")).toThrow("Invalid blueprint status");
  });

  it("allows attach only for VALIDATED and ACTIVE", () => {
    expect(canAttachBlueprintStatus("DRAFT")).toBe(false);
    expect(canAttachBlueprintStatus("VALIDATED")).toBe(true);
    expect(canAttachBlueprintStatus("ACTIVE")).toBe(true);
    expect(canAttachBlueprintStatus("ARCHIVED")).toBe(false);
  });

  it("allows editing only non-archived statuses", () => {
    expect(canEditBlueprintStatus("DRAFT")).toBe(true);
    expect(canEditBlueprintStatus("VALIDATED")).toBe(true);
    expect(canEditBlueprintStatus("ACTIVE")).toBe(true);
    expect(canEditBlueprintStatus("ARCHIVED")).toBe(false);
  });

  it("allows lifecycle transitions with required validation evidence", () => {
    expect(validateStatusTransition({
      from: "DRAFT",
      to: "VALIDATED",
      hasValidationEvidence: true,
    })).toEqual({ ok: true });
    expect(validateStatusTransition({ from: "VALIDATED", to: "ACTIVE" })).toEqual({ ok: true });
    expect(validateStatusTransition({ from: "ACTIVE", to: "ARCHIVED" })).toEqual({ ok: true });
    expect(validateStatusTransition({ from: "VALIDATED", to: "ARCHIVED" })).toEqual({ ok: true });
    expect(validateStatusTransition({ from: "DRAFT", to: "ARCHIVED" })).toEqual({ ok: true });
    expect(validateStatusTransition({ from: "ARCHIVED", to: "DRAFT" })).toEqual({ ok: true });
  });

  it("rejects invalid lifecycle transitions", () => {
    expect(validateStatusTransition({ from: "DRAFT", to: "VALIDATED" })).toMatchObject({ ok: false });
    expect(validateStatusTransition({ from: "DRAFT", to: "ACTIVE" })).toMatchObject({ ok: false });
    expect(validateStatusTransition({ from: "ARCHIVED", to: "ACTIVE" })).toMatchObject({ ok: false });
    expect(validateStatusTransition({ from: "ARCHIVED", to: "VALIDATED" })).toMatchObject({ ok: false });
  });

  it("detects validation evidence", () => {
    expect(hasValidationEvidence({ passed: true, overallMatchRate: 0.98 })).toBe(true);
    expect(hasValidationEvidence({ passed: false, overallMatchRate: 0.98 })).toBe(false);
    expect(hasValidationEvidence({ passed: true })).toBe(false);
  });

  it("detects content changes that demote production-ready statuses", () => {
    const changes = { steps: [{ type: "rename_columns" }] };
    expect(hasBlueprintContentChanges(changes)).toBe(true);
    expect(shouldDemoteToDraftOnContentChange({
      currentStatus: "ACTIVE",
      changes,
    })).toBe(true);
    expect(shouldDemoteToDraftOnContentChange({
      currentStatus: "VALIDATED",
      changes: { afterFormatting: { columns: ["A"] } },
    })).toBe(true);
    expect(shouldDemoteToDraftOnContentChange({
      currentStatus: "DRAFT",
      changes,
    })).toBe(false);
    expect(shouldDemoteToDraftOnContentChange({
      currentStatus: "ACTIVE",
      changes: { name: "Renamed" },
    })).toBe(false);
  });
});
