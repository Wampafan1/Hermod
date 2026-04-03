import type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
} from "../types";

// ─── Anthropic Messages API Provider ───────────────

const BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";
const REQUEST_TIMEOUT = 60_000;

interface AnthropicConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export class AnthropicProvider implements LlmProvider {
  private config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = config;
  }

  get name(): string {
    return `anthropic/${this.config.model}`;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    // Ensure baseUrl includes /v1 path — users may provide just the domain
    let baseUrl = this.config.baseUrl ?? BASE_URL;
    if (baseUrl && !baseUrl.endsWith("/v1")) {
      baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
    }
    const url = `${baseUrl}/messages`;

    // Extract system message from messages array
    let systemPrompt: string | undefined;
    const messages = request.messages.filter((m) => {
      if (m.role === "system") {
        systemPrompt = m.content;
        return false;
      }
      return true;
    });

    // If JSON response format is requested, append instruction to system prompt
    if (request.responseFormat?.type === "json_object") {
      const jsonInstruction =
        "You must respond with valid JSON only. No markdown, no explanation, just raw JSON.";
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n${jsonInstruction}`
        : jsonInstruction;
    }

    const model = request.model ?? this.config.model;
    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Anthropic API error (${response.status}): ${errorBody}`
        );
      }

      const data = await response.json();
      const textBlock = data.content?.find(
        (block: { type: string }) => block.type === "text"
      );
      if (!textBlock?.text) {
        throw new Error("Anthropic returned no text content in response");
      }

      return {
        content: textBlock.text,
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
        model: data.model ?? model,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `Anthropic request timed out after ${REQUEST_TIMEOUT}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
