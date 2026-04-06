import { describe, it, expect } from "vitest";
import {
  computeStructuralDiff,
  levenshteinDistance,
  normalizeColumnName,
} from "@/lib/mjolnir/engine/structural-diff";
import { fingerprintAllColumns } from "@/lib/mjolnir/engine/fingerprint";
import type { ParsedFileData } from "@/lib/mjolnir/types";

// ─── Test Helpers ────────────────────────────────────

/**
 * Build a ParsedFileData from columns and rows, auto-generating fingerprints.
 */
function makeParsedFile(
  fileId: string,
  filename: string,
  columns: string[],
  rows: Record<string, unknown>[]
): ParsedFileData {
  return {
    fileId,
    filename,
    columns,
    rows,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 50),
    fingerprints: fingerprintAllColumns(columns, rows),
    headerRowIndex: 1,
  };
}

// ─── levenshteinDistance ──────────────────────────────

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns 1 for a single insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("returns 1 for a single deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("returns 1 for a single substitution", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  it("returns full length when comparing with empty string", () => {
    expect(levenshteinDistance("", "hello")).toBe(5);
    expect(levenshteinDistance("hello", "")).toBe(5);
  });

  it("handles both empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("computes correct distance for multi-edit case", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

// ─── Column Matching ─────────────────────────────────

describe("column matching", () => {
  it("matches columns by exact name", () => {
    const before = makeParsedFile("b", "before.csv", ["id", "name", "amount"], [
      { id: 1, name: "alice", amount: 100 },
      { id: 2, name: "bob", amount: 200 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["id", "name", "amount"], [
      { id: 1, name: "alice", amount: 100 },
      { id: 2, name: "bob", amount: 200 },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.matchedColumns).toHaveLength(3);
    expect(result.matchedColumns.every((m) => m.matchType === "exact")).toBe(
      true
    );
    expect(result.matchedColumns.every((m) => m.confidence === 1.0)).toBe(true);
    expect(result.removedColumns).toHaveLength(0);
    expect(result.addedColumns).toHaveLength(0);
  });

  it("matches columns by case-insensitive name", () => {
    const before = makeParsedFile("b", "before.csv", ["Name", "Amount"], [
      { Name: "alice", Amount: 100 },
      { Name: "bob", Amount: 200 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["name", "amount"], [
      { name: "alice", amount: 100 },
      { name: "bob", amount: 200 },
    ]);

    const result = computeStructuralDiff(before, after);
    const caseMatches = result.matchedColumns.filter(
      (m) => m.matchType === "case_insensitive"
    );
    expect(caseMatches).toHaveLength(2);
    expect(caseMatches[0].confidence).toBe(0.95);
  });

  it("matches columns by levenshtein distance", () => {
    const before = makeParsedFile(
      "b",
      "before.csv",
      ["employee_name", "employee_salary"],
      [
        { employee_name: "alice", employee_salary: 50000 },
        { employee_name: "bob", employee_salary: 60000 },
      ]
    );
    const after = makeParsedFile(
      "a",
      "after.csv",
      ["employe_name", "employee_salry"],
      [
        { employe_name: "alice", employee_salry: 50000 },
        { employe_name: "bob", employee_salry: 60000 },
      ]
    );

    const result = computeStructuralDiff(before, after);
    const levMatches = result.matchedColumns.filter(
      (m) => m.matchType === "levenshtein"
    );
    expect(levMatches.length).toBeGreaterThanOrEqual(1);
    expect(levMatches.every((m) => m.confidence >= 0.7)).toBe(true);
  });

  it("matches columns by fingerprint when names differ but data is identical", () => {
    const before = makeParsedFile("b", "before.csv", ["col_x"], [
      { col_x: "alpha" },
      { col_x: "beta" },
      { col_x: "gamma" },
    ]);
    const after = makeParsedFile("a", "after.csv", ["renamed_completely"], [
      { renamed_completely: "alpha" },
      { renamed_completely: "beta" },
      { renamed_completely: "gamma" },
    ]);

    const result = computeStructuralDiff(before, after);
    const fpMatches = result.matchedColumns.filter(
      (m) => m.matchType === "fingerprint"
    );
    expect(fpMatches).toHaveLength(1);
    expect(fpMatches[0].confidence).toBe(0.6);
  });
});

// ─── Removed & Added Columns ─────────────────────────

describe("removed and added columns", () => {
  it("detects removed columns", () => {
    const before = makeParsedFile(
      "b",
      "before.csv",
      ["id", "name", "secret"],
      [
        { id: 1, name: "alice", secret: "xxx" },
        { id: 2, name: "bob", secret: "yyy" },
      ]
    );
    const after = makeParsedFile("a", "after.csv", ["id", "name"], [
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.removedColumns).toContain("secret");
    // Should have a remove_columns step
    const removeStep = result.deterministicSteps.find(
      (s) => s.type === "remove_columns"
    );
    expect(removeStep).toBeDefined();
    expect(removeStep!.confidence).toBe(1.0);
  });

  it("detects added columns", () => {
    const before = makeParsedFile("b", "before.csv", ["id", "name"], [
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
    const after = makeParsedFile(
      "a",
      "after.csv",
      ["id", "name", "total"],
      [
        { id: 1, name: "alice", total: 100 },
        { id: 2, name: "bob", total: 200 },
      ]
    );

    const result = computeStructuralDiff(before, after);
    expect(result.addedColumns).toContain("total");
    // Should have an ambiguous case for the new column
    const newColCase = result.ambiguousCases.find(
      (c) => c.type === "new_column"
    );
    expect(newColCase).toBeDefined();
    expect(newColCase!.description).toContain("total");
  });
});

// ─── Row Count Analysis ──────────────────────────────

describe("row count analysis", () => {
  it("reports correct row counts and removed rows", () => {
    const before = makeParsedFile("b", "before.csv", ["id"], [
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["id"], [
      { id: 1 },
      { id: 3 },
      { id: 5 },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.beforeRowCount).toBe(5);
    expect(result.afterRowCount).toBe(3);
    expect(result.removedRowCount).toBe(2);
  });

  it("reports 0 removed rows when AFTER has more rows", () => {
    const before = makeParsedFile("b", "before.csv", ["id"], [{ id: 1 }]);
    const after = makeParsedFile("a", "after.csv", ["id"], [
      { id: 1 },
      { id: 2 },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.removedRowCount).toBe(0);
  });
});

// ─── Sort Detection ──────────────────────────────────

describe("sort detection", () => {
  it("detects ascending sort on a numeric column", () => {
    const before = makeParsedFile("b", "before.csv", ["val"], [
      { val: 30 },
      { val: 10 },
      { val: 20 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["val"], [
      { val: 10 },
      { val: 20 },
      { val: 30 },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.sortDetected).toBeDefined();
    expect(result.sortDetected!.column).toBe("val");
    expect(result.sortDetected!.direction).toBe("asc");
  });

  it("detects descending sort on a string column", () => {
    const before = makeParsedFile("b", "before.csv", ["name"], [
      { name: "alice" },
      { name: "charlie" },
      { name: "bob" },
    ]);
    const after = makeParsedFile("a", "after.csv", ["name"], [
      { name: "charlie" },
      { name: "bob" },
      { name: "alice" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.sortDetected).toBeDefined();
    expect(result.sortDetected!.direction).toBe("desc");
  });

  it("does not report sort when BEFORE was already sorted the same way", () => {
    const before = makeParsedFile("b", "before.csv", ["val"], [
      { val: 1 },
      { val: 2 },
      { val: 3 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["val"], [
      { val: 1 },
      { val: 2 },
      { val: 3 },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.sortDetected).toBeUndefined();
  });
});

// ─── Format Change Detection ─────────────────────────

describe("format change detection", () => {
  it("detects case changes (uppercase)", () => {
    const before = makeParsedFile("b", "before.csv", ["name"], [
      { name: "alice" },
      { name: "bob" },
      { name: "charlie" },
    ]);
    const after = makeParsedFile("a", "after.csv", ["name"], [
      { name: "ALICE" },
      { name: "BOB" },
      { name: "CHARLIE" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.formatChanges).toHaveLength(1);
    expect(result.formatChanges[0].changeType).toBe("case");
    expect(result.formatChanges[0].column).toBe("name");
  });

  it("detects trim changes", () => {
    const before = makeParsedFile("b", "before.csv", ["name"], [
      { name: "  alice  " },
      { name: "  bob  " },
      { name: "  charlie  " },
    ]);
    const after = makeParsedFile("a", "after.csv", ["name"], [
      { name: "alice" },
      { name: "bob" },
      { name: "charlie" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.formatChanges).toHaveLength(1);
    expect(result.formatChanges[0].changeType).toBe("trim");
  });
});

// ─── Reorder Detection ──────────────────────────────

describe("reorder detection", () => {
  it("detects column reordering", () => {
    const before = makeParsedFile("b", "before.csv", ["id", "name", "amount"], [
      { id: 1, name: "alice", amount: 100 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["amount", "id", "name"], [
      { amount: 100, id: 1, name: "alice" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.reorderDetected).toBe(true);
    const reorderStep = result.deterministicSteps.find(
      (s) => s.type === "reorder_columns"
    );
    expect(reorderStep).toBeDefined();
    expect(reorderStep!.confidence).toBe(1.0);
  });

  it("does not flag reorder when columns are in same order", () => {
    const before = makeParsedFile("b", "before.csv", ["id", "name"], [
      { id: 1, name: "alice" },
    ]);
    const after = makeParsedFile("a", "after.csv", ["id", "name"], [
      { id: 1, name: "alice" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.reorderDetected).toBe(false);
  });
});

// ─── Full Integration ────────────────────────────────

describe("full integration: multi-transformation diff", () => {
  it("detects multiple transformations in a single diff", () => {
    // NOTE: before rows are in the same positional order as after so that
    // the row-positional format detection can identify the trim change.
    // Sort is still detected because before id values (1,2,3) were already
    // ascending — we use salary descending in after to trigger sort detection.
    const before = makeParsedFile(
      "b",
      "before.csv",
      ["id", "employee_name", "salary", "secret_code"],
      [
        { id: 1, employee_name: "  alice  ", salary: 50000, secret_code: "y" },
        { id: 2, employee_name: "  bob  ", salary: 60000, secret_code: "z" },
        { id: 3, employee_name: "  charlie  ", salary: 70000, secret_code: "x" },
      ]
    );
    const after = makeParsedFile(
      "a",
      "after.csv",
      ["employee_name", "id", "salary", "bonus"],
      [
        { employee_name: "alice", id: 3, salary: 70000, bonus: 7000 },
        { employee_name: "bob", id: 2, salary: 60000, bonus: 6000 },
        { employee_name: "charlie", id: 1, salary: 50000, bonus: 5000 },
      ]
    );

    const result = computeStructuralDiff(before, after);

    // secret_code was removed
    expect(result.removedColumns).toContain("secret_code");

    // bonus is new
    expect(result.addedColumns).toContain("bonus");

    // Columns were reordered (employee_name moved before id)
    expect(result.reorderDetected).toBe(true);

    // salary column is now sorted descending (was ascending in before)
    expect(result.sortDetected).toBeDefined();
    expect(result.sortDetected!.direction).toBe("desc");

    // employee_name was trimmed (positional comparison works since row order aligns)
    const trimChange = result.formatChanges.find(
      (fc) => fc.changeType === "trim"
    );
    expect(trimChange).toBeDefined();

    // Should have multiple deterministic steps
    expect(result.deterministicSteps.length).toBeGreaterThanOrEqual(2);

    // Should have ambiguous case for bonus column
    const bonusCase = result.ambiguousCases.find(
      (c) => c.type === "new_column" && c.description.includes("bonus")
    );
    expect(bonusCase).toBeDefined();
  });
});

// ─── Edge Cases ──────────────────────────────────────

describe("edge cases", () => {
  it("handles empty files (no rows)", () => {
    const before = makeParsedFile("b", "before.csv", ["id", "name"], []);
    const after = makeParsedFile("a", "after.csv", ["id", "name"], []);

    const result = computeStructuralDiff(before, after);
    expect(result.matchedColumns).toHaveLength(2);
    expect(result.beforeRowCount).toBe(0);
    expect(result.afterRowCount).toBe(0);
    expect(result.removedRowCount).toBe(0);
  });

  it("handles single column files", () => {
    const before = makeParsedFile("b", "before.csv", ["val"], [
      { val: "a" },
      { val: "b" },
    ]);
    const after = makeParsedFile("a", "after.csv", ["val"], [
      { val: "a" },
      { val: "b" },
    ]);

    const result = computeStructuralDiff(before, after);
    expect(result.matchedColumns).toHaveLength(1);
    expect(result.reorderDetected).toBe(false);
  });

  it("handles no changes at all", () => {
    const rows = [
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ];
    const before = makeParsedFile("b", "before.csv", ["id", "name"], rows);
    const after = makeParsedFile("a", "after.csv", ["id", "name"], rows);

    const result = computeStructuralDiff(before, after);
    expect(result.matchedColumns).toHaveLength(2);
    expect(result.removedColumns).toHaveLength(0);
    expect(result.addedColumns).toHaveLength(0);
    expect(result.removedRowCount).toBe(0);
    expect(result.sortDetected).toBeUndefined();
    expect(result.formatChanges).toHaveLength(0);
    expect(result.reorderDetected).toBe(false);
    expect(result.deterministicSteps).toHaveLength(0);
    expect(result.ambiguousCases).toHaveLength(0);
  });

  it("handles completely disjoint column sets", () => {
    const before = makeParsedFile("b", "before.csv", ["a", "b"], [
      { a: 1, b: 2 },
    ]);
    const after = makeParsedFile("a", "after.csv", ["x", "y"], [
      { x: 3, y: 4 },
    ]);

    const result = computeStructuralDiff(before, after);
    // With no matching names or data overlap, most columns should be unmatched
    expect(result.removedColumns.length + result.matchedColumns.length).toBe(2);
    expect(result.addedColumns.length + result.matchedColumns.length).toBe(2);
  });
});

// ─── Value-Based Column Matching (Issues #5, #8) ────

describe("value-based column matching", () => {
  it("matches columns with completely different names but identical data", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      employee_id: i + 1,
      full_name: `Person ${i}`,
    }));
    const afterRows = rows.map((r) => ({
      "Worker ID": r.employee_id,
      "Worker Name": r.full_name,
    }));

    const before = makeParsedFile("b", "before.csv", ["employee_id", "full_name"], rows);
    const after = makeParsedFile("a", "after.csv", ["Worker ID", "Worker Name"], afterRows);

    const result = computeStructuralDiff(before, after);

    // All columns should be matched (via value overlap or fingerprint)
    expect(result.matchedColumns).toHaveLength(2);
    expect(result.removedColumns).toHaveLength(0);
    expect(result.addedColumns).toHaveLength(0);
  });

  it("matches columns with trimmed/cased data as value overlap", () => {
    const before = makeParsedFile("b", "b.csv", ["orig_col"], [
      { orig_col: "hello" },
      { orig_col: "world" },
      { orig_col: "test" },
    ]);
    const after = makeParsedFile("a", "a.csv", ["renamed_col"], [
      { renamed_col: "  Hello  " },
      { renamed_col: "  World  " },
      { renamed_col: "  Test  " },
    ]);

    const result = computeStructuralDiff(before, after);

    // Should match via value overlap (fuzzy: trimmed + case-insensitive)
    const valueMatches = result.matchedColumns.filter(
      (m) => m.matchType === "value_overlap" || m.matchType === "fingerprint" || m.matchType === "loose_fingerprint"
    );
    expect(valueMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("does not match columns with completely different data", () => {
    const before = makeParsedFile("b", "b.csv", ["numbers"], [
      { numbers: 1 },
      { numbers: 2 },
      { numbers: 3 },
    ]);
    const after = makeParsedFile("a", "a.csv", ["letters"], [
      { letters: "a" },
      { letters: "b" },
      { letters: "c" },
    ]);

    const result = computeStructuralDiff(before, after);

    // Should not match — data is completely different
    expect(result.removedColumns).toContain("numbers");
    expect(result.addedColumns).toContain("letters");
  });
});

// ─── Short Column Names (Issue #7) ──────────────────

describe("short column name matching", () => {
  it("matches short column names (length 3) via Levenshtein", () => {
    const before = makeParsedFile("b", "b.csv", ["Qty", "Amt"], [
      { Qty: 10, Amt: 100 },
    ]);
    const after = makeParsedFile("a", "a.csv", ["Qti", "Amt"], [
      { Qti: 10, Amt: 100 },
    ]);

    const result = computeStructuralDiff(before, after);

    // "Qty" → "Qti" has Levenshtein distance 1, length 3 (now allowed with threshold > 2)
    const levMatch = result.matchedColumns.find(
      (m) => m.beforeColumn === "Qty" && m.afterColumn === "Qti"
    );
    expect(levMatch).toBeDefined();
    expect(levMatch!.matchType).toBe("levenshtein");
  });
});

// ─── Date Format Detection (Issue #10) ──────────────

describe("date format detection", () => {
  it("detects ISO to US date format change", () => {
    const before = makeParsedFile("b", "b.csv", ["date"], [
      { date: "2024-01-15" },
      { date: "2024-02-20" },
      { date: "2024-03-10" },
    ]);
    const after = makeParsedFile("a", "a.csv", ["date"], [
      { date: "01/15/2024" },
      { date: "02/20/2024" },
      { date: "03/10/2024" },
    ]);

    const result = computeStructuralDiff(before, after);

    const dateChange = result.formatChanges.find(
      (fc) => fc.changeType === "date_format"
    );
    expect(dateChange).toBeDefined();
    expect(dateChange!.column).toBe("date");
  });
});

// ─── normalizeColumnName ─────────────────────────────

describe("normalizeColumnName", () => {
  it("strips underscores and lowercases", () => {
    expect(normalizeColumnName("SOU_OnHand")).toBe("souonhand");
  });

  it("strips spaces and lowercases", () => {
    expect(normalizeColumnName("SOU On Hand")).toBe("souonhand");
  });

  it("strips hyphens", () => {
    expect(normalizeColumnName("first-name")).toBe("firstname");
  });

  it("handles mixed separators", () => {
    expect(normalizeColumnName("my_column-name here")).toBe("mycolumnnamehere");
  });

  it("already normalized names return unchanged", () => {
    expect(normalizeColumnName("abc")).toBe("abc");
  });
});

// ─── Normalized Column Matching ──────────────────────

describe("normalized column matching", () => {
  it("matches SOU_OnHand to SOU On Hand via normalized pass", () => {
    const rows = [
      { SOU_OnHand: 100, SOU_Available: 80 },
      { SOU_OnHand: 200, SOU_Available: 150 },
    ];
    const before = makeParsedFile("b1", "before.xlsx", ["SOU_OnHand", "SOU_Available"], rows);

    const afterRows = [
      { "SOU On Hand": 100, "SOU Available": 80 },
      { "SOU On Hand": 200, "SOU Available": 150 },
    ];
    const after = makeParsedFile("a1", "after.xlsx", ["SOU On Hand", "SOU Available"], afterRows);

    const result = computeStructuralDiff(before, after);

    // Both columns should match via normalized pass
    expect(result.matchedColumns).toHaveLength(2);

    const souMatch = result.matchedColumns.find(m => m.beforeColumn === "SOU_OnHand");
    expect(souMatch).toBeDefined();
    expect(souMatch!.afterColumn).toBe("SOU On Hand");
    expect(souMatch!.matchType).toBe("normalized");
    expect(souMatch!.confidence).toBe(0.92);

    // No unmatched columns
    expect(result.removedColumns).toHaveLength(0);
    expect(result.addedColumns).toHaveLength(0);
  });

  it("matches part_code to Part Code via normalized pass", () => {
    const before = makeParsedFile("b1", "before.xlsx", ["part_code"], [
      { part_code: "P001" },
      { part_code: "P002" },
    ]);
    const after = makeParsedFile("a1", "after.xlsx", ["Part Code"], [
      { "Part Code": "P001" },
      { "Part Code": "P002" },
    ]);

    const result = computeStructuralDiff(before, after);

    expect(result.matchedColumns).toHaveLength(1);
    expect(result.matchedColumns[0].matchType).toBe("normalized");
    expect(result.matchedColumns[0].beforeColumn).toBe("part_code");
    expect(result.matchedColumns[0].afterColumn).toBe("Part Code");
  });

  it("generates rename steps for normalized matches", () => {
    const before = makeParsedFile("b1", "before.xlsx", ["first_name", "last_name"], [
      { first_name: "Alice", last_name: "Smith" },
    ]);
    const after = makeParsedFile("a1", "after.xlsx", ["First Name", "Last Name"], [
      { "First Name": "Alice", "Last Name": "Smith" },
    ]);

    const result = computeStructuralDiff(before, after);

    // Should generate a rename step
    const renameStep = result.deterministicSteps.find(s => s.type === "rename_columns");
    expect(renameStep).toBeDefined();
    expect(renameStep!.config.mapping).toEqual({
      first_name: "First Name",
      last_name: "Last Name",
    });
  });

  it("prefers exact match over normalized match", () => {
    const before = makeParsedFile("b1", "before.xlsx", ["Name"], [{ Name: "Alice" }]);
    const after = makeParsedFile("a1", "after.xlsx", ["Name"], [{ Name: "Alice" }]);

    const result = computeStructuralDiff(before, after);

    expect(result.matchedColumns).toHaveLength(1);
    expect(result.matchedColumns[0].matchType).toBe("exact");
  });
});
