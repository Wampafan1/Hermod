import { describe, it, expect } from "vitest";
import { validateBlueprintForStreaming } from "@/lib/bifrost/forge/forge-validator";

describe("validateBlueprintForStreaming", () => {
  it("accepts all-stateless blueprint", () => {
    const steps = [
      { type: "rename_columns" },
      { type: "remove_columns" },
      { type: "filter_rows" },
      { type: "calculate" },
      { type: "format" },
      { type: "reorder_columns" },
    ];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(true);
    expect(result.statefulSteps).toEqual([]);
    expect(result.suggestion).toBeNull();
  });

  it("rejects blueprint with sort step", () => {
    const steps = [
      { type: "rename_columns" },
      { type: "sort" },
    ];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(false);
    expect(result.statefulSteps).toContain("sort");
    expect(result.suggestion).toContain("ORDER BY");
  });

  it("rejects blueprint with deduplicate step", () => {
    const steps = [{ type: "deduplicate" }];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(false);
    expect(result.statefulSteps).toContain("deduplicate");
    expect(result.suggestion).toContain("SELECT DISTINCT");
  });

  it("rejects blueprint with aggregate step", () => {
    const steps = [{ type: "aggregate" }];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(false);
    expect(result.statefulSteps).toContain("aggregate");
    expect(result.suggestion).toContain("GROUP BY");
  });

  it("rejects blueprint with pivot step", () => {
    const steps = [{ type: "pivot" }];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(false);
    expect(result.statefulSteps).toContain("pivot");
    expect(result.suggestion).toContain("PIVOT");
  });

  it("lists only stateful steps from mixed blueprint", () => {
    const steps = [
      { type: "rename_columns" },
      { type: "filter_rows" },
      { type: "sort" },
      { type: "calculate" },
      { type: "deduplicate" },
    ];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(false);
    expect(result.statefulSteps).toEqual(["sort", "deduplicate"]);
    expect(result.suggestion).toContain("ORDER BY");
    expect(result.suggestion).toContain("SELECT DISTINCT");
  });

  it("deduplicates repeated stateful step types", () => {
    const steps = [
      { type: "sort" },
      { type: "sort" },
    ];

    const result = validateBlueprintForStreaming(steps);
    expect(result.statefulSteps).toEqual(["sort"]);
  });

  it("accepts empty steps array", () => {
    const result = validateBlueprintForStreaming([]);
    expect(result.valid).toBe(true);
  });

  it("accepts split_column and merge_columns as stateless", () => {
    const steps = [
      { type: "split_column" },
      { type: "merge_columns" },
    ];

    const result = validateBlueprintForStreaming(steps);
    expect(result.valid).toBe(true);
  });
});
