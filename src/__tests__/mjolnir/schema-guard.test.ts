import { describe, it, expect } from "vitest";
import { validateInputSchema } from "@/lib/mjolnir/engine/schema-guard";
import type { InferredDataType } from "@/lib/mjolnir/types";

// ─── Helper ─────────────────────────────────────────

function schema(cols: string[], types?: Record<string, InferredDataType>) {
  return {
    columns: cols,
    types: types ?? Object.fromEntries(cols.map((c) => [c, "string" as InferredDataType])),
  };
}

// ─── Tests ──────────────────────────────────────────

describe("validateInputSchema", () => {
  it("passes when input matches schema exactly", () => {
    const result = validateInputSchema(
      schema(["Name", "Age", "City"]),
      ["Name", "Age", "City"]
    );
    expect(result.valid).toBe(true);
    expect(result.missingColumns).toEqual([]);
    expect(result.extraColumns).toEqual([]);
  });

  it("passes with extra columns (superset is OK)", () => {
    const result = validateInputSchema(
      schema(["Name", "Age"]),
      ["Name", "Age", "City"]
    );
    expect(result.valid).toBe(true);
    expect(result.extraColumns).toEqual(["City"]);
  });

  it("fails when required columns are missing", () => {
    const result = validateInputSchema(
      schema(["Name", "Age", "City"]),
      ["Name", "Age"]
    );
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toEqual(["City"]);
  });

  it("matches columns case-insensitively", () => {
    const result = validateInputSchema(
      schema(["Name", "AGE"]),
      ["name", "age"]
    );
    expect(result.valid).toBe(true);
  });

  it("skips validation when sourceSchema is null", () => {
    const result = validateInputSchema(null, ["Name", "Age"]);
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("detects multiple missing columns", () => {
    const result = validateInputSchema(
      schema(["A", "B", "C", "D"]),
      ["A"]
    );
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toEqual(["B", "C", "D"]);
  });

  it("provides a human-readable error message", () => {
    const result = validateInputSchema(
      schema(["Name", "Revenue"]),
      ["Name"]
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Revenue");
  });

  it("handles empty schema (no columns expected)", () => {
    const result = validateInputSchema(
      schema([]),
      ["Name", "Age"]
    );
    expect(result.valid).toBe(true);
    expect(result.extraColumns).toEqual(["Name", "Age"]);
  });

  it("handles empty input columns", () => {
    const result = validateInputSchema(
      schema(["Name"]),
      []
    );
    expect(result.valid).toBe(false);
    expect(result.missingColumns).toEqual(["Name"]);
  });

  it("normalized matching: SOU_OnHand matches SOU On Hand", () => {
    const result = validateInputSchema(
      schema(["part_code", "SOU_OnHand", "SOU_Available", "DSHIP_OnHand"]),
      ["SKU", "SOU On Hand", "SOU Available", "DSHIP On Hand"]
    );
    // part_code → SKU won't match (completely different name)
    // But SOU_OnHand → SOU On Hand matches via normalized pass
    expect(result.missingColumns).toEqual(["part_code"]);
    expect(result.valid).toBe(false);
  });

  it("normalized matching: strips underscores, hyphens, spaces", () => {
    const result = validateInputSchema(
      schema(["First_Name", "Last-Name", "Phone Number"]),
      ["FirstName", "LastName", "PhoneNumber"]
    );
    expect(result.valid).toBe(true);
    expect(result.missingColumns).toEqual([]);
  });

  it("normalized matching: extra columns detected correctly", () => {
    const result = validateInputSchema(
      schema(["SOU_OnHand"]),
      ["SOU On Hand", "Extra Column"]
    );
    expect(result.valid).toBe(true);
    expect(result.extraColumns).toEqual(["Extra Column"]);
  });
});
