// ─── LLM Provider Abstraction ──────────────────────

export interface LlmProvider {
  name: string;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

export interface LlmChatRequest {
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  responseFormat?: { type: "json_object" };
  maxTokens?: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface LlmProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}
