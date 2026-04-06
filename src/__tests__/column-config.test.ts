import { describe, it, expect } from "vitest";
import {
  syncWidthsFromTemplate,
  extractTemplatePixelWidths,
  migrateConfigWidths,
  generateColumnConfig,
  reconcileColumnConfig,
  applyColumnConfig,
  createFormulaColumn,
  isMissing,
  DEFAULT_EXCEL_WIDTH,
  UNIVER_PX_PER_EXCEL_WIDTH,
  type ColumnConfig,
} from "@/lib/column-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ColumnConfig> & { id: string }): ColumnConfig {
  return {
    sourceColumn: "col",
    displayName: "Col",
    visible: true,
    width: DEFAULT_EXCEL_WIDTH,
    ...overrides,
  };
}

function makeTemplate(
  columnMap: Record<string, number>,
  columnData: Record<number, { w?: number }>,
) {
  return {
    snapshot: {
      sheets: {
        sheet1: { columnData },
      },
    },
    columnMap,
  };
}

// ---------------------------------------------------------------------------
// extractTemplatePixelWidths
// ---------------------------------------------------------------------------

describe("extractTemplatePixelWidths", () => {
  it("extracts pixel widths from template", () => {
    const template = makeTemplate({ a: 0, b: 1 }, { 0: { w: 100 }, 1: { w: 200 } });
    const result = extractTemplatePixelWidths(template);
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(200);
  });

  it("returns empty map for null template", () => {
    expect(extractTemplatePixelWidths(null).size).toBe(0);
  });

  it("returns empty map when template has no sheets", () => {
    expect(extractTemplatePixelWidths({ snapshot: {}, columnMap: {} }).size).toBe(0);
  });

  it("skips columns with no pixel width", () => {
    const template = makeTemplate({ a: 0, b: 1 }, { 0: { w: 100 }, 1: {} });
    const result = extractTemplatePixelWidths(template);
    expect(result.size).toBe(1);
    expect(result.has("b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncWidthsFromTemplate
// ---------------------------------------------------------------------------

describe("syncWidthsFromTemplate", () => {
  it("converts Univer pixel widths to Excel character-width units (no baseline)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: DEFAULT_EXCEL_WIDTH }),
    ];
    const template = makeTemplate({ a: 0 }, { 0: { w: 120 } });

    const result = syncWidthsFromTemplate(config, template);

    const expected = Math.round((120 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    expect(result[0].width).toBe(expected);
  });

  it("returns config unchanged when template is null", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const result = syncWidthsFromTemplate(config, null);
    expect(result).toEqual(config);
  });

  it("returns config unchanged when template has no sheets", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const result = syncWidthsFromTemplate(config, { snapshot: {}, columnMap: { a: 0 } });
    expect(result).toEqual(config);
  });

  it("returns config unchanged when template has no columnMap", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const result = syncWidthsFromTemplate(config, {
      snapshot: { sheets: { s: { columnData: { 0: { w: 100 } } } } },
    });
    expect(result).toEqual(config);
  });

  it("skips entries not in columnMap", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const template = makeTemplate({ b: 0 }, { 0: { w: 200 } });

    const result = syncWidthsFromTemplate(config, template);
    expect(result[0].width).toBe(15);
  });

  it("skips entries where template column has no width", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const template = makeTemplate({ a: 0 }, { 0: {} });

    const result = syncWidthsFromTemplate(config, template);
    expect(result[0].width).toBe(15);
  });

  it("syncs all entries when baseline is undefined (first load)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: 10 }),
      makeConfig({ id: "b", width: 12 }),
    ];
    const template = makeTemplate(
      { a: 0, b: 1 },
      { 0: { w: 100 }, 1: { w: 200 } },
    );

    const result = syncWidthsFromTemplate(config, template);

    const expectedA = Math.round((100 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    const expectedB = Math.round((200 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    expect(result[0].width).toBe(expectedA);
    expect(result[1].width).toBe(expectedB);
  });

  it("syncs all entries when baseline is empty map (first save)", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 10 })];
    const template = makeTemplate({ a: 0 }, { 0: { w: 100 } });

    const result = syncWidthsFromTemplate(config, template, new Map());

    const expected = Math.round((100 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    expect(result[0].width).toBe(expected);
  });

  it("preserves config width when pixel width matches baseline (no drag)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: 20 }),  // manually set to 20
      makeConfig({ id: "b", width: 25 }),  // manually set to 25
    ];
    const template = makeTemplate(
      { a: 0, b: 1 },
      { 0: { w: 73 }, 1: { w: 73 } },  // Univer default, unchanged
    );
    // Baseline captured at load time — same pixel widths
    const baseline = new Map([["a", 73], ["b", 73]]);

    const result = syncWidthsFromTemplate(config, template, baseline);

    // Both should keep their manual widths since Univer widths didn't change
    expect(result[0].width).toBe(20);
    expect(result[1].width).toBe(25);
  });

  it("syncs from template when pixel width changed (user dragged)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: 20 }),  // manual width
      makeConfig({ id: "b", width: 25 }),  // manual width
    ];
    const template = makeTemplate(
      { a: 0, b: 1 },
      { 0: { w: 73 }, 1: { w: 150 } },  // b was dragged to 150px
    );
    // Baseline had both at 73px
    const baseline = new Map([["a", 73], ["b", 73]]);

    const result = syncWidthsFromTemplate(config, template, baseline);

    // "a" unchanged → keep manual width
    expect(result[0].width).toBe(20);
    // "b" pixel width changed → sync from template
    const expectedB = Math.round((150 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    expect(result[1].width).toBe(expectedB);
  });

  it("syncs column not in baseline (new column added since load)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: 20 }),
      makeConfig({ id: "b", width: DEFAULT_EXCEL_WIDTH }),  // new column
    ];
    const template = makeTemplate(
      { a: 0, b: 1 },
      { 0: { w: 73 }, 1: { w: 120 } },
    );
    // Baseline only has "a" (from original load)
    const baseline = new Map([["a", 73]]);

    const result = syncWidthsFromTemplate(config, template, baseline);

    // "a" unchanged → keep manual width
    expect(result[0].width).toBe(20);
    // "b" not in baseline → sync from template (first time)
    const expectedB = Math.round((120 / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100;
    expect(result[1].width).toBe(expectedB);
  });

  it("preserves widths across multiple saves (the reported bug scenario)", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", width: 20 }),  // user set this to 20
    ];
    const template = makeTemplate({ a: 0 }, { 0: { w: 73 } });

    // First save: baseline captured at load time
    const baseline1 = new Map([["a", 73]]);
    const result1 = syncWidthsFromTemplate(config, template, baseline1);
    expect(result1[0].width).toBe(20);  // preserved

    // Second save: baseline updated after first save (still 73, unchanged)
    const baseline2 = new Map([["a", 73]]);
    const result2 = syncWidthsFromTemplate(result1, template, baseline2);
    expect(result2[0].width).toBe(20);  // still preserved!

    // Third save: still unchanged
    const baseline3 = new Map([["a", 73]]);
    const result3 = syncWidthsFromTemplate(result2, template, baseline3);
    expect(result3[0].width).toBe(20);  // still preserved!
  });
});

// ---------------------------------------------------------------------------
// migrateConfigWidths
// ---------------------------------------------------------------------------

describe("migrateConfigWidths", () => {
  it("converts pixel widths (> 50) to Excel character-width units", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 120 })];
    const result = migrateConfigWidths(config);
    expect(result[0].width).toBe(Math.round((120 / 7) * 100) / 100);
  });

  it("leaves small widths unchanged", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 15 })];
    const result = migrateConfigWidths(config);
    expect(result[0].width).toBe(15);
  });

  it("treats width of exactly 50 as already migrated", () => {
    const config: ColumnConfig[] = [makeConfig({ id: "a", width: 50 })];
    const result = migrateConfigWidths(config);
    expect(result[0].width).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// generateColumnConfig
// ---------------------------------------------------------------------------

describe("generateColumnConfig", () => {
  it("generates config from column names", () => {
    const result = generateColumnConfig(["employee_id", "firstName"]);
    expect(result).toHaveLength(2);
    expect(result[0].sourceColumn).toBe("employee_id");
    expect(result[0].displayName).toBe("Employee Id");
    expect(result[0].visible).toBe(true);
    expect(result[0].width).toBe(DEFAULT_EXCEL_WIDTH);
    expect(result[1].displayName).toBe("First Name");
  });

  it("generates unique IDs", () => {
    const result = generateColumnConfig(["a", "b", "c"]);
    const ids = new Set(result.map((c) => c.id));
    expect(ids.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// reconcileColumnConfig
// ---------------------------------------------------------------------------

describe("reconcileColumnConfig", () => {
  it("keeps existing config entries for columns still in query", () => {
    const existing: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "col_a", displayName: "Column A", width: 20 }),
    ];
    const { config, warnings } = reconcileColumnConfig(existing, ["col_a"]);
    expect(config).toHaveLength(1);
    expect(config[0].displayName).toBe("Column A");
    expect(config[0].width).toBe(20);
    expect(warnings).toHaveLength(0);
  });

  it("appends new columns not in existing config", () => {
    const existing: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "col_a" }),
    ];
    const { config, warnings } = reconcileColumnConfig(existing, ["col_a", "col_b"]);
    expect(config).toHaveLength(2);
    expect(config[1].sourceColumn).toBe("col_b");
    expect(warnings).toContain('New column "col_b" added to config');
  });

  it("warns about missing columns", () => {
    const existing: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "old_col", displayName: "Old Col" }),
    ];
    const { config, warnings } = reconcileColumnConfig(existing, ["new_col"]);
    expect(config).toHaveLength(2); // old kept + new appended
    expect(warnings.some((w) => w.includes("Old Col"))).toBe(true);
  });

  it("does not warn about formula-only columns missing from query", () => {
    const existing: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "gone", displayName: "Gone", formula: "=A2*2" }),
    ];
    const { warnings } = reconcileColumnConfig(existing, []);
    expect(warnings.filter((w) => w.includes("Gone"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyColumnConfig
// ---------------------------------------------------------------------------

describe("applyColumnConfig", () => {
  it("maps raw data using display names", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "emp_id", displayName: "Employee ID" }),
    ];
    const rawRows = [{ emp_id: 42 }];
    const { columns, rows } = applyColumnConfig(config, ["emp_id"], rawRows);
    expect(columns).toEqual(["Employee ID"]);
    expect(rows[0]["Employee ID"]).toBe(42);
  });

  it("filters out hidden columns", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: "visible_col", visible: true }),
      makeConfig({ id: "b", sourceColumn: "hidden_col", visible: false }),
    ];
    const { columns } = applyColumnConfig(config, ["visible_col", "hidden_col"], []);
    expect(columns).toHaveLength(1);
  });

  it("uses empty string for formula columns", () => {
    const config: ColumnConfig[] = [
      makeConfig({ id: "a", sourceColumn: null, displayName: "Calc", formula: "=B2*2" }),
    ];
    const { rows } = applyColumnConfig(config, [], [{}]);
    expect(rows[0]["Calc"]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isMissing
// ---------------------------------------------------------------------------

describe("isMissing", () => {
  it("returns true when sourceColumn is not in query columns", () => {
    const entry = makeConfig({ id: "a", sourceColumn: "gone" });
    expect(isMissing(entry, ["other"])).toBe(true);
  });

  it("returns false when sourceColumn is in query columns", () => {
    const entry = makeConfig({ id: "a", sourceColumn: "present" });
    expect(isMissing(entry, ["present"])).toBe(false);
  });

  it("returns false for formula-only columns (null sourceColumn)", () => {
    const entry = makeConfig({ id: "a", sourceColumn: null });
    expect(isMissing(entry, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createFormulaColumn
// ---------------------------------------------------------------------------

describe("createFormulaColumn", () => {
  it("creates a formula column with correct defaults", () => {
    const col = createFormulaColumn("Total", "=D2*1.3");
    expect(col.sourceColumn).toBeNull();
    expect(col.displayName).toBe("Total");
    expect(col.formula).toBe("=D2*1.3");
    expect(col.visible).toBe(true);
    expect(col.width).toBe(DEFAULT_EXCEL_WIDTH);
    expect(col.id).toBeTruthy();
  });
});
