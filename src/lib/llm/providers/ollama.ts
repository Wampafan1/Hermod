import type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
  LlmMessage,
} from "../types";

// ─── Ollama Provider (raw local GPU model server) ──────────
//
// Talks to Ollama's native /api/chat endpoint. Ported from the original
// lib/ai/router.ts `callOllama`, whose behavior is correct for deterministic,
// structured-JSON extraction:
//   - think:false      — models default thinking mode ON and otherwise burn
//                        tokens on internal reasoning, returning empty content.
//   - num_predict:-1   — no output cap; let the model run to completion.
//   - format:"json"    — for JSON requests, plus a JSON instruction appended to
//                        the last message (mirrors the router's prepareMessages).
// No timeout by default: local models can legitimately run long.

const DEFAULT_BASE_URL = "http://192.168.1.181:11434";

const JSON_INSTRUCTION =
  "\n\nRespond with ONLY valid JSON. No markdown, no backticks, no explanation.";

interface OllamaConfig {
  model: string;
  baseUrl?: string;
}

export class OllamaProvider implements LlmProvider {
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  get name(): string {
    return `ollama/${this.config.model}`;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const model = request.model ?? this.config.model;
    const wantsJson = request.responseFormat?.type === "json_object";

    // Mirror prepareMessages: append the JSON instruction to the last message.
    const messages: LlmMessage[] = [...request.messages];
    if (wantsJson && messages.length > 0) {
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = {
        ...last,
        content: last.content + JSON_INSTRUCTION,
      };
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      think: false,
      options: {
        temperature: request.temperature ?? 0,
        num_predict: -1,
      },
    };
    if (wantsJson) {
      body.format = "json";
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.message?.content ?? "";
    if (!content) {
      throw new Error("Ollama returned no content in response");
    }

    return {
      content,
      usage: { inputTokens: 0, outputTokens: 0 },
      model,
    };
  }
}
