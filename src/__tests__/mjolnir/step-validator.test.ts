import { describe, it, expect } from "vitest";
import {
  validateStepConfig,
  validateAndNormalizeSteps,
} from "@/lib/mjolnir/engine/step-validator";
import type { ForgeStep } from "@/lib/mjolnir/types";

function makeStep(
  type: string,
  config: Record<string, unknown>,
  confidence = 1.0
): ForgeStep {
  return {
    order: 0,
    type: type as ForgeStep["type"],
    confidence,
    config,
    description: "",
  };
}

describe("validateStepConfig", () => {
  it("passes valid rename_columns step with correct key", () => {
    const step = makeStep("rename_columns", {
      mapping: { old: "new" },
    });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("normalizes renames → mapping for rename_columns", () => {
    const step = makeStep("rename_columns", {
      renames: { old: "new" },
    });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(true);
    expect(result.step.config.mapping).toEqual({ old: "new" });
    expect(result.step.config.renames).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("normalized");
  });

  it("normalizes outputColumn → column for calculate", () => {
    const step = makeStep("calculate", {
      outputColumn: "Total",
      formula: "{A} + {B}",
    });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(true);
    expect(result.step.config.column).toBe("Total");
    expect(result.step.config.outputColumn).toBeUndefined();
  });

  it("fails when required fields are missing", () => {
    const step = makeStep("calculate", {
      formula: "{A} + {B}",
      // missing "column"
    });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("missing"))).toBe(true);
  });

  it("passes valid filter_rows step", () => {
    const step = makeStep("filter_rows", {
      column: "Status",
      operator: "eq",
      value: "Active",
    });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(true);
  });

  it("fails filter_rows without column", () => {
    const step = makeStep("filter_rows", { operator: "eq" });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(false);
  });

  it("passes unknown step types (stubs) without requirements", () => {
    const step = makeStep("lookup", { anything: "goes" });
    const result = validateStepConfig(step);
    expect(result.valid).toBe(true);
  });
});

describe("validateAndNormalizeSteps", () => {
  it("filters out invalid steps and normalizes valid ones", () => {
    const steps: ForgeStep[] = [
      makeStep("rename_columns", { renames: { a: "b" } }),
      makeStep("calculate", {}), // invalid: missing column + formula
      makeStep("filter_rows", { column: "X", operator: "eq" }),
    ];

    const result = validateAndNormalizeSteps(steps);

    expect(result.steps).toHaveLength(2); // rename + filter pass
    expect(result.steps[0].config.mapping).toEqual({ a: "b" });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
