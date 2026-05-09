import { describe, expect, it } from "vitest";
import type { ForgeStep } from "@/lib/mjolnir/types";
import {
  buildLegacyBlueprintExecutionWarning,
  getBlueprintExecutionDescriptor,
  hashBlueprintSteps,
} from "@/lib/mjolnir/blueprint-execution-descriptor";

const steps: ForgeStep[] = [
  {
    order: 0,
    type: "rename_columns",
    confidence: 1,
    config: { mapping: { sku: "SKU", qty: "Quantity" } },
    description: "Rename columns",
  },
  {
    order: 1,
    type: "remove_columns",
    confidence: 0.9,
    config: { columns: ["Internal Notes"] },
    description: "Remove internal notes",
  },
];

describe("blueprint execution descriptor", () => {
  it("generates a stable steps hash for the same executable steps", () => {
    const reorderedConfigKeys: ForgeStep[] = [
      {
        ...steps[0],
        config: { mapping: { qty: "Quantity", sku: "SKU" } },
        description: "Different prose is not execution logic",
      },
      steps[1],
    ];

    expect(hashBlueprintSteps(steps)).toBe(hashBlueprintSteps(reorderedConfigKeys));
  });

  it("changes the steps hash when executable steps change", () => {
    const changed: ForgeStep[] = [
      steps[0],
      {
        ...steps[1],
        config: { columns: ["Internal Notes", "Draft Flag"] },
      },
    ];

    expect(hashBlueprintSteps(changed)).not.toBe(hashBlueprintSteps(steps));
  });

  it("marks current Blueprint execution as mutable legacy", () => {
    const descriptor = getBlueprintExecutionDescriptor({
      blueprint: {
        id: "bp_1",
        name: "Monthly Cleanup",
        status: "ACTIVE",
        steps,
      },
    });

    expect(descriptor).toMatchObject({
      blueprintId: "bp_1",
      blueprintName: "Monthly Cleanup",
      blueprintStatus: "ACTIVE",
      blueprintVersionId: null,
      executionMode: "MUTABLE_LEGACY",
      stepsHash: hashBlueprintSteps(steps),
    });
  });

  it("includes warning text for mutable legacy execution", () => {
    const descriptor = getBlueprintExecutionDescriptor({
      blueprint: {
        id: "bp_1",
        name: "Monthly Cleanup",
        status: "VALIDATED",
        steps,
      },
    });

    expect(descriptor.warning).toContain("Mutable legacy blueprint execution");
    expect(descriptor.warning).toContain("current Blueprint.steps");
    expect(descriptor.warning).toContain(descriptor.stepsHash);
  });

  it("does not warn for pinned version descriptors", () => {
    const warning = buildLegacyBlueprintExecutionWarning({
      blueprintId: "bp_1",
      blueprintName: "Pinned Cleanup",
      executionMode: "PINNED_VERSION",
      stepsHash: hashBlueprintSteps(steps),
    });

    expect(warning).toBeUndefined();
  });
});
