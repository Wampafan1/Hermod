/**
 * Hermod VOICE client — Anton agent service.
 *
 * This is the OPPOSITE of the machinery track (`src/lib/llm`). Here we WANT
 * grounding, memory, persona, and the tenant "Sources" behavior: Anton answers
 * in Hermod's voice for USER-FACING help/guidance and returns prose (never
 * `format:"json"`). It must NEVER be wired into any machinery path
 * (Mjolnir / Alfheim / sync / gates / ucc).
 *
 * Config is intentionally distinct from the machinery (`HERMOD_OLLAMA_*`) and
 * from the legacy `ANTON_*` keys: `ANTON_VOICE_BASE_URL` / `ANTON_VOICE_API_KEY`.
 * The API key resolves to Hermod's OWN Anton tenant, provisioned by an operator
 * — it is never created from code. When unset, the client throws a typed
 * {@link AntonNotConfiguredError} so callers can fall back to static copy.
 *
 * Wire contract (Anton native endpoints — see anton `app/routes/native.py`):
 *   POST /query         { question, thread_id?, conversation_history?, stream }
 *     → { answer, thread_id, classification, domains, specialists_used, duration_ms, ... }
 *   POST /query/stream  (SSE) → `data: {"type": ...}\n\n` frames, ends `data: [DONE]`
 */

import { AntonError } from "./client";

const DEFAULT_BASE_URL = "http://192.168.1.159:8000";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Thrown when Hermod's voice tenant is not configured (no `ANTON_VOICE_API_KEY`). */
export class AntonNotConfiguredError extends AntonError {
  constructor(
    message = "Hermod voice is not configured. Set ANTON_VOICE_API_KEY to enable it."
  ) {
    super(message);
    this.name = "AntonNotConfiguredError";
  }
}

export interface VoiceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AskHermodInput {
  question: string;
  /** Anton `thread_id` — continues an existing conversation when provided. */
  sessionId?: string;
  history?: VoiceMessage[];
  /** Request timeout in ms (default 60s — voice answers can take seconds). */
  timeoutMs?: number;
}

export interface HermodVoiceAnswer {
  answer: string;
  sessionId: string;
  classification?: string;
  domains?: string[];
  specialistsUsed?: string[];
  durationMs?: number;
}

/** Typed Anton SSE events, surfaced from {@link streamHermod}. */
export type HermodVoiceEvent =
  | { type: "meta"; sessionId?: string }
  | { type: "metadata"; data: Record<string, unknown> }
  | { type: "classification"; classification?: string; domains?: string[] }
  | { type: "progress"; message?: string }
  | { type: "thinking"; content?: string }
  | { type: "tool_call"; name?: string; data: Record<string, unknown> }
  | { type: "answer"; content: string }
  | { type: "done" };

interface VoiceConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * True when Hermod's voice tenant is configured. Lets callers decide up front
 * whether to offer the voice surface or fall back to static help copy.
 */
export function hasVoiceConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTON_VOICE_API_KEY?.trim());
}

function resolveVoiceConfig(): VoiceConfig {
  const apiKey = process.env.ANTON_VOICE_API_KEY?.trim();
  if (!apiKey) {
    throw new AntonNotConfiguredError();
  }
  const baseUrl =
    process.env.ANTON_VOICE_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  return { baseUrl, apiKey };
}

function buildQueryBody(input: AskHermodInput, stream: boolean) {
  return {
    question: input.question,
    thread_id: input.sessionId,
    conversation_history: input.history,
    stream,
  };
}

// Native Anton /query (blocking) response shape — only the fields Hermod maps.
interface AntonQueryResponse {
  answer?: string;
  thread_id?: string;
  classification?: string;
  domains?: string[];
  specialists_used?: string[];
  duration_ms?: number;
}

/**
 * Ask Hermod a question and get one grounded prose answer (blocking POST /query).
 *
 * @throws AntonNotConfiguredError when the voice tenant is not configured.
 * @throws AntonError on transport / HTTP failures or timeout.
 */
export async function askHermod(input: AskHermodInput): Promise<HermodVoiceAnswer> {
  const { baseUrl, apiKey } = resolveVoiceConfig();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(buildQueryBody(input, false)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AntonError(
        `Anton voice error (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
        response.status
      );
    }

    const data = (await response.json()) as AntonQueryResponse;
    return {
      answer: data.answer ?? "",
      sessionId: data.thread_id ?? input.sessionId ?? "",
      classification: data.classification || undefined,
      domains: data.domains,
      specialistsUsed: data.specialists_used,
      durationMs: data.duration_ms,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AntonError(`Anton voice request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream Hermod's answer as typed events (SSE POST /query/stream).
 * Parses `data: {json}\n\n` frames and stops on `data: [DONE]`.
 *
 * @throws AntonNotConfiguredError when the voice tenant is not configured.
 * @throws AntonError on transport / HTTP failures.
 */
export async function* streamHermod(
  input: AskHermodInput
): AsyncGenerator<HermodVoiceEvent, void, unknown> {
  const { baseUrl, apiKey } = resolveVoiceConfig();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/query/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      signal: controller.signal,
      body: JSON.stringify(buildQueryBody(input, true)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AntonError(
        `Anton voice stream error (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
        response.status
      );
    }
    if (!response.body) {
      throw new AntonError("Anton voice stream returned no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLine = frame
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        const payload = dataLine.slice("data:".length).trim();
        if (payload === "[DONE]") {
          yield { type: "done" };
          return;
        }

        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // skip a malformed frame rather than aborting the stream
        }
        yield mapVoiceEvent(json);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function mapVoiceEvent(json: Record<string, unknown>): HermodVoiceEvent {
  const type = typeof json.type === "string" ? json.type : "";
  switch (type) {
    case "meta":
      return { type: "meta", sessionId: asString(json.thread_id) };
    case "classification":
      return {
        type: "classification",
        classification: asString(json.classification),
        domains: Array.isArray(json.domains) ? (json.domains as string[]) : undefined,
      };
    case "progress":
      return { type: "progress", message: asString(json.message) ?? asString(json.content) };
    case "thinking":
      return { type: "thinking", content: asString(json.content) };
    case "tool_call":
      return { type: "tool_call", name: asString(json.name), data: json };
    case "answer":
      return { type: "answer", content: asString(json.content) ?? "" };
    default:
      // "metadata" and any other/unknown event types are surfaced generically.
      return { type: "metadata", data: json };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
