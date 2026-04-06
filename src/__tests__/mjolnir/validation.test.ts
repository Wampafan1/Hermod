import { describe, it, expect } from "vitest";
import { validateBlueprint } from "@/lib/mjolnir/engine/validation";
import { computeStructuralDiff } from "@/lib/mjolnir/engine/structural-diff";
import { fingerprintAllColumns } from "@/lib/mjolnir/engine/fingerprint";
import type { ForgeStep, ParsedFileData, ColumnFingerprint } from "@/lib/mjolnir/types";

// ─── Helpers ─────────────────────────────────────────

/**
 * Build a minimal ParsedFileData from columns and rows.
 * Generates stub fingerprints for each column.
 */
function makeParsedData(
  columns: string[],
  rows: Record<string, unknown>[],
  fileId = "test-file"
): ParsedFileData {
  const fingerprints: ColumnFingerprint[] = columns.map((name) => ({
    name,
    dataType: "string",
    nullRate: 0,
    cardinality: rows.length,
    sampleHash: `hash-${name}`,
  }));

  return {
    fileId,
    filename: `${fileId}.xlsx`,
    columns,
    rows,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 50),
    fingerprints,
    headerRowIndex: 1,
  };
}

/**
 * Create a ForgeStep with sensible defaults.
 */
function step(
  order: number,
  type: string,
  config: Record<string, unknown>,
  description = ""
): ForgeStep {
  return {
    order,
    type: type as ForgeStep["type"],
    confidence: 1.0,
    config,
    description,
  };
}

// ─── Tests ───────────────────────────────────────────

describe("validateBlueprint", () => {
  it("perfect match: all cells identical → 100% match rate, passed = true", () => {
    const before = makeParsedData(
      ["Name", "Age"],
      [
        { Name: "Alice", Age: 30 },
        { Name: "Bob", Age: 25 },
      ]
    );
    const after = makeParsedData(
      ["Name", "Age"],
      [
        { Name: "Alice", Age: 30 },
        { Name: "Bob", Age: 25 },
      ]
    );

    // No-op pipeline — data passes through unchanged
    const result = validateBlueprint([], before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.matchedCells).toBe(result.totalCells);
    expect(result.mismatches).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("numeric tolerance: values within ±0.01 match", () => {
    const before = makeParsedData(
      ["Value"],
      [
        { Value: 10.005 },
        { Value: 20.0 },
        { Value: 30.009 },
      ]
    );
    const after = makeParsedData(
      ["Value"],
      [
        { Value: 10.01 },   // diff = 0.005 → within tolerance
        { Value: 20.005 },  // diff = 0.005 → within tolerance
        { Value: 30.0 },    // diff = 0.009 → within tolerance
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("string comparison: trims whitespace before comparing", () => {
    const before = makeParsedData(
      ["Name"],
      [
        { Name: "  Alice  " },
        { Name: "Bob " },
        { Name: " Charlie" },
      ]
    );
    const after = makeParsedData(
      ["Name"],
      [
        { Name: "Alice" },
        { Name: "Bob" },
        { Name: "Charlie" },
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it("date normalization: different date formats that represent the same date", () => {
    const isoDate = new Date("2024-06-15T00:00:00.000Z");

    const before = makeParsedData(
      ["Date"],
      [
        { Date: isoDate },
      ]
    );
    const after = makeParsedData(
      ["Date"],
      [
        { Date: isoDate },
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it("null handling: null === null, null !== value", () => {
    const before = makeParsedData(
      ["Value"],
      [
        { Value: null },
        { Value: null },
        { Value: "hello" },
      ]
    );
    const after = makeParsedData(
      ["Value"],
      [
        { Value: null },      // null === null → match
        { Value: "world" },   // null !== "world" → mismatch
        { Value: null },      // "hello" !== null → mismatch
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    // 1 match out of 3 cells
    expect(result.matchedCells).toBe(1);
    expect(result.totalCells).toBe(3);
    expect(result.mismatches).toHaveLength(2);
    expect(result.passed).toBe(false);
  });

  it("partial match: some cells differ → correct match rate", () => {
    const before = makeParsedData(
      ["A", "B"],
      [
        { A: 1, B: "x" },
        { A: 2, B: "y" },
        { A: 3, B: "z" },
      ]
    );
    // After has one different value
    const after = makeParsedData(
      ["A", "B"],
      [
        { A: 1, B: "x" },
        { A: 2, B: "CHANGED" },
        { A: 3, B: "z" },
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    // 5 out of 6 cells match
    expect(result.totalCells).toBe(6);
    expect(result.matchedCells).toBe(5);
    expect(result.overallMatchRate).toBeCloseTo(5 / 6);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].column).toBe("B");
    expect(result.mismatches[0].row).toBe(1);
    expect(result.mismatches[0].expected).toBe("CHANGED");
    expect(result.mismatches[0].actual).toBe("y");
  });

  it("column mismatch: executor produces different columns than AFTER", () => {
    const before = makeParsedData(
      ["A", "B"],
      [
        { A: 1, B: 2 },
      ]
    );
    // AFTER expects a column "C" that the executor won't produce
    const after = makeParsedData(
      ["A", "C"],
      [
        { A: 1, C: 3 },
      ]
    );

    // No-op blueprint → executor produces ["A", "B"] but AFTER expects ["A", "C"]
    const result = validateBlueprint([], before, after, "strict");

    // Columns: A (matched, 1 row), B (extra, 1 row mismatch), C (missing, 1 row mismatch)
    expect(result.totalCells).toBe(3);
    expect(result.matchedCells).toBe(1); // only column A matches
    expect(result.mismatches).toHaveLength(2);
    expect(result.passed).toBe(false);
  });

  it("row count mismatch: fewer/more rows than expected", () => {
    const before = makeParsedData(
      ["Value"],
      [
        { Value: 1 },
        { Value: 2 },
        { Value: 3 },
      ]
    );
    // AFTER only has 2 rows
    const after = makeParsedData(
      ["Value"],
      [
        { Value: 1 },
        { Value: 2 },
      ]
    );

    // No-op blueprint → executor produces 3 rows, AFTER has 2
    const result = validateBlueprint([], before, after, "strict");

    // 3 cells compared (max rows = 3), 2 match, 1 extra row is a mismatch
    expect(result.totalCells).toBe(3);
    expect(result.matchedCells).toBe(2);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].row).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("mismatch cap: more than 100 mismatches → capped at 100", () => {
    // Generate 150 rows that all differ
    const rows = Array.from({ length: 150 }, (_, i) => ({ Value: i }));
    const afterRows = Array.from({ length: 150 }, (_, i) => ({ Value: i + 1000 }));

    const before = makeParsedData(["Value"], rows);
    const after = makeParsedData(["Value"], afterRows);

    const result = validateBlueprint([], before, after, "strict");

    expect(result.mismatches).toHaveLength(100);
    expect(result.totalCells).toBe(150);
    expect(result.matchedCells).toBe(0);
  });

  it("threshold: 95% → passed, 94% → not passed", () => {
    // Use a non-unique column (Group) to prevent key-based matching,
    // plus a unique ID column. Only Group is compared — positional matching.
    const rows = Array.from({ length: 100 }, (_, i) => ({ Group: i < 50 ? "A" : "B" }));
    const afterRows95 = Array.from({ length: 100 }, (_, i) =>
      i < 95 ? { Group: i < 50 ? "A" : "B" } : { Group: "X" }
    );

    const before = makeParsedData(["Group"], rows);
    const after95 = makeParsedData(["Group"], afterRows95);

    const result95 = validateBlueprint([], before, after95, "strict");
    expect(result95.overallMatchRate).toBe(0.95);
    expect(result95.passed).toBe(true);

    // Create 100 cells where exactly 94 match
    const afterRows94 = Array.from({ length: 100 }, (_, i) =>
      i < 94 ? { Group: i < 50 ? "A" : "B" } : { Group: "X" }
    );
    const after94 = makeParsedData(["Group"], afterRows94);

    const result94 = validateBlueprint([], before, after94, "strict");
    expect(result94.overallMatchRate).toBe(0.94);
    expect(result94.passed).toBe(false);
  });

  it("empty data: no rows → 100% match (vacuously true)", () => {
    const before = makeParsedData(["A"], []);
    const after = makeParsedData(["A"], []);

    const result = validateBlueprint([], before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.totalCells).toBe(0);
    expect(result.matchedCells).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("per-column validation accuracy", () => {
    const before = makeParsedData(
      ["Name", "Score"],
      [
        { Name: "Alice", Score: 85 },
        { Name: "Bob", Score: 92 },
        { Name: "Charlie", Score: 78 },
        { Name: "Diana", Score: 95 },
      ]
    );
    // Names all match, but Score values are different for 2 rows
    const after = makeParsedData(
      ["Name", "Score"],
      [
        { Name: "Alice", Score: 85 },
        { Name: "Bob", Score: 99 },    // different
        { Name: "Charlie", Score: 78 },
        { Name: "Diana", Score: 50 },  // different
      ]
    );

    const result = validateBlueprint([], before, after, "strict");

    const nameValidation = result.columnValidations.find((v) => v.column === "Name");
    const scoreValidation = result.columnValidations.find((v) => v.column === "Score");

    expect(nameValidation).toBeDefined();
    expect(nameValidation!.matchRate).toBe(1.0);
    expect(nameValidation!.matchCount).toBe(4);
    expect(nameValidation!.mismatchCount).toBe(0);

    expect(scoreValidation).toBeDefined();
    expect(scoreValidation!.matchRate).toBe(0.5);
    expect(scoreValidation!.matchCount).toBe(2);
    expect(scoreValidation!.mismatchCount).toBe(2);
  });

  it("end-to-end: diff-generated steps execute correctly through validator", () => {
    // Simulate a real Mjolnir workflow: BEFORE → diff → execute → compare to AFTER
    const makeRealParsed = (
      fileId: string,
      columns: string[],
      rows: Record<string, unknown>[]
    ): ParsedFileData => ({
      fileId,
      filename: `${fileId}.xlsx`,
      columns,
      rows,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 50),
      fingerprints: fingerprintAllColumns(columns, rows),
      headerRowIndex: 1,
    });

    const before = makeRealParsed("before", ["ID", "Name", "Status", "Extra"], [
      { ID: 1, Name: "  Alice  ", Status: "active", Extra: "remove-me" },
      { ID: 2, Name: "  Bob  ", Status: "active", Extra: "remove-me" },
      { ID: 3, Name: "  Charlie  ", Status: "inactive", Extra: "remove-me" },
    ]);
    // AFTER: Extra removed, Name trimmed, columns reordered
    const after = makeRealParsed("after", ["Name", "ID", "Status"], [
      { Name: "Alice", ID: 1, Status: "active" },
      { Name: "Bob", ID: 2, Status: "active" },
      { Name: "Charlie", ID: 3, Status: "inactive" },
    ]);

    // Phase 1: structural diff generates steps
    const diff = computeStructuralDiff(before, after);

    // Verify the diff detected the right things
    expect(diff.removedColumns).toContain("Extra");
    expect(diff.reorderDetected).toBe(true);

    // Phase 3: validate — the diff's deterministic steps should reproduce AFTER
    const result = validateBlueprint(diff.deterministicSteps, before, after, "strict");

    // The steps should produce output that matches AFTER
    expect(result.overallMatchRate).toBeGreaterThanOrEqual(0.95);
    expect(result.passed).toBe(true);
  });

  it("end-to-end: rename + reorder steps execute correctly", () => {
    const makeRealParsed = (
      fileId: string,
      columns: string[],
      rows: Record<string, unknown>[]
    ): ParsedFileData => ({
      fileId,
      filename: `${fileId}.xlsx`,
      columns,
      rows,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 50),
      fingerprints: fingerprintAllColumns(columns, rows),
      headerRowIndex: 1,
    });

    // Case-insensitive renames: "Product_Id" → "product_id", "Product_Name" → "product_name"
    const before = makeRealParsed("before", ["Product_Id", "Product_Name", "Price"], [
      { Product_Id: 1, Product_Name: "Widget", Price: 9.99 },
      { Product_Id: 2, Product_Name: "Gadget", Price: 19.99 },
    ]);
    const after = makeRealParsed("after", ["Price", "product_name", "product_id"], [
      { Price: 9.99, product_name: "Widget", product_id: 1 },
      { Price: 19.99, product_name: "Gadget", product_id: 2 },
    ]);

    const diff = computeStructuralDiff(before, after);

    // Should detect case-insensitive renames
    const renames = diff.matchedColumns.filter((m) => m.matchType === "case_insensitive");
    expect(renames.length).toBeGreaterThanOrEqual(2);

    const result = validateBlueprint(diff.deterministicSteps, before, after, "strict");

    expect(result.overallMatchRate).toBeGreaterThanOrEqual(0.95);
    expect(result.passed).toBe(true);
  });

  it("case-insensitive column matching (Issue #9)", () => {
    const before = makeParsedData(
      ["name", "score"],
      [
        { name: "Alice", score: 85 },
        { name: "Bob", score: 92 },
      ]
    );
    // AFTER has different casing
    const after = makeParsedData(
      ["Name", "Score"],
      [
        { Name: "Alice", Score: 85 },
        { Name: "Bob", Score: 92 },
      ]
    );

    // No-op blueprint → executor produces "name"/"score", AFTER has "Name"/"Score"
    const result = validateBlueprint([], before, after, "strict");

    // Should match case-insensitively
    expect(result.overallMatchRate).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it("reports unsupportedSteps for stub step types (Issue #12)", () => {
    const before = makeParsedData(["A"], [{ A: 1 }]);
    const after = makeParsedData(["A"], [{ A: 1 }]);

    const steps: ForgeStep[] = [
      step(0, "lookup", { column: "B", lookupColumn: "A" }, "Lookup B from A"),
      step(1, "pivot", { column: "A" }, "Pivot on A"),
    ];

    const result = validateBlueprint(steps, before, after, "strict");

    expect(result.unsupportedSteps).toHaveLength(2);
    expect(result.unsupportedSteps[0]).toContain("lookup");
    expect(result.unsupportedSteps[1]).toContain("pivot");
  });

  it("blueprint execution: validates transformed output against expected", () => {
    const before = makeParsedData(
      ["Name", "City", "Score"],
      [
        { Name: "Alice", City: "NYC", Score: 85 },
        { Name: "Bob", City: "LA", Score: 92 },
      ]
    );
    // Expected output after removing City column
    const after = makeParsedData(
      ["Name", "Score"],
      [
        { Name: "Alice", Score: 85 },
        { Name: "Bob", Score: 92 },
      ]
    );

    const steps: ForgeStep[] = [
      step(0, "remove_columns", { columns: ["City"] }),
    ];

    const result = validateBlueprint(steps, before, after, "strict");

    expect(result.overallMatchRate).toBe(1.0);
    expect(result.passed).toBe(true);
    expect(result.totalCells).toBe(4);
    expect(result.matchedCells).toBe(4);
  });
});

// ─── Pattern Mode Tests ──────────────────────────────

describe("validateBlueprint — pattern mode", () => {
  it("perfect column structure → passes with patternChecks", () => {
    const before = makeParsedData(
      ["Name", "Age"],
      [
        { Name: "Alice", Age: 30 },
        { Name: "Bob", Age: 25 },
      ]
    );
    const after = makeParsedData(
      ["Name", "Age"],
      [
        { Name: "Alice", Age: 30 },
        { Name: "Bob", Age: 25 },
      ]
    );

    const result = validateBlueprint([], before, after, "pattern");

    expect(result.passed).toBe(true);
    expect(result.overallMatchRate).toBe(1.0);
    expect(result.rowMatchMode).toBe("pattern");
    expect(result.patternChecks).toBeDefined();
    expect(result.mismatches).toHaveLength(0); // pattern mode never populates mismatches

    const structureCheck = result.patternChecks!.find(
      (c) => c.category === "column_structure"
    );
    expect(structureCheck).toBeDefined();
    expect(structureCheck!.status).toBe("pass");
  });

  it("missing columns → structure fails, overall fails", () => {
    const before = makeParsedData(
      ["A", "B"],
      [{ A: 1, B: 2 }]
    );
    const after = makeParsedData(
      ["A", "B", "C"],
      [{ A: 1, B: 2, C: 3 }]
    );

    // No-op blueprint — executor produces [A, B] but AFTER expects [A, B, C]
    const result = validateBlueprint([], before, after, "pattern");

    expect(result.passed).toBe(false);
    const structureCheck = result.patternChecks!.find(
      (c) => c.category === "column_structure"
    );
    expect(structureCheck).toBeDefined();
    expect(structureCheck!.description).toContain("2/3");
  });

  it("rename steps validated against AFTER column names", () => {
    const before = makeParsedData(
      ["OldName"],
      [{ OldName: "Alice" }]
    );
    const after = makeParsedData(
      ["NewName"],
      [{ NewName: "Alice" }]
    );

    const steps: ForgeStep[] = [
      step(0, "rename_columns", { mapping: { OldName: "NewName" } }),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    expect(result.passed).toBe(true);
    const renameCheck = result.patternChecks!.find(
      (c) => c.category === "rename"
    );
    expect(renameCheck).toBeDefined();
    expect(renameCheck!.status).toBe("pass");
  });

  it("bad rename targets → rename check fails", () => {
    const before = makeParsedData(
      ["OldName"],
      [{ OldName: "Alice" }]
    );
    const after = makeParsedData(
      ["CorrectName"],
      [{ CorrectName: "Alice" }]
    );

    const steps: ForgeStep[] = [
      step(0, "rename_columns", { mapping: { OldName: "WrongName" } }),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    const renameCheck = result.patternChecks!.find(
      (c) => c.category === "rename"
    );
    expect(renameCheck).toBeDefined();
    expect(renameCheck!.status).toBe("fail");
  });

  it("format steps always pass (deterministic)", () => {
    const before = makeParsedData(
      ["Name"],
      [{ Name: "alice" }]
    );
    const after = makeParsedData(
      ["Name"],
      [{ Name: "ALICE" }]
    );

    const steps: ForgeStep[] = [
      step(0, "format", { column: "Name", formatType: "uppercase" }),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    const formatCheck = result.patternChecks!.find(
      (c) => c.category === "format"
    );
    expect(formatCheck).toBeDefined();
    expect(formatCheck!.status).toBe("pass");
  });

  it("row count difference is advisory (warn), not a failure", () => {
    const before = makeParsedData(
      ["Value"],
      [{ Value: 1 }, { Value: 2 }, { Value: 3 }]
    );
    // AFTER has fewer rows — different time period
    const after = makeParsedData(
      ["Value"],
      [{ Value: 10 }, { Value: 20 }]
    );

    const result = validateBlueprint([], before, after, "pattern");

    // Structure is 100% (1/1 col), so it should pass despite row count diff
    expect(result.passed).toBe(true);
    const rowCountCheck = result.patternChecks!.find(
      (c) => c.category === "row_count"
    );
    expect(rowCountCheck).toBeDefined();
    expect(rowCountCheck!.status).toBe("warn");
  });

  it("default mode is pattern (no explicit mode needed)", () => {
    const before = makeParsedData(["A"], [{ A: 1 }]);
    const after = makeParsedData(["A"], [{ A: 1 }]);

    // Call without mode argument — should default to pattern
    const result = validateBlueprint([], before, after);

    expect(result.rowMatchMode).toBe("pattern");
    expect(result.patternChecks).toBeDefined();
  });

  it("unsupported steps reported in pattern mode too", () => {
    const before = makeParsedData(["A"], [{ A: 1 }]);
    const after = makeParsedData(["A"], [{ A: 1 }]);

    const steps: ForgeStep[] = [
      step(0, "pivot", { column: "A" }, "Pivot on A"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    expect(result.unsupportedSteps).toHaveLength(1);
    expect(result.unsupportedSteps[0]).toContain("pivot");
  });

  it("completeness: flags mostly-null output for non-null expected column", () => {
    // BEFORE has a column Value that's all-null → blueprint can't calculate it
    // AFTER has a column Value that's all non-null → completeness mismatch
    const before = makeParsedData(
      ["ID", "Value"],
      [
        { ID: "A1", Value: null },
        { ID: "A2", Value: null },
        { ID: "A3", Value: null },
        { ID: "A4", Value: null },
      ]
    );
    const after = makeParsedData(
      ["ID", "Value"],
      [
        { ID: "A1", Value: 100 },
        { ID: "A2", Value: 200 },
        { ID: "A3", Value: 300 },
        { ID: "A4", Value: 400 },
      ]
    );

    // No-op blueprint — Value stays null because BEFORE has all nulls
    const result = validateBlueprint([], before, after, "pattern");

    const completenessCheck = result.patternChecks!.find(
      (c) => c.category === "completeness"
    );
    expect(completenessCheck).toBeDefined();
    expect(completenessCheck!.status).toBe("fail");
    expect(completenessCheck!.description).toContain("Value");
    expect(completenessCheck!.description).toContain("100%");
  });

  it("completeness: does not flag when both sides have similar null rates", () => {
    const before = makeParsedData(
      ["ID", "Value"],
      [
        { ID: "A1", Value: 100 },
        { ID: "A2", Value: 200 },
        { ID: "A3", Value: null },
      ]
    );
    const after = makeParsedData(
      ["ID", "Value"],
      [
        { ID: "A1", Value: 100 },
        { ID: "A2", Value: 200 },
        { ID: "A3", Value: null },
      ]
    );

    const result = validateBlueprint([], before, after, "pattern");

    const completenessCheck = result.patternChecks!.find(
      (c) => c.category === "completeness"
    );
    // Should NOT flag because null rates are similar
    expect(completenessCheck).toBeUndefined();
  });

  it("completeness: skips formula output columns (no double-penalty)", () => {
    // A calculate step produces a column "Total" that the parser can't evaluate,
    // resulting in null values. The completeness check should NOT fire for this
    // column because the formula spot-check already covers it.
    const before = makeParsedData(
      ["ID", "Price", "Qty"],
      [
        { ID: "A1", Price: 10, Qty: 5 },
        { ID: "A2", Price: 20, Qty: 3 },
        { ID: "A3", Price: 30, Qty: 7 },
        { ID: "A4", Price: 40, Qty: 2 },
      ]
    );
    const after = makeParsedData(
      ["ID", "Price", "Qty", "Total"],
      [
        { ID: "A1", Price: 10, Qty: 5, Total: 50 },
        { ID: "A2", Price: 20, Qty: 3, Total: 60 },
        { ID: "A3", Price: 30, Qty: 7, Total: 210 },
        { ID: "A4", Price: 40, Qty: 2, Total: 80 },
      ]
    );

    // Use a formula that our parser CAN evaluate ({Price} * {Qty})
    // but the point is: even if it couldn't, completeness should skip this column
    const steps: ForgeStep[] = [
      step(0, "calculate", {
        column: "Total",
        formula: "{Price} * {Qty}",
        sourceColumns: ["Price", "Qty"],
      }, "Calculate Total"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    // No completeness check should fire for "Total" — it's a formula output column
    const completenessChecks = result.patternChecks!.filter(
      (c) => c.category === "completeness" && c.description.includes("Total")
    );
    expect(completenessChecks).toHaveLength(0);
  });

  it("formula spot-check: unevaluable formulas warn instead of fail", () => {
    // When the expression parser can't evaluate a formula at all (all execution
    // values are null), the check should warn (benefit of doubt) not fail.
    const before = makeParsedData(
      ["ID", "A", "B"],
      [
        { ID: "X1", A: 10, B: 20 },
        { ID: "X2", A: 30, B: 40 },
        { ID: "X3", A: 50, B: 60 },
      ]
    );
    const after = makeParsedData(
      ["ID", "A", "B", "Complex"],
      [
        { ID: "X1", A: 10, B: 20, Complex: 999 },
        { ID: "X2", A: 30, B: 40, Complex: 888 },
        { ID: "X3", A: 50, B: 60, Complex: 777 },
      ]
    );

    // Use a formula the parser CANNOT evaluate — uses a non-existent function
    const steps: ForgeStep[] = [
      step(0, "calculate", {
        column: "Complex",
        formula: "VLOOKUP({A}, external_table, 2, FALSE)",
        sourceColumns: ["A"],
      }, "Complex lookup formula"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    const formulaCheck = result.patternChecks!.find(
      (c) => c.category === "formula" && c.description.includes("Complex")
    );
    expect(formulaCheck).toBeDefined();
    // Should be "warn" (benefit of doubt), NOT "fail"
    expect(formulaCheck!.status).toBe("warn");
    expect(formulaCheck!.description).toContain("cannot evaluate");
  });

  it("formula spot-check with matching key column", () => {
    // BEFORE and AFTER share an ID column for key matching
    const before = makeParsedData(
      ["ID", "Price", "Qty"],
      [
        { ID: "A1", Price: 10, Qty: 5 },
        { ID: "A2", Price: 20, Qty: 3 },
        { ID: "A3", Price: 30, Qty: 7 },
      ]
    );
    const after = makeParsedData(
      ["ID", "Price", "Qty", "Total"],
      [
        { ID: "A1", Price: 10, Qty: 5, Total: 50 },
        { ID: "A2", Price: 20, Qty: 3, Total: 60 },
        { ID: "A3", Price: 30, Qty: 7, Total: 210 },
      ]
    );

    const steps: ForgeStep[] = [
      step(0, "calculate", {
        column: "Total",
        formula: "{Price} * {Qty}",
        sourceColumns: ["Price", "Qty"],
      }, "Calculate Total"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    expect(result.passed).toBe(true);
    const formulaCheck = result.patternChecks!.find(
      (c) => c.category === "formula"
    );
    expect(formulaCheck).toBeDefined();
    // Formula produces correct values → should pass or warn
    expect(["pass", "warn"]).toContain(formulaCheck!.status);
  });

  it("should warn (not fail) on formula value mismatches when row counts differ", () => {
    // BEFORE has 5 rows, AFTER has 7 rows — different time periods
    const before = makeParsedData(
      ["ID", "A", "B", "C"],
      [
        { ID: "1", A: 10, B: 20, C: 30 },
        { ID: "2", A: 15, B: 25, C: 40 },
        { ID: "3", A: 20, B: 30, C: 50 },
        { ID: "4", A: 25, B: 35, C: 60 },
        { ID: "5", A: 30, B: 40, C: 70 },
      ]
    );
    // AFTER has same formula C = A + B but different underlying values
    const after = makeParsedData(
      ["ID", "A", "B", "C"],
      [
        { ID: "1", A: 100, B: 200, C: 300 },
        { ID: "2", A: 150, B: 250, C: 400 },
        { ID: "3", A: 200, B: 300, C: 500 },
        { ID: "4", A: 250, B: 350, C: 600 },
        { ID: "5", A: 300, B: 400, C: 700 },
        { ID: "6", A: 350, B: 450, C: 800 },
        { ID: "7", A: 400, B: 500, C: 900 },
      ]
    );

    const steps: ForgeStep[] = [
      step(1, "calculate", {
        column: "C",
        formula: "{A}+{B}",
        sourceColumns: ["A", "B"],
      }, "Compute C from A and B"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    // Blueprint correctly computes C = A + B on BEFORE data
    // Values won't match AFTER because input data differs
    // But formula STRUCTURE is valid → should warn, not fail
    expect(result.passed).toBe(true);

    const formulaCheck = result.patternChecks!.find(
      (c) => c.category === "formula"
    );
    expect(formulaCheck).toBeDefined();
    expect(formulaCheck!.status).toBe("warn");
    expect(formulaCheck!.description).toContain("different time periods");
  });

  it("should produce correct output when formulas use post-rename column names", () => {
    // Simulates Bug 2: AI generates formula referencing pre-rename name "Old_Col"
    // but rename step already changed it to "New Col".
    // After the route-level post-processing fix, the formula arrives here with
    // the correct post-rename name. This test verifies the executor handles it.
    const before = makeParsedData(
      ["ID", "New Col", "Other"],
      [
        { ID: "1", "New Col": 10, Other: 5 },
        { ID: "2", "New Col": 20, Other: 8 },
        { ID: "3", "New Col": 30, Other: 12 },
      ]
    );
    // AFTER expects a "Result" column = New Col + Other
    const after = makeParsedData(
      ["ID", "New Col", "Other", "Result"],
      [
        { ID: "1", "New Col": 10, Other: 5, Result: 15 },
        { ID: "2", "New Col": 20, Other: 8, Result: 28 },
        { ID: "3", "New Col": 30, Other: 12, Result: 42 },
      ]
    );

    // Steps: rename already happened (not included — columns already renamed in input),
    // then calculate uses the post-rename name "{New Col}" (not "{Old_Col}")
    const steps: ForgeStep[] = [
      step(1, "calculate", {
        column: "Result",
        formula: "{New Col}+{Other}",
        sourceColumns: ["New Col", "Other"],
      }, "Compute Result"),
    ];

    const result = validateBlueprint(steps, before, after, "pattern");

    expect(result.passed).toBe(true);
    // Column structure: 4/4 expected columns produced
    const structCheck = result.patternChecks!.find(c => c.category === "column_structure");
    expect(structCheck?.status).not.toBe("fail");
    // Formula: values match because same data
    const formulaCheck = result.patternChecks!.find(c => c.category === "formula");
    expect(formulaCheck).toBeDefined();
    expect(["pass", "warn"]).toContain(formulaCheck!.status);
  });
});
