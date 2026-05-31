import { runMachineInference } from "@/lib/llm";
import {
  buildKeyDriftRecommendation,
  type CandidateKey,
  type KeyDiscoveryStats,
  type KeyRecommendation,
} from "./key-discovery";

export interface KeyRecommendationAiInput {
  candidateKeys: CandidateKey[];
  validationStats: KeyDiscoveryStats;
  currentKeyFailure: {
    oldKey: string[];
    reason: string;
    duplicateExampleCount: number;
    nullKeyExampleCount: number;
  };
  useAi?: boolean;
}

export interface KeyRecommendationAiResult {
  recommendation: KeyRecommendation | null;
  aiUsed: boolean;
  aiExplanation: string | null;
}

export async function recommendGateKey(input: KeyRecommendationAiInput): Promise<KeyRecommendationAiResult> {
  const deterministic = buildKeyDriftRecommendation({
    candidateKeys: input.candidateKeys,
    validationStats: input.validationStats,
  }).recommendation;

  if (!input.useAi || input.candidateKeys.length === 0) {
    return {
      recommendation: deterministic,
      aiUsed: false,
      aiExplanation: null,
    };
  }

  try {
    const prompt = buildKeyRecommendationPrompt(input);
    const response = await runMachineInference({
      messages: [
        {
          role: "system",
          content:
            "You rank only statistically verified database key candidates. You must not invent columns or candidates.",
        },
        { role: "user", content: prompt },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0,
    }, { purpose: "smart" });

    const parsed = parseRecommendationResponse(response.content);
    const selected = findVerifiedCandidate(input.candidateKeys, parsed.columns);
    if (!selected) {
      return {
        recommendation: deterministic,
        aiUsed: false,
        aiExplanation: "AI recommended a candidate outside the verified set, so deterministic ranking was used.",
      };
    }

    return {
      recommendation: {
        columns: selected.columns,
        score: selected.score,
        source: "AI",
        reason: parsed.explanation || "AI selected this verified candidate from the provided candidate set.",
      },
      aiUsed: true,
      aiExplanation: parsed.explanation || null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      recommendation: deterministic,
      aiUsed: false,
      aiExplanation: `AI recommendation unavailable; deterministic ranking was used. ${message}`,
    };
  }
}

export function buildKeyRecommendationPrompt(input: KeyRecommendationAiInput): string {
  const payload = {
    instruction:
      "Choose the best key from verifiedCandidates only. Return JSON: { \"columns\": string[], \"explanation\": string }.",
    currentKeyFailure: input.currentKeyFailure,
    validationScope: {
      destinationValidated: input.validationStats.destinationValidated,
      mode: input.validationStats.destinationValidationMode,
      rowCount: input.validationStats.rowCount,
    },
    verifiedCandidates: input.candidateKeys.map((candidate) => ({
      columns: candidate.columns,
      width: candidate.width,
      nullCount: candidate.nullCount,
      duplicateCount: candidate.duplicateCount,
      coverage: candidate.coverage,
      score: candidate.score,
    })),
  };

  return JSON.stringify(payload);
}

function parseRecommendationResponse(content: string): { columns: string[]; explanation: string } {
  const parsed = JSON.parse(content) as { columns?: unknown; explanation?: unknown };
  const columns = Array.isArray(parsed.columns)
    ? parsed.columns.filter((column): column is string => typeof column === "string")
    : [];
  return {
    columns,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
  };
}

function findVerifiedCandidate(candidates: CandidateKey[], columns: string[]): CandidateKey | null {
  const signature = keySignature(columns);
  return candidates.find((candidate) => keySignature(candidate.columns) === signature) ?? null;
}

function keySignature(columns: string[]): string {
  return [...columns].map((column) => column.toLowerCase()).sort().join("\u0000");
}
