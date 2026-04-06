import { describe, it, expect } from "vitest";
import {
  forgeStepSchema,
  createBlueprintSchema,
  updateBlueprintSchema,
  analyzeSchema,
  validateSchema,
} from "@/lib/validations/mjolnir";

// ─── forgeStepSchema ─────────────────────────────────

describe("forgeStepSchema", () => {
  it("accepts a valid step", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "remove_columns",
      confidence: 0.95,
      config: { columns: ["A", "B"] },
      description: "Remove unused columns",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "sort",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid step type", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "invalid_type",
      confidence: 0.9,
      config: {},
      description: "Bad type",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range (> 1)", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "sort",
      confidence: 1.5,
      config: { column: "Name", direction: "asc" },
      description: "Sort by name",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range (< 0)", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "sort",
      confidence: -0.1,
      config: { column: "Name", direction: "asc" },
      description: "Sort by name",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative order", () => {
    const result = forgeStepSchema.safeParse({
      order: -1,
      type: "sort",
      confidence: 0.9,
      config: {},
      description: "Bad order",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = forgeStepSchema.safeParse({
      order: 0,
      type: "sort",
      confidence: 0.9,
      config: {},
      description: "",
    });
    expect(result.success).toBe(false);
  });
});

// ─── createBlueprintSchema ───────────────────────────

describe("createBlueprintSchema", () => {
  const validStep = {
    order: 0,
    type: "remove_columns",
    confidence: 1.0,
    config: { columns: ["X"] },
    description: "Remove column X",
  };

  it("accepts valid blueprint", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Monthly Sales Transform",
      steps: [validStep],
    });
    expect(result.success).toBe(true);
  });

  it("accepts blueprint with optional fields", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Transform",
      description: "Transforms sales data",
      steps: [validStep],
      sourceSchema: { columns: ["A", "B"] },
      analysisLog: { matchedColumns: [] },
      beforeSample: "before.xlsx",
      afterSample: "after.xlsx",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = createBlueprintSchema.safeParse({
      name: "",
      steps: [validStep],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing steps", () => {
    const result = createBlueprintSchema.safeParse({
      name: "No Steps",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty steps array", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Empty Steps",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding max length", () => {
    const result = createBlueprintSchema.safeParse({
      name: "X".repeat(201),
      steps: [validStep],
    });
    expect(result.success).toBe(false);
  });
});

// ─── updateBlueprintSchema ───────────────────────────

describe("updateBlueprintSchema", () => {
  it("accepts valid partial update (name only)", () => {
    const result = updateBlueprintSchema.safeParse({
      name: "Updated Name",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid status values", () => {
    for (const status of ["DRAFT", "VALIDATED", "ACTIVE", "ARCHIVED"]) {
      const result = updateBlueprintSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status value", () => {
    const result = updateBlueprintSchema.safeParse({
      status: "DELETED",
    });
    expect(result.success).toBe(false);
  });

  it("accepts nullable description", () => {
    const result = updateBlueprintSchema.safeParse({
      description: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = updateBlueprintSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ─── analyzeSchema ───────────────────────────────────

describe("analyzeSchema", () => {
  it("accepts valid analyze request", () => {
    const result = analyzeSchema.safeParse({
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
      description: "Transform sales data to reporting format",
    });
    expect(result.success).toBe(true);
  });

  it("accepts without optional description", () => {
    const result = analyzeSchema.safeParse({
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing beforeFileId", () => {
    const result = analyzeSchema.safeParse({
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing afterFileId", () => {
    const result = analyzeSchema.safeParse({
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty file IDs", () => {
    const result = analyzeSchema.safeParse({
      beforeFileId: "",
      afterFileId: "",
    });
    expect(result.success).toBe(false);
  });
});

// ─── validateSchema ──────────────────────────────────

describe("validateSchema", () => {
  const validStep = {
    order: 0,
    type: "sort",
    confidence: 0.95,
    config: { column: "Name", direction: "asc" },
    description: "Sort by name",
  };

  it("accepts valid validate request", () => {
    const result = validateSchema.safeParse({
      steps: [validStep],
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty steps array", () => {
    const result = validateSchema.safeParse({
      steps: [],
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing file IDs", () => {
    const result = validateSchema.safeParse({
      steps: [validStep],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid step inside array", () => {
    const result = validateSchema.safeParse({
      steps: [{ order: 0, type: "bad_type", confidence: 0.9, config: {}, description: "Bad" }],
      beforeFileId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      afterFileId: "b1ffcd00-ad1c-5fa9-cc7e-7cc0ce491b22",
    });
    expect(result.success).toBe(false);
  });
});
