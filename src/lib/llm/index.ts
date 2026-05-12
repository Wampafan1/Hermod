import type { LlmProvider, LlmProviderConfig } from "./types";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { AnthropicProvider } from "./providers/anthropic";
import { AntonProvider } from "./providers/anton";
import { hasAntonConfig } from "@/lib/anton/client";

// Re-export all types
export type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
  LlmMessage,
  LlmProviderConfig,
} from "./types";

// ─── Factory ────────────────────────────────────────

export function getLlmProvider(config?: Partial<LlmProviderConfig>): LlmProvider {
  const provider =
    config?.provider ??
    process.env.LLM_PROVIDER ??
    (hasAntonConfig() ? "anton" : undefined);
  const model =
    config?.model ??
    process.env.LLM_MODEL ??
    (provider === "anton" ? process.env.ANTON_MODEL ?? "anton" : undefined);
  const apiKey = config?.apiKey ?? process.env.LLM_API_KEY;
  const baseUrl =
    config?.baseUrl ??
    (provider === "anton"
      ? process.env.ANTON_API_BASE_URL ?? process.env.LLM_BASE_URL
      : process.env.LLM_BASE_URL) ??
    undefined;

  if (!provider) {
    throw new Error(
      "LLM provider is required. Set LLM_PROVIDER env var or pass config.provider"
    );
  }
  if (!model) {
    throw new Error(
      "LLM model is required. Set LLM_MODEL env var or pass config.model"
    );
  }

  if (provider === "anton") {
    return new AntonProvider({ model, baseUrl });
  }

  if (!apiKey) {
    throw new Error(
      "LLM API key is required. Set LLM_API_KEY env var or pass config.apiKey"
    );
  }

  if (provider === "anthropic") {
    return new AnthropicProvider({ model, apiKey, baseUrl });
  }

  return new OpenAICompatibleProvider({ provider, model, apiKey, baseUrl });
}
