import type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
} from "../types";

// ─── Base URLs ─────────────────────────────────────

const BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

const REQUEST_TIMEOUT = 60_000;

// ─── OpenAI-Compatible Provider ────────────────────

interface OpenAICompatibleConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export class OpenAICompatibleProvider implements LlmProvider {
  private config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
  }

  get name(): string {
    return `${this.config.provider}/${this.config.model}`;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const baseUrl =
      this.config.baseUrl ??
      BASE_URLS[this.config.provider] ??
      BASE_URLS.openai;
    const url = `${baseUrl}/chat/completions`;

    const model = request.model ?? this.config.model;
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.responseFormat) {
      body.response_format = { type: request.responseFormat.type };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `${this.config.provider} API error (${response.status}): ${errorBody}`
        );
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice?.message?.content) {
        throw new Error(
          `${this.config.provider} returned no content in response`
        );
      }

      return {
        content: choice.message.content,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        model: data.model ?? model,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `${this.config.provider} request timed out after ${REQUEST_TIMEOUT}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
