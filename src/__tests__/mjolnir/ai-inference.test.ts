import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmProvider, LlmChatRequest, LlmChatResponse } from "@/lib/llm/types";
import type {
  AmbiguousCase,
  ForgeStep,
  ParsedFileData,
  StructuralDiffResult,
} from "@/lib/mjolnir/types";
import { fingerprintAllColumns } from "@/lib/mjolnir/engine/fingerprint";

// ─── Mock LLM Provider ──────────────────────────────

const mockChatResponses = vi.hoisted(() => {
  return {
    responses: [] as LlmChatResponse[],
    callIndex: 0,
    calls: [] as LlmChatRequest[],
  };
});

function createMockProvider(): LlmProvider {
  return {
    name: "mock",
    chat: vi.fn(async (request: LlmChatRequest): Promise<LlmChatResponse> => {
      mockChatResponses.calls.push(request);
      const idx = mockChatResponses.callIndex++;
      if (idx < mockChatResponses.responses.length) {
        return mockChatResponses.responses[idx];
      }
      throw new Error("No mock response configured for call index " + idx);
    }),
  };
}

function setMockResponses(...responses: LlmChatResponse[]) {
  mockChatResponses.responses = responses;
  mockChatResponses.callIndex = 0;
  mockChatResponses.calls = [];
}

function makeMockResponse(content: string): LlmChatResponse {
  return {
    content,
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "mock-model",
  };
}

// ─── Test Helpers ────────────────────────────────────

function makeParsedFile(
  columns: string[],
  rows: Record<string, unknown>[],
  fileId = "test-file",
  filename = "test.xlsx"
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

function makeDiff(overrides: Partial<StructuralDiffResult> = {}): StructuralDiffResult {
  return {
    matchedColumns: [],
    removedColumns: [],
    addedColumns: [],
    beforeRowCount: 10,
    afterRowCount: 10,
    removedRowCount: 0,
    formatChanges: [],
    reorderDetected: false,
    deterministicSteps: [],
    ambiguousCases: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────

describe("ai-inference", () => {
  let mockProvider: LlmProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    mockChatResponses.responses = [];
    mockChatResponses.callIndex = 0;
    mockChatResponses.calls = [];
  });

  it("returns empty array when no ambiguous cases", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const diff = makeDiff({ ambiguousCases: [] });
    const before = makeParsedFile(["A"], [{ A: 1 }]);
    const after = makeParsedFile(["A"], [{ A: 1 }]);

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    expect(result.steps).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  it("calls LLM with formula inference prompt for new_column cases", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["Price", "Quantity"],
      [
        { Price: 10, Quantity: 5 },
        { Price: 20, Quantity: 3 },
      ]
    );
    const after = makeParsedFile(
      ["Price", "Quantity", "Total"],
      [
        { Price: 10, Quantity: 5, Total: 50 },
        { Price: 20, Quantity: 3, Total: 60 },
      ]
    );

    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "Price", afterColumn: "Price", matchType: "exact", confidence: 1.0 },
        { beforeColumn: "Quantity", afterColumn: "Quantity", matchType: "exact", confidence: 1.0 },
      ],
      addedColumns: ["Total"],
      ambiguousCases: [
        {
          type: "new_column",
          description: 'Column "Total" exists in AFTER but not in BEFORE',
          context: { column: "Total" },
        },
      ],
    });

    setMockResponses(
      makeMockResponse(
        JSON.stringify({
          formula: "{Price} * {Quantity}",
          confidence: 0.95,
          explanation: "Total = Price * Quantity",
        })
      )
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    // Verify the system message contains the infer-formula prompt content
    const call = mockChatResponses.calls[0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("formula reverse-engineering");
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toContain("Total");

    // Verify the returned step — Issue #4: uses "column" not "outputColumn"
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe("calculate");
    expect(result.steps[0].confidence).toBe(0.95);
    expect(result.steps[0].config.column).toBe("Total");
    expect(result.steps[0].config.formula).toBe("{Price} * {Quantity}");
    expect(result.steps[0].config.sourceColumns).toEqual(["Price", "Quantity"]);
  });

  it("calls LLM with filter detection prompt for removed_rows cases", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["Name", "Status"],
      [
        { Name: "Alice", Status: "Active" },
        { Name: "Bob", Status: "Inactive" },
        { Name: "Carol", Status: "Active" },
      ]
    );
    const after = makeParsedFile(
      ["Name", "Status"],
      [
        { Name: "Alice", Status: "Active" },
        { Name: "Carol", Status: "Active" },
      ]
    );

    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "Name", afterColumn: "Name", matchType: "exact", confidence: 1.0 },
        { beforeColumn: "Status", afterColumn: "Status", matchType: "exact", confidence: 1.0 },
      ],
      beforeRowCount: 3,
      afterRowCount: 2,
      removedRowCount: 1,
      ambiguousCases: [
        {
          type: "removed_rows",
          description: "1 row(s) were removed",
          context: { beforeRowCount: 3, afterRowCount: 2, removedCount: 1 },
        },
      ],
    });

    setMockResponses(
      makeMockResponse(
        JSON.stringify({
          column: "Status",
          operator: "neq",
          value: "Active",
          confidence: 0.92,
          description: "Removed rows where Status is not Active",
        })
      )
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    const call = mockChatResponses.calls[0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("data filtering analyst");
    expect(call.messages[1].content).toContain("removedRows");

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe("filter_rows");
    expect(result.steps[0].confidence).toBe(0.92);
    expect(result.steps[0].config.column).toBe("Status");
    expect(result.steps[0].config.operator).toBe("neq");
  });

  it("calls LLM with classify prompt for uncertain_match cases", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["cust_id", "revenue"],
      [{ cust_id: 1, revenue: 100 }]
    );
    const after = makeParsedFile(
      ["Customer ID", "revenue"],
      [{ "Customer ID": 1, revenue: 100 }]
    );

    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "revenue", afterColumn: "revenue", matchType: "exact", confidence: 1.0 },
      ],
      ambiguousCases: [
        {
          type: "uncertain_match",
          description: 'Column match "cust_id" -> "Customer ID" has low confidence',
          context: {
            beforeColumn: "cust_id",
            afterColumn: "Customer ID",
            matchType: "fingerprint",
            confidence: 0.6,
          },
        },
      ],
    });

    setMockResponses(
      makeMockResponse(
        JSON.stringify([
          {
            type: "rename_columns",
            confidence: 0.85,
            config: { renames: { cust_id: "Customer ID" } },
            description: "Rename cust_id to Customer ID",
            reasoning: "Same data, different name",
          },
        ])
      )
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    const call = mockChatResponses.calls[0];
    expect(call.messages[0].content).toContain("data transformation classifier");
    expect(call.messages[1].content).toContain("ambiguousCases");

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe("rename_columns");
    expect(result.steps[0].confidence).toBe(0.85);
  });

  it("parses JSON response into ForgeStep objects correctly", async () => {
    const { parseStepsFromResponse } = await import("@/lib/mjolnir/engine/ai-inference");

    const response = JSON.stringify([
      {
        order: 99,
        type: "calculate",
        confidence: 0.88,
        config: { column: "Margin", formula: "{Revenue} - {Cost}", sourceColumns: ["Revenue", "Cost"] },
        description: "Calculate Margin",
      },
      {
        order: 100,
        type: "rename_columns",
        confidence: 0.75,
        config: { mapping: { old_name: "New Name" } },
        description: "Rename old_name",
      },
    ]);

    const steps = parseStepsFromResponse(response, 5);

    expect(steps).toHaveLength(2);
    // Orders should be renumbered starting from 5
    expect(steps[0].order).toBe(5);
    expect(steps[1].order).toBe(6);
    expect(steps[0].type).toBe("calculate");
    expect(steps[0].confidence).toBe(0.88);
    expect(steps[1].type).toBe("rename_columns");
  });

  it("parseStepsFromResponse handles non-greedy regex (Issue #11)", async () => {
    const { parseStepsFromResponse } = await import("@/lib/mjolnir/engine/ai-inference");

    // LLM response with explanation text around the JSON
    const response = `Here is my analysis of the data:

[{"type": "calculate", "confidence": 0.9, "config": {"column": "Total", "formula": "{A} + {B}"}, "description": "Sum A and B"}]

The above step calculates the total [as requested].`;

    const steps = parseStepsFromResponse(response, 0);
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("calculate");
    expect(steps[0].config.column).toBe("Total");
  });

  it("handles LLM error gracefully (returns empty array, does not throw)", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const errorProvider: LlmProvider = {
      name: "error-provider",
      chat: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
    };

    const before = makeParsedFile(["A"], [{ A: 1 }]);
    const after = makeParsedFile(["A", "B"], [{ A: 1, B: 2 }]);

    const diff = makeDiff({
      ambiguousCases: [
        {
          type: "new_column",
          description: "Column B is new",
          context: { column: "B" },
        },
      ],
    });

    // Suppress console.warn during test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runAiInference(diff, before, after, undefined, errorProvider);

    expect(result.steps).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("API rate limit exceeded");
    expect(errorProvider.chat).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles invalid JSON response from LLM gracefully", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(["A"], [{ A: 1 }]);
    const after = makeParsedFile(["A", "B"], [{ A: 1, B: 2 }]);

    const diff = makeDiff({
      ambiguousCases: [
        {
          type: "new_column",
          description: "Column B is new",
          context: { column: "B" },
        },
      ],
    });

    setMockResponses(
      makeMockResponse("This is not valid JSON at all, sorry I cannot help")
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    // Should return empty steps (invalid JSON parsed as no steps)
    expect(result.steps).toEqual([]);
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
  });

  it("uses injected provider instead of default", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const customProvider: LlmProvider = {
      name: "custom-provider",
      chat: vi.fn().mockResolvedValue(
        makeMockResponse(
          JSON.stringify({
            formula: "{A} + 1",
            confidence: 0.8,
            explanation: "B equals A plus 1",
          })
        )
      ),
    };

    const before = makeParsedFile(["A"], [{ A: 1 }, { A: 2 }]);
    const after = makeParsedFile(["A", "B"], [{ A: 1, B: 2 }, { A: 2, B: 3 }]);

    const diff = makeDiff({
      ambiguousCases: [
        {
          type: "new_column",
          description: "Column B is new",
          context: { column: "B" },
        },
      ],
    });

    const result = await runAiInference(diff, before, after, undefined, customProvider);

    expect(customProvider.chat).toHaveBeenCalledTimes(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe("calculate");
    expect(result.steps[0].config.formula).toBe("{A} + 1");
  });

  it("does not hardcode a model — uses provider's configured model", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(["A"], [{ A: 1 }]);
    const after = makeParsedFile(["A", "B"], [{ A: 1, B: 2 }]);

    const diff = makeDiff({
      ambiguousCases: [
        {
          type: "new_column",
          description: "Column B is new",
          context: { column: "B" },
        },
      ],
    });

    setMockResponses(
      makeMockResponse(
        JSON.stringify({
          formula: "{A} + 1",
          confidence: 0.8,
          explanation: "B equals A plus 1",
        })
      )
    );

    await runAiInference(diff, before, after, undefined, mockProvider);

    // The chat request should NOT contain model: "gpt-4o" or any hardcoded model
    const call = mockChatResponses.calls[0];
    expect(call.model).toBeUndefined();
  });

  it("normalizes config keys: renames → mapping via step-validator (Issue #13/19)", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["cust_id", "revenue"],
      [{ cust_id: 1, revenue: 100 }]
    );
    const after = makeParsedFile(
      ["Customer ID", "revenue"],
      [{ "Customer ID": 1, revenue: 100 }]
    );

    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "revenue", afterColumn: "revenue", matchType: "exact", confidence: 1.0 },
      ],
      ambiguousCases: [
        {
          type: "uncertain_match",
          description: 'Column match uncertain',
          context: { beforeColumn: "cust_id", afterColumn: "Customer ID" },
        },
      ],
    });

    // AI returns "renames" instead of "mapping" — validator should normalize
    setMockResponses(
      makeMockResponse(
        JSON.stringify([
          {
            type: "rename_columns",
            confidence: 0.85,
            config: { renames: { cust_id: "Customer ID" } },
            description: "Rename cust_id",
          },
        ])
      )
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    expect(result.steps).toHaveLength(1);
    // Step validator should have normalized "renames" → "mapping"
    expect(result.steps[0].config.mapping).toBeDefined();
    expect(result.steps[0].config.renames).toBeUndefined();
  });

  it("caps AI calls at MAX_AI_CALLS (Issue #17)", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(["A"], [{ A: 1 }]);
    const after = makeParsedFile(
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
      [{ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12 }]
    );

    // 11 new columns > BULK_ANALYSIS_THRESHOLD → uses bulk analysis (1 call)
    // plus removed_rows if applicable. Should not exceed MAX_AI_CALLS.
    const ambiguousCases = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map(
      (col) => ({
        type: "new_column" as const,
        description: `Column ${col} is new`,
        context: { column: col },
      })
    );

    const diff = makeDiff({ ambiguousCases });

    // Set up enough responses for potential calls
    const responses = Array.from({ length: 15 }, () =>
      makeMockResponse(JSON.stringify([]))
    );
    setMockResponses(...responses);

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    // With >3 new columns, should use bulk analysis (1 call) instead of 11 individual calls
    expect(mockChatResponses.callIndex).toBeLessThanOrEqual(10);
    // No errors expected
    expect(result.warnings.every((w) => !w.includes("failed"))).toBe(true);
  });

  it("deduplicates: deterministic formula wins over AI calculate step for same column", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["A", "B"],
      [
        { A: 10, B: 20 },
        { A: 30, B: 40 },
      ]
    );
    const after = makeParsedFile(
      ["A", "B", "Total", "C1", "C2", "C3", "C4"],
      [
        { A: 10, B: 20, Total: 30, C1: 1, C2: 2, C3: 3, C4: 4 },
        { A: 30, B: 40, Total: 70, C1: 5, C2: 6, C3: 7, C4: 8 },
      ]
    );
    // Simulate detected formulas for "Total" column
    after.formulas = [
      {
        column: "Total",
        formula: "=A2+B2",
        expression: "{A}+{B}",
        referencedColumns: ["A", "B"],
      },
    ];

    // 5 new columns: Total (has formula) + C1-C4 (no formula) → 4 unresolved > BULK_THRESHOLD(3)
    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "A", afterColumn: "A", matchType: "exact", confidence: 1.0 },
        { beforeColumn: "B", afterColumn: "B", matchType: "exact", confidence: 1.0 },
      ],
      addedColumns: ["Total", "C1", "C2", "C3", "C4"],
      ambiguousCases: [
        { type: "new_column", description: "Total is new", context: { column: "Total" } },
        { type: "new_column", description: "C1 is new", context: { column: "C1" } },
        { type: "new_column", description: "C2 is new", context: { column: "C2" } },
        { type: "new_column", description: "C3 is new", context: { column: "C3" } },
        { type: "new_column", description: "C4 is new", context: { column: "C4" } },
      ],
    });

    // AI bulk response returns calculate steps for ALL columns, including Total
    // which already has a deterministic formula step — this simulates the duplicate bug
    setMockResponses(
      makeMockResponse(
        JSON.stringify([
          {
            type: "calculate",
            confidence: 0.85,
            config: { column: "Total", formula: "{A} + {B}" },
            description: "AI-inferred Total",
          },
          {
            type: "calculate",
            confidence: 0.80,
            config: { column: "C1", formula: "{A} * 0.1" },
            description: "AI-inferred C1",
          },
          {
            type: "calculate",
            confidence: 0.80,
            config: { column: "C2", formula: "{A} * 0.2" },
            description: "AI-inferred C2",
          },
          {
            type: "calculate",
            confidence: 0.80,
            config: { column: "C3", formula: "{A} * 0.3" },
            description: "AI-inferred C3",
          },
          {
            type: "calculate",
            confidence: 0.80,
            config: { column: "C4", formula: "{A} * 0.4" },
            description: "AI-inferred C4",
          },
        ])
      )
    );

    const result = await runAiInference(diff, before, after, undefined, mockProvider);

    // Should have exactly 5 calculate steps, NOT 6 (no duplicate for Total)
    const calcSteps = result.steps.filter((s) => s.type === "calculate");
    expect(calcSteps).toHaveLength(5);

    // The Total step should be the deterministic one (confidence 0.9, from detected formula)
    const totalStep = calcSteps.find((s) => s.config.column === "Total");
    expect(totalStep).toBeDefined();
    expect(totalStep!.confidence).toBe(0.9);
    expect(totalStep!.config.formula).toBe("{A}+{B}");
    expect(totalStep!.description).toContain("detected formula");

    // The C1 step should be the AI one
    const c1Step = calcSteps.find((s) => s.config.column === "C1");
    expect(c1Step).toBeDefined();
    expect(c1Step!.confidence).toBe(0.80);
  });

  it("includes user description in context when provided", async () => {
    const { runAiInference } = await import("@/lib/mjolnir/engine/ai-inference");

    const before = makeParsedFile(
      ["Price", "Tax"],
      [{ Price: 100, Tax: 10 }]
    );
    const after = makeParsedFile(
      ["Price", "Tax", "Total"],
      [{ Price: 100, Tax: 10, Total: 110 }]
    );

    const diff = makeDiff({
      matchedColumns: [
        { beforeColumn: "Price", afterColumn: "Price", matchType: "exact", confidence: 1.0 },
        { beforeColumn: "Tax", afterColumn: "Tax", matchType: "exact", confidence: 1.0 },
      ],
      addedColumns: ["Total"],
      ambiguousCases: [
        {
          type: "new_column",
          description: 'Column "Total" is new',
          context: { column: "Total" },
        },
      ],
    });

    setMockResponses(
      makeMockResponse(
        JSON.stringify({
          formula: "{Price} + {Tax}",
          confidence: 0.95,
          explanation: "Total = Price + Tax",
        })
      )
    );

    const userDescription = "I added Price and Tax together to get the Total";
    await runAiInference(diff, before, after, userDescription, mockProvider);

    // Verify user description is included in the context sent to LLM
    const call = mockChatResponses.calls[0];
    expect(call.messages[1].content).toContain(userDescription);
  });
});
