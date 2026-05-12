import { fetchAntonJson } from "@/lib/anton/client";
import type {
  LlmProvider,
  LlmChatRequest,
  LlmChatResponse,
} from "../types";

const REQUEST_TIMEOUT = 60_000;
const DEFAULT_CHAT_PATH = "/v1/chat/completions";

interface AntonProviderConfig {
  model: string;
  baseUrl?: string;
  chatPath?: string;
}

interface AntonChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
}

export class AntonProvider implements LlmProvider {
  private config: AntonProviderConfig;

  constructor(config: AntonProviderConfig) {
    this.config = config;
  }

  get name(): string {
    return `anton/${this.config.model}`;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
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
      const data = await fetchAntonJson<AntonChatCompletionResponse>(
        this.config.chatPath ?? DEFAULT_CHAT_PATH,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        { baseUrl: this.config.baseUrl }
      );

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Anton returned no content in response");
      }

      return {
        content,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        model: data.model ?? model,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Anton request timed out after ${REQUEST_TIMEOUT}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
