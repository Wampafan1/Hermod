import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Setup ─────────────────────────────────────

const mockResponses = vi.hoisted(() => {
  const responses: string[] = [];
  return {
    queue: responses,
    push: (r: string) => responses.push(r),
    clear: () => (responses.length = 0),
  };
});

vi.mock("@/lib/llm", () => ({
  getLlmProvider: () => ({
    name: "mock",
    chat: vi.fn(async () => {
      const content = mockResponses.queue.shift() ?? "{}";
      return {
        content,
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "mock-model",
      };
    }),
  }),
}));

import { analyzeSheetWithAI } from "@/lib/alfheim/sheet-analyzer";

// ─── Helpers ────────────────────────────────────────

function makeInput(
  rawRows: (string | number | boolean | null)[][],
  filename = "test.csv"
) {
  return {
    rawRows,
    filename,
    totalRows: rawRows.length,
    totalColumns: rawRows[0]?.length ?? 0,
  };
}

function queueResponse(result: Record<string, unknown>) {
  mockResponses.push(JSON.stringify(result));
}

// ─── Tests ──────────────────────────────────────────

describe("analyzeSheetWithAI", () => {
  beforeEach(() => {
    mockResponses.clear();
  });

  it("handles a clean file with headers on row 1", async () => {
    queueResponse({
      hasHeaders: true,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow: null,
      skipRows: [],
      columns: [
        { index: 0, suggestedName: "id", dataType: "INTEGER", nullable: false, shouldInclude: true },
        { index: 1, suggestedName: "name", dataType: "STRING", nullable: false, shouldInclude: true },
        { index: 2, suggestedName: "amount", dataType: "FLOAT", nullable: true, shouldInclude: true },
      ],
      primaryKey: { columns: ["id"], type: "single", confidence: "high", reason: "id is unique" },
      observations: ["Clean file with consistent formatting"],
      confidence: "high",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        ["id", "name", "amount"],
        [1, "Alice", 100.5],
        [2, "Bob", 200.0],
        [3, "Carol", null],
      ])
    );

    expect(result.hasHeaders).toBe(true);
    expect(result.headerRow).toBe(1);
    expect(result.dataStartRow).toBe(2);
    expect(result.columns).toHaveLength(3);
    expect(result.columns[0].dataType).toBe("INTEGER");
    expect(result.primaryKey.columns).toEqual(["id"]);
    expect(result.primaryKey.confidence).toBe("high");
    expect(result.confidence).toBe("high");
  });

  it("handles a messy file with title rows", async () => {
    queueResponse({
      hasHeaders: true,
      headerRow: 4,
      dataStartRow: 5,
      dataEndRow: 8,
      skipRows: [1, 2, 3],
      columns: [
        { index: 0, suggestedName: "employee_id", dataType: "STRING", nullable: false, shouldInclude: true },
        { index: 1, suggestedName: "pay_period", dataType: "STRING", nullable: false, shouldInclude: true },
        { index: 2, suggestedName: "gross_pay", dataType: "FLOAT", nullable: false, shouldInclude: true },
      ],
      primaryKey: {
        columns: ["employee_id", "pay_period"],
        type: "composite",
        confidence: "high",
        reason: "employee_id + pay_period is unique",
      },
      observations: [
        "Rows 1-3 are a report header",
        "Row 4 contains column headers",
      ],
      confidence: "high",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        ["Acme Corp Payroll", null, null],
        ["Q1 2026", null, null],
        [null, null, null],
        ["Employee ID", "Pay Period", "Gross Pay"],
        ["EMP001", "2026-W13", 5000],
      ])
    );

    expect(result.headerRow).toBe(4);
    expect(result.dataStartRow).toBe(5);
    expect(result.skipRows).toEqual([1, 2, 3]);
    expect(result.primaryKey.type).toBe("composite");
    expect(result.primaryKey.columns).toEqual(["employee_id", "pay_period"]);
  });

  it("detects date format ambiguity", async () => {
    queueResponse({
      hasHeaders: true,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow: null,
      skipRows: [],
      columns: [
        {
          index: 0,
          suggestedName: "date",
          dataType: "TIMESTAMP",
          dateFormat: "M/D/YYYY",
          nullable: false,
          shouldInclude: true,
          notes: "Day values are all <= 12 — could be EU format. Defaulting to US.",
        },
      ],
      primaryKey: { columns: ["date"], type: "single", confidence: "low", reason: "date alone may not be unique" },
      observations: ["Ambiguous date format — all day values <= 12"],
      confidence: "medium",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        ["date"],
        ["01/02/2026"],
        ["03/04/2026"],
        ["05/06/2026"],
      ])
    );

    expect(result.columns[0].dateFormat).toBe("M/D/YYYY");
    expect(result.columns[0].notes).toContain("12");
    expect(result.confidence).toBe("medium");
  });

  it("handles no headers", async () => {
    queueResponse({
      hasHeaders: false,
      headerRow: 0,
      dataStartRow: 1,
      dataEndRow: null,
      skipRows: [],
      columns: [
        { index: 0, suggestedName: "column_1", dataType: "INTEGER", nullable: false, shouldInclude: true },
        { index: 1, suggestedName: "column_2", dataType: "STRING", nullable: false, shouldInclude: true },
      ],
      primaryKey: { columns: ["column_1"], type: "single", confidence: "medium", reason: "First column appears unique" },
      observations: ["No header row detected — data starts on row 1"],
      confidence: "medium",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        [1, "foo"],
        [2, "bar"],
        [3, "baz"],
      ])
    );

    expect(result.hasHeaders).toBe(false);
    expect(result.dataStartRow).toBe(1);
  });

  it("marks empty columns as shouldInclude: false", async () => {
    queueResponse({
      hasHeaders: true,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow: null,
      skipRows: [],
      columns: [
        { index: 0, suggestedName: "id", dataType: "INTEGER", nullable: false, shouldInclude: true },
        { index: 1, suggestedName: "empty_col", dataType: "STRING", nullable: true, shouldInclude: false, notes: "Column is entirely empty" },
      ],
      primaryKey: { columns: ["id"], type: "single", confidence: "high", reason: "id is unique" },
      observations: ["Column B is empty"],
      confidence: "high",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        ["id", ""],
        [1, null],
        [2, null],
      ])
    );

    expect(result.columns[1].shouldInclude).toBe(false);
  });

  it("handles composite PK detection", async () => {
    queueResponse({
      hasHeaders: true,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow: null,
      skipRows: [],
      columns: [
        { index: 0, suggestedName: "employee_id", dataType: "STRING", nullable: false, shouldInclude: true },
        { index: 1, suggestedName: "pay_period", dataType: "STRING", nullable: false, shouldInclude: true },
        { index: 2, suggestedName: "amount", dataType: "FLOAT", nullable: false, shouldInclude: true },
      ],
      primaryKey: {
        columns: ["employee_id", "pay_period"],
        type: "composite",
        confidence: "high",
        reason: "employee_id + pay_period is unique across all sample rows",
      },
      observations: [],
      confidence: "high",
    });

    const result = await analyzeSheetWithAI(
      makeInput([
        ["employee_id", "pay_period", "amount"],
        ["E1", "W13", 5000],
        ["E1", "W14", 5100],
        ["E2", "W13", 4800],
      ])
    );

    expect(result.primaryKey.type).toBe("composite");
    expect(result.primaryKey.columns).toEqual(["employee_id", "pay_period"]);
  });

  it("gracefully handles malformed LLM response", async () => {
    queueResponse({ garbage: true }); // Missing required fields

    const result = await analyzeSheetWithAI(
      makeInput([
        ["a", "b"],
        [1, 2],
      ])
    );

    // Should return defaults, not crash
    expect(result.hasHeaders).toBe(true);
    expect(result.headerRow).toBe(1);
    expect(result.columns).toEqual([]);
    expect(result.primaryKey.columns).toEqual([]);
    expect(result.confidence).toBe("medium");
  });

  it("gracefully handles LLM returning invalid JSON", async () => {
    mockResponses.push("this is not json at all");

    await expect(
      analyzeSheetWithAI(makeInput([["a"], [1]]))
    ).rejects.toThrow();
  });
});
