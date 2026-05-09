import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunAI } = vi.hoisted(() => ({
  mockRunAI: vi.fn(),
}));

vi.mock("@/lib/ai/router", () => ({
  runAI: mockRunAI,
}));

const candidateKeys = [
  {
    columns: ["customer_id"],
    unique: true,
    nullCount: 0,
    duplicateCount: 0,
    coverage: 1,
    width: 1,
    score: 1005,
  },
  {
    columns: ["customer_id", "line_number"],
    unique: true,
    nullCount: 0,
    duplicateCount: 0,
    coverage: 1,
    width: 2,
    score: 910,
  },
];

const validationStats = {
  rowCount: 10,
  columnsAnalyzed: 2,
  combinationsTested: 3,
  maxWidth: 4,
  maxCombinations: 25_000,
  truncated: false,
  destinationValidated: false,
  destinationValidationMode: "UPLOAD_ONLY" as const,
};

const currentKeyFailure = {
  oldKey: ["customer_id"],
  reason: "Current UPSERT key has duplicate values in this upload.",
  duplicateExampleCount: 1,
  nullKeyExampleCount: 0,
};

describe("Gate key recommendation AI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not allow AI to recommend a candidate outside the verified list", async () => {
    mockRunAI.mockResolvedValue({
      content: JSON.stringify({
        columns: ["invented_key"],
        explanation: "Use the invented key.",
      }),
      model: "test",
      provider: "ollama",
      durationMs: 1,
    });

    const { recommendGateKey } = await import("@/lib/gates/key-recommendation-ai");
    const result = await recommendGateKey({
      candidateKeys,
      validationStats,
      currentKeyFailure,
      useAi: true,
    });

    expect(result.aiUsed).toBe(false);
    expect(result.recommendation?.columns).toEqual(["customer_id"]);
    expect(result.aiExplanation).toContain("outside the verified set");
  });

  it("falls back to deterministic ranking when AI fails", async () => {
    mockRunAI.mockRejectedValue(new Error("offline"));

    const { recommendGateKey } = await import("@/lib/gates/key-recommendation-ai");
    const result = await recommendGateKey({
      candidateKeys,
      validationStats,
      currentKeyFailure,
      useAi: true,
    });

    expect(result.aiUsed).toBe(false);
    expect(result.recommendation?.source).toBe("DETERMINISTIC");
    expect(result.recommendation?.columns).toEqual(["customer_id"]);
    expect(result.aiExplanation).toContain("deterministic ranking");
  });

  it("builds an AI prompt without full row payloads", async () => {
    const { buildKeyRecommendationPrompt } = await import("@/lib/gates/key-recommendation-ai");
    const prompt = buildKeyRecommendationPrompt({
      candidateKeys,
      validationStats,
      currentKeyFailure,
      useAi: true,
    });

    expect(prompt).toContain("verifiedCandidates");
    expect(prompt).toContain("customer_id");
    expect(prompt).not.toContain("secret@example.com");
    expect(prompt).not.toContain("fullRows");
    expect(prompt).not.toContain("rowPayload");
  });
});
