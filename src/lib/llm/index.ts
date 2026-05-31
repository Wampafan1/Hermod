import type { LlmProvider, LlmProviderConfig, LlmChatRequest } from "./types";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { AnthropicProvider } from "./providers/anthropic";
import { AntonProvider } from "./providers/anton";
import { OllamaProvider } from "./providers/ollama";
import { hasAntonConfig } from "@/lib/anton/client";
import {
  resolveOllamaModel,
  resolveOllamaBaseUrl,
  type LlmPurpose,
} from "./model-policy";

// Re-export all types
export type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
  LlmMessage,
  LlmProviderConfig,
} from "./types";
export type { LlmPurpose } from "./model-policy";
export { resolveOllamaModel, resolveOllamaBaseUrl } from "./model-policy";

// ─── Factory ────────────────────────────────────────

export function getLlmProvider(config?: Partial<LlmProviderConfig>): LlmProvider {
  const provider =
    config?.provider ??
    process.env.LLM_PROVIDER ??
    (hasAntonConfig() ? "anton" : undefined);

  if (!provider) {
    throw new Error(
      "LLM provider is required. Set LLM_PROVIDER env var or pass config.provider"
    );
  }

  // ── Local providers ──
  // Ollama and Anton are LOCAL and must NEVER inherit a cloud model name.
  // LLM_MODEL is reserved for cloud (anthropic / openai-compatible) only.
  if (provider === "ollama") {
    return new OllamaProvider({
      model: config?.model ?? resolveOllamaModel("fast"),
      baseUrl: config?.baseUrl ?? resolveOllamaBaseUrl(),
    });
  }

  if (provider === "anton") {
    const model = config?.model ?? process.env.ANTON_MODEL ?? "anton";
    const baseUrl =
      config?.baseUrl ??
      process.env.ANTON_API_BASE_URL ??
      process.env.LLM_BASE_URL;
    return new AntonProvider({ model, baseUrl });
  }

  // ── Cloud providers ──  LLM_MODEL applies here only.
  const model = config?.model ?? process.env.LLM_MODEL;
  if (!model) {
    throw new Error(
      "LLM model is required. Set LLM_MODEL env var or pass config.model"
    );
  }
  const apiKey = config?.apiKey ?? process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLM API key is required. Set LLM_API_KEY env var or pass config.apiKey"
    );
  }
  const baseUrl = config?.baseUrl ?? process.env.LLM_BASE_URL;

  if (provider === "anthropic") {
    return new AnthropicProvider({ model, apiKey, baseUrl });
  }

  return new OpenAICompatibleProvider({ provider, model, apiKey, baseUrl });
}

// ─── Machinery entry point ──────────────────────────
//
// Single entry point for Hermod's INTERNAL, non-user-facing AI calls
// ("the machinery": structured JSON extraction consumed by code). It ALWAYS
// runs against the local Ollama GPU as primary — that satisfies the "has to be
// local" requirement. Anthropic is a best-effort CLOUD fallback used only when
// the local call throws AND ANTHROPIC_API_KEY is set. Anton is never on this
// path (Anton's RAG pipeline is wrong for structured extraction).
export async function runMachineInference(
  request: LlmChatRequest,
  opts: { purpose: LlmPurpose; config?: Partial<LlmProviderConfig> } = {
    purpose: "fast",
  }
): Promise<{ content: string; model: string; provider: string }> {
  const purpose = opts.purpose ?? "fast";
  const ollama = new OllamaProvider({
    model: opts.config?.model ?? resolveOllamaModel(purpose),
    baseUrl: opts.config?.baseUrl ?? resolveOllamaBaseUrl(),
  });

  try {
    const res = await ollama.chat(request);
    return { content: res.content, model: res.model, provider: "ollama" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      // No cloud fallback configured — local is required, so surface the error.
      throw err;
    }
    console.warn(
      `[LLM] Ollama machinery call failed, falling back to Anthropic: ${msg}`
    );
    const anthropic = new AnthropicProvider({
      model: process.env.LLM_MODEL?.trim() || "claude-sonnet-4-6",
      apiKey,
    });
    const res = await anthropic.chat(request);
    return { content: res.content, model: res.model, provider: "anthropic" };
  }
}
