import { describe, it, expect } from "vitest";
import { executeBlueprint } from "@/lib/mjolnir/engine/blueprint-executor";
import type { ForgeStep } from "@/lib/mjolnir/types";

// ─── Helper ─────────────────────────────────────────

function step(
  order: number,
  type: string,
  config: Record<string, unknown>,
  description = ""
): ForgeStep {
  return { order, type: type as ForgeStep["type"], confidence: 1.0, config, description };
}

// ─── Sample Data ────────────────────────────────────

function sampleInput() {
  return {
    columns: ["Name", "Age", "City", "Score"],
    rows: [
      { Name: "Alice", Age: 30, City: "NYC", Score: 85 },
      { Name: "Bob", Age: 25, City: "LA", Score: 92 },
      { Name: "Charlie", Age: 35, City: "NYC", Score: 78 },
      { Name: "Diana", Age: 28, City: "SF", Score: 95 },
    ],
  };
}

// ─── remove_columns ─────────────────────────────────

describe("remove_columns", () => {
  it("removes specified columns from output", () => {
    const result = executeBlueprint(
      [step(0, "remove_columns", { columns: ["City", "Score"] })],
      sampleInput()
    );

    expect(result.columns).toEqual(["Name", "Age"]);
    expect(result.rows[0]).toEqual({ Name: "Alice", Age: 30 });
    expect(result.rows[1]).toEqual({ Name: "Bob", Age: 25 });
  });
});

// ─── rename_columns ─────────────────────────────────

describe("rename_columns", () => {
  it("renames columns and updates row keys", () => {
    const result = executeBlueprint(
      [step(0, "rename_columns", { mapping: { Name: "Full Name", Age: "Years" } })],
      sampleInput()
    );

    expect(result.columns).toEqual(["Full Name", "Years", "City", "Score"]);
    expect(result.rows[0]["Full Name"]).toBe("Alice");
    expect(result.rows[0]["Years"]).toBe(30);
    expect(result.rows[0]).not.toHaveProperty("Name");
    expect(result.rows[0]).not.toHaveProperty("Age");
  });
});

// ─── reorder_columns ────────────────────────────────

describe("reorder_columns", () => {
  it("reorders column list", () => {
    const result = executeBlueprint(
      [step(0, "reorder_columns", { order: ["Score", "Name", "City", "Age"] })],
      sampleInput()
    );

    expect(result.columns).toEqual(["Score", "Name", "City", "Age"]);
  });
});

// ─── filter_rows ────────────────────────────────────

describe("filter_rows", () => {
  it("eq: keeps matching rows", () => {
    const result = executeBlueprint(
      [step(0, "filter_rows", { column: "City", operator: "eq", value: "NYC" })],
      sampleInput()
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.Name)).toEqual(["Alice", "Charlie"]);
  });

  it("neq: removes matching rows", () => {
    const result = executeBlueprint(
      [step(0, "filter_rows", { column: "City", operator: "neq", value: "NYC" })],
      sampleInput()
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.Name)).toEqual(["Bob", "Diana"]);
  });

  it("gt/lt: numeric comparison", () => {
    const gtResult = executeBlueprint(
      [step(0, "filter_rows", { column: "Age", operator: "gt", value: 28 })],
      sampleInput()
    );
    expect(gtResult.rows.map((r) => r.Name)).toEqual(["Alice", "Charlie"]);

    const ltResult = executeBlueprint(
      [step(0, "filter_rows", { column: "Age", operator: "lt", value: 30 })],
      sampleInput()
    );
    expect(ltResult.rows.map((r) => r.Name)).toEqual(["Bob", "Diana"]);
  });

  it("contains: case-insensitive string match", () => {
    const result = executeBlueprint(
      [step(0, "filter_rows", { column: "Name", operator: "contains", value: "ali" })],
      sampleInput()
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].Name).toBe("Alice");
  });

  it("is_null and not_null", () => {
    const input = {
      columns: ["Name", "Value"],
      rows: [
        { Name: "A", Value: 10 },
        { Name: "B", Value: null },
        { Name: "C", Value: "" },
        { Name: "D", Value: 20 },
      ],
    };

    const nullResult = executeBlueprint(
      [step(0, "filter_rows", { column: "Value", operator: "is_null" })],
      input
    );
    expect(nullResult.rows.map((r) => r.Name)).toEqual(["B", "C"]);

    const notNullResult = executeBlueprint(
      [step(0, "filter_rows", { column: "Value", operator: "not_null" })],
      input
    );
    expect(notNullResult.rows.map((r) => r.Name)).toEqual(["A", "D"]);
  });
});

// ─── format ─────────────────────────────────────────

describe("format", () => {
  it("uppercase: converts column values to uppercase", () => {
    const result = executeBlueprint(
      [step(0, "format", { column: "Name", formatType: "uppercase" })],
      sampleInput()
    );

    expect(result.rows.map((r) => r.Name)).toEqual(["ALICE", "BOB", "CHARLIE", "DIANA"]);
  });

  it("lowercase: converts column values to lowercase", () => {
    const result = executeBlueprint(
      [step(0, "format", { column: "City", formatType: "lowercase" })],
      sampleInput()
    );

    expect(result.rows.map((r) => r.City)).toEqual(["nyc", "la", "nyc", "sf"]);
  });

  it("trim: removes whitespace", () => {
    const input = {
      columns: ["Name"],
      rows: [
        { Name: "  Alice  " },
        { Name: "Bob " },
        { Name: " Charlie" },
      ],
    };

    const result = executeBlueprint(
      [step(0, "format", { column: "Name", formatType: "trim" })],
      input
    );

    expect(result.rows.map((r) => r.Name)).toEqual(["Alice", "Bob", "Charlie"]);
  });
});

// ─── calculate ──────────────────────────────────────

describe("calculate", () => {
  it("adds a calculated column using formula", () => {
    const result = executeBlueprint(
      [step(0, "calculate", { column: "DoubleScore", formula: "{Score} * 2" })],
      sampleInput()
    );

    expect(result.columns).toContain("DoubleScore");
    expect(result.rows[0].DoubleScore).toBe(170);
    expect(result.rows[1].DoubleScore).toBe(184);
  });

  it("sets null and adds warning on parse error", () => {
    const input = {
      columns: ["A"],
      rows: [{ A: 10 }],
    };

    // Use an invalid formula that will throw during parsing
    const result = executeBlueprint(
      [step(0, "calculate", { column: "Bad", formula: "UNKNOWN_FUNC({A})" })],
      input
    );

    expect(result.rows[0].Bad).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Formula parse error");
  });
});

// ─── sort ───────────────────────────────────────────

describe("sort", () => {
  it("asc: sorts numerically ascending", () => {
    const result = executeBlueprint(
      [step(0, "sort", { column: "Age", direction: "asc" })],
      sampleInput()
    );

    const ages = result.rows.map((r) => r.Age);
    expect(ages).toEqual([25, 28, 30, 35]);
  });

  it("desc: sorts strings descending", () => {
    const result = executeBlueprint(
      [step(0, "sort", { column: "Name", direction: "desc" })],
      sampleInput()
    );

    const names = result.rows.map((r) => r.Name);
    expect(names).toEqual(["Diana", "Charlie", "Bob", "Alice"]);
  });

  it("nulls sort last regardless of direction", () => {
    const input = {
      columns: ["Name", "Value"],
      rows: [
        { Name: "A", Value: 3 },
        { Name: "B", Value: null },
        { Name: "C", Value: 1 },
        { Name: "D", Value: null },
        { Name: "E", Value: 2 },
      ],
    };

    const ascResult = executeBlueprint(
      [step(0, "sort", { column: "Value", direction: "asc" })],
      input
    );
    expect(ascResult.rows.map((r) => r.Name)).toEqual(["C", "E", "A", "B", "D"]);

    const descResult = executeBlueprint(
      [step(0, "sort", { column: "Value", direction: "desc" })],
      input
    );
    expect(descResult.rows.map((r) => r.Name)).toEqual(["A", "E", "C", "B", "D"]);
  });
});

// ─── deduplicate ────────────────────────────────────

describe("deduplicate", () => {
  it("removes duplicate rows (all columns)", () => {
    const input = {
      columns: ["Name", "City"],
      rows: [
        { Name: "Alice", City: "NYC" },
        { Name: "Bob", City: "LA" },
        { Name: "Alice", City: "NYC" },
        { Name: "Bob", City: "LA" },
        { Name: "Charlie", City: "SF" },
      ],
    };

    const result = executeBlueprint(
      [step(0, "deduplicate", {})],
      input
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.Name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("deduplicates using specific columns", () => {
    const input = {
      columns: ["Name", "City", "Score"],
      rows: [
        { Name: "Alice", City: "NYC", Score: 85 },
        { Name: "Bob", City: "NYC", Score: 90 },
        { Name: "Charlie", City: "LA", Score: 78 },
        { Name: "Diana", City: "LA", Score: 95 },
      ],
    };

    const result = executeBlueprint(
      [step(0, "deduplicate", { columns: ["City"] })],
      input
    );

    // Keeps first occurrence per unique City value
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.Name)).toEqual(["Alice", "Charlie"]);
  });
});

// ─── Multi-step pipeline ────────────────────────────

describe("multi-step pipeline", () => {
  it("executes remove → rename → calculate → sort in sequence", () => {
    const result = executeBlueprint(
      [
        step(0, "remove_columns", { columns: ["City"] }),
        step(1, "rename_columns", { mapping: { Score: "Points" } }),
        step(2, "calculate", { column: "Bonus", formula: "{Points} * 0.1" }),
        step(3, "sort", { column: "Age", direction: "asc" }),
      ],
      sampleInput()
    );

    expect(result.columns).toEqual(["Name", "Age", "Points", "Bonus"]);

    // Sorted by Age ascending
    const ages = result.rows.map((r) => r.Age);
    expect(ages).toEqual([25, 28, 30, 35]);

    // Bonus should be 10% of Points
    expect(result.rows[0].Bonus).toBeCloseTo(9.2); // Bob: 92 * 0.1
    expect(result.rows[1].Bonus).toBeCloseTo(9.5); // Diana: 95 * 0.1
    expect(result.rows[2].Bonus).toBeCloseTo(8.5); // Alice: 85 * 0.1
    expect(result.rows[3].Bonus).toBeCloseTo(7.8); // Charlie: 78 * 0.1

    // No City column
    expect(result.rows[0]).not.toHaveProperty("City");
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── aggregate ─────────────────────────────────────

describe("aggregate", () => {
  it("groups and sums", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "sum", outputColumn: "Total Score" },
          { column: "Name", function: "count", outputColumn: "Count" },
        ],
      })],
      sampleInput()
    );

    expect(result.columns).toEqual(["City", "Total Score", "Count"]);
    expect(result.rows).toHaveLength(3); // NYC, LA, SF
    const nyc = result.rows.find((r) => r.City === "NYC");
    expect(nyc?.["Total Score"]).toBe(163); // 85 + 78
    expect(nyc?.Count).toBe(2);
  });

  it("computes avg", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "avg", outputColumn: "Avg Score" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find((r) => r.City === "NYC");
    expect(nyc?.["Avg Score"]).toBeCloseTo(81.5, 1);
  });

  it("computes min and max", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Score", function: "min", outputColumn: "Min" },
          { column: "Score", function: "max", outputColumn: "Max" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find((r) => r.City === "NYC");
    expect(nyc?.Min).toBe(78);
    expect(nyc?.Max).toBe(85);
  });

  it("computes count_distinct", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [
          { column: "Name", function: "count_distinct", outputColumn: "Unique Names" },
        ],
      })],
      sampleInput()
    );

    const nyc = result.rows.find((r) => r.City === "NYC");
    expect(nyc?.["Unique Names"]).toBe(2);
  });

  it("defaults outputColumn to function_column", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["City"],
        aggregations: [{ column: "Score", function: "sum" }],
      })],
      sampleInput()
    );

    expect(result.columns).toContain("sum_Score");
  });

  it("handles empty groupBy (global aggregate)", () => {
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: [],
        aggregations: [
          { column: "Score", function: "sum", outputColumn: "Total" },
          { column: "Name", function: "count", outputColumn: "N" },
        ],
      })],
      sampleInput()
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].Total).toBe(350);
    expect(result.rows[0].N).toBe(4);
  });

  it("handles null values in aggregation (nulls skipped)", () => {
    const input = {
      columns: ["Group", "Value"],
      rows: [
        { Group: "A", Value: 10 },
        { Group: "A", Value: null },
        { Group: "A", Value: 20 },
      ],
    };
    const result = executeBlueprint(
      [step(0, "aggregate", {
        groupBy: ["Group"],
        aggregations: [{ column: "Value", function: "sum", outputColumn: "Total" }],
      })],
      input
    );

    expect(result.rows[0].Total).toBe(30);
  });
});

// ─── split_column ──────────────────────────────────

describe("split_column", () => {
  it("splits column by delimiter", () => {
    const input = {
      columns: ["FullName", "Age"],
      rows: [
        { FullName: "John Doe", Age: 30 },
        { FullName: "Jane Smith", Age: 25 },
      ],
    };
    const result = executeBlueprint(
      [step(0, "split_column", {
        column: "FullName",
        delimiter: " ",
        outputColumns: ["FirstName", "LastName"],
      })],
      input
    );

    expect(result.columns).toEqual(["FirstName", "LastName", "Age"]);
    expect(result.rows[0].FirstName).toBe("John");
    expect(result.rows[0].LastName).toBe("Doe");
    expect(result.rows[0]).not.toHaveProperty("FullName");
  });

  it("keeps original when keepOriginal is true", () => {
    const input = {
      columns: ["FullName", "Age"],
      rows: [{ FullName: "John Doe", Age: 30 }],
    };
    const result = executeBlueprint(
      [step(0, "split_column", {
        column: "FullName",
        delimiter: " ",
        outputColumns: ["First", "Last"],
        keepOriginal: true,
      })],
      input
    );

    expect(result.columns).toContain("FullName");
    expect(result.columns).toContain("First");
    expect(result.columns).toContain("Last");
  });

  it("pads with null when split produces fewer parts", () => {
    const input = {
      columns: ["Data"],
      rows: [{ Data: "OnlyOne" }],
    };
    const result = executeBlueprint(
      [step(0, "split_column", {
        column: "Data",
        delimiter: "-",
        outputColumns: ["A", "B", "C"],
      })],
      input
    );

    expect(result.rows[0].A).toBe("OnlyOne");
    expect(result.rows[0].B).toBeNull();
    expect(result.rows[0].C).toBeNull();
  });

  it("drops excess parts beyond outputColumns length", () => {
    const input = {
      columns: ["Data"],
      rows: [{ Data: "A-B-C-D-E" }],
    };
    const result = executeBlueprint(
      [step(0, "split_column", {
        column: "Data",
        delimiter: "-",
        outputColumns: ["P1", "P2"],
      })],
      input
    );

    expect(result.rows[0].P1).toBe("A");
    expect(result.rows[0].P2).toBe("B");
    expect(result.rows[0]).not.toHaveProperty("P3");
  });
});

// ─── merge_columns ─────────────────────────────────

describe("merge_columns", () => {
  it("merges columns with delimiter", () => {
    const result = executeBlueprint(
      [step(0, "merge_columns", {
        columns: ["City", "Score"],
        delimiter: " - ",
        outputColumn: "CityScore",
      })],
      sampleInput()
    );

    expect(result.columns).toContain("CityScore");
    expect(result.rows[0].CityScore).toBe("NYC - 85");
    // Originals removed by default
    expect(result.columns).not.toContain("City");
    expect(result.columns).not.toContain("Score");
  });

  it("keeps originals when keepOriginals is true", () => {
    const result = executeBlueprint(
      [step(0, "merge_columns", {
        columns: ["Name", "City"],
        delimiter: " @ ",
        outputColumn: "NameCity",
        keepOriginals: true,
      })],
      sampleInput()
    );

    expect(result.columns).toContain("Name");
    expect(result.columns).toContain("City");
    expect(result.columns).toContain("NameCity");
    expect(result.rows[0].NameCity).toBe("Alice @ NYC");
  });

  it("skips null values in merge", () => {
    const input = {
      columns: ["A", "B", "C"],
      rows: [{ A: "Hello", B: null, C: "World" }],
    };
    const result = executeBlueprint(
      [step(0, "merge_columns", {
        columns: ["A", "B", "C"],
        delimiter: " ",
        outputColumn: "Merged",
      })],
      input
    );

    expect(result.rows[0].Merged).toBe("Hello World");
  });
});

// ─── Step Metrics ──────────────────────────────────

describe("step metrics", () => {
  it("returns metrics for each step", () => {
    const result = executeBlueprint(
      [
        step(0, "filter_rows", { column: "City", operator: "eq", value: "NYC" }),
        step(1, "remove_columns", { columns: ["Score"] }),
      ],
      sampleInput()
    );

    expect(result.metrics).toHaveLength(2);

    expect(result.metrics[0].type).toBe("filter_rows");
    expect(result.metrics[0].order).toBe(0);
    expect(result.metrics[0].rowsIn).toBe(4);
    expect(result.metrics[0].rowsOut).toBe(2);
    expect(result.metrics[0].columnsIn).toBe(4);
    expect(result.metrics[0].columnsOut).toBe(4);

    expect(result.metrics[1].type).toBe("remove_columns");
    expect(result.metrics[1].rowsIn).toBe(2);
    expect(result.metrics[1].rowsOut).toBe(2);
    expect(result.metrics[1].columnsIn).toBe(4);
    expect(result.metrics[1].columnsOut).toBe(3);

    expect(typeof result.metrics[0].durationMs).toBe("number");
    expect(result.metrics[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty metrics for empty steps", () => {
    const result = executeBlueprint([], sampleInput());
    expect(result.metrics).toEqual([]);
  });

  it("reports totalDurationMs", () => {
    const result = executeBlueprint(
      [step(0, "sort", { column: "Age" })],
      sampleInput()
    );
    expect(typeof result.totalDurationMs).toBe("number");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Stub types ─────────────────────────────────────

describe("stub step types", () => {
  it("lookup, pivot, unpivot, custom_sql add warnings and pass through", () => {
    const input = {
      columns: ["A"],
      rows: [{ A: 1 }, { A: 2 }],
    };

    const stubTypes = ["lookup", "pivot", "unpivot", "custom_sql"] as const;

    for (const stubType of stubTypes) {
      const result = executeBlueprint(
        [step(0, stubType, {})],
        input
      );

      // Data passes through unchanged
      expect(result.columns).toEqual(["A"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].A).toBe(1);

      // Warning is added
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toBe(`Step type '${stubType}' is not yet implemented`);
    }
  });
});
