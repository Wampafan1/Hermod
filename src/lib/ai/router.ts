/**
 * AI Router — Hermod AI inference layer.
 *
 * Primary when configured: Anton tenant AI.
 * Fallback when Anton is not configured: local Ollama GPU, then Anthropic API.
 *
 * CRITICAL: Always set `think: false` for structured/deterministic tasks.
 * Models have thinking mode enabled by default — without this flag they
 * burn tokens on internal reasoning and return empty content.
 */

import { fetchAntonJson, hasAntonConfig } from "@/lib/anton/client";

export interface AIRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  thinking?: boolean; // default false
  temperature?: number; // default 0
  responseFormat?: "text" | "json";
  timeout?: number; // ms override
}

export interface AIResponse {
  content: string;
  thinking?: string;
  model: string;
  provider: "anton" | "ollama" | "anthropic";
  durationMs: number;
}

// ─── Config ─────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.1.181:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b";
const OLLAMA_TIMEOUT = 0; // 0 = no timeout (model runs to completion)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_TIMEOUT = 60_000;

const ANTON_TIMEOUT = 60_000;

interface AntonChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  model?: string;
}

function shouldUseAnton(): boolean {
  return (
    hasAntonConfig() ||
    process.env.LLM_PROVIDER === "anton" ||
    Boolean(process.env.ANTON_API_KEY || process.env.ANTON_API_BASE_URL)
  );
}

function getAntonModel(): string {
  return process.env.ANTON_MODEL || process.env.LLM_MODEL || OLLAMA_MODEL;
}

// ─── Anton ─────────────────────────────────────────

async function callAnton(request: AIRequest): Promise<AIResponse> {
  const timeout = request.timeout ?? ANTON_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const start = Date.now();
  const model = getAntonModel();
  const messages = prepareMessages(request);

  try {
    const data = await fetchAntonJson<AntonChatCompletionResponse>(
      "/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0,
          response_format:
            request.responseFormat === "json"
              ? { type: "json_object" }
              : undefined,
        }),
      }
    );

    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("Anton returned no content in response");
    }

    return {
      content,
      model: data.model ?? model,
      provider: "anton",
      durationMs: Date.now() - start,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Anton request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ollama ─────────────────────────────────────────

async function callOllama(request: AIRequest): Promise<AIResponse> {
  const timeout = request.timeout ?? OLLAMA_TIMEOUT;
  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  const start = Date.now();

  // Append JSON instruction to last user message if needed
  const messages = prepareMessages(request);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: timeout > 0 ? controller.signal : undefined,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        think: request.thinking ?? false,
        options: {
          temperature: request.temperature ?? 0,
          num_predict: -1,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.message?.content ?? "";
    const thinking = data.message?.thinking ?? undefined;

    return {
      content,
      thinking,
      model: OLLAMA_MODEL,
      provider: "ollama",
      durationMs: Date.now() - start,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Anthropic ──────────────────────────────────────

async function callAnthropic(request: AIRequest): Promise<AIResponse> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot use Anthropic fallback");
  }

  const timeout = request.timeout ?? ANTHROPIC_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const start = Date.now();

  // Append JSON instruction to last user message if needed
  const messages = prepareMessages(request);

  // Map to Anthropic format — extract system message
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt = msg.content;
    } else {
      anthropicMessages.push({ role: msg.role, content: msg.content });
    }
  }

  try {
    const body: Record<string, unknown> = {
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: anthropicMessages,
      temperature: request.temperature ?? 0,
    };
    if (systemPrompt) body.system = systemPrompt;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    const content = textBlock?.text ?? "";

    return {
      content,
      model: ANTHROPIC_MODEL,
      provider: "anthropic",
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ────────────────────────────────────────

function prepareMessages(
  request: AIRequest
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages = [...request.messages];
  if (request.responseFormat === "json" && messages.length > 0) {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = {
      ...last,
      content:
        last.content +
        "\n\nRespond with ONLY valid JSON. No markdown, no backticks, no explanation.",
    };
  }
  return messages;
}

// ─── Public API ─────────────────────────────────────

/**
 * Run an AI inference request.
 *
 * Uses Anton when configured. Without Anton config, tries local Ollama first
 * and falls back to Anthropic if Ollama is unreachable or errors.
 *
 * @throws If Anton is configured and fails, or if both fallback providers fail.
 */
export async function runAI(request: AIRequest): Promise<AIResponse> {
  if (shouldUseAnton()) {
    return callAnton(request);
  }

  // Try Ollama first
  try {
    return await callOllama(request);
  } catch (ollamaError) {
    const ollamaMsg =
      ollamaError instanceof Error ? ollamaError.message : String(ollamaError);
    console.warn(`[AI Router] Ollama failed: ${ollamaMsg}. Falling back to Anthropic.`);
  }

  // Fallback to Anthropic
  try {
    return await callAnthropic(request);
  } catch (anthropicError) {
    const anthropicMsg =
      anthropicError instanceof Error ? anthropicError.message : String(anthropicError);
    throw new Error(
      `[AI Router] All providers failed. Ollama and Anthropic both unavailable. Last error: ${anthropicMsg}`
    );
  }
}
