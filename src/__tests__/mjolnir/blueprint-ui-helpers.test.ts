import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_STATUS_HELPER_TEXT,
  BLUEPRINT_STATUS_LABELS,
  blueprintOptionLabel,
  filterAttachableBlueprintOptions,
  findLegacyCurrentBlueprint,
  getBlueprintStatusHelperText,
  getBlueprintStatusLabel,
  isAttachableBlueprintStatus,
  legacyCurrentBlueprintLabel,
  usageSummaryText,
} from "@/components/mjolnir/blueprint-status-badge";

const blueprints = [
  { id: "bp_draft", name: "Draft Cleanup", status: "DRAFT" },
  { id: "bp_validated", name: "Validated Cleanup", status: "VALIDATED" },
  { id: "bp_active", name: "Active Cleanup", status: "ACTIVE" },
  { id: "bp_archived", name: "Archived Cleanup", status: "ARCHIVED" },
];

describe("Mjolnir blueprint UI helpers", () => {
  it("returns status badge labels and helper text", () => {
    expect(BLUEPRINT_STATUS_LABELS).toMatchObject({
      DRAFT: "Draft",
      VALIDATED: "Validated",
      ACTIVE: "Active",
      ARCHIVED: "Archived",
    });
    expect(BLUEPRINT_STATUS_HELPER_TEXT).toMatchObject({
      DRAFT: "Validate before attaching",
      VALIDATED: "Ready to attach",
      ACTIVE: "Production-ready",
      ARCHIVED: "Not attachable",
    });
    expect(getBlueprintStatusLabel("ACTIVE")).toBe("Active");
    expect(getBlueprintStatusHelperText("DRAFT")).toBe("Validate before attaching");
  });

  it("marks only VALIDATED and ACTIVE blueprints attachable", () => {
    expect(isAttachableBlueprintStatus("DRAFT")).toBe(false);
    expect(isAttachableBlueprintStatus("VALIDATED")).toBe(true);
    expect(isAttachableBlueprintStatus("ACTIVE")).toBe(true);
    expect(isAttachableBlueprintStatus("ARCHIVED")).toBe(false);
  });

  it("filters production selector options to attachable blueprints", () => {
    expect(filterAttachableBlueprintOptions(blueprints)).toEqual([
      blueprints[1],
      blueprints[2],
    ]);
  });

  it("builds native selector option labels with status", () => {
    expect(blueprintOptionLabel(blueprints[1])).toBe("Validated Cleanup (VALIDATED)");
  });

  it("finds and labels a legacy current blueprint", () => {
    const legacy = findLegacyCurrentBlueprint(blueprints, "bp_archived");

    expect(legacy).toEqual(blueprints[3]);
    expect(legacyCurrentBlueprintLabel(blueprints[3])).toBe(
      "Current legacy blueprint: Archived Cleanup (ARCHIVED)"
    );
    expect(findLegacyCurrentBlueprint(blueprints, "bp_active")).toBeNull();
  });

  it("formats usage summary text", () => {
    expect(usageSummaryText()).toBe("Not attached");
    expect(usageSummaryText({ reports: 1, bifrostRoutes: 0, total: 1 })).toBe("Used by 1 report");
    expect(usageSummaryText({ reports: 2, bifrostRoutes: 1, total: 3 })).toBe(
      "Used by 2 reports, 1 route"
    );
  });
});
