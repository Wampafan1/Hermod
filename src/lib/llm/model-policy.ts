// ─── Purpose-tiered model resolution for Hermod's local AI machinery ──────
//
// Hermod's INTERNAL, non-user-facing AI calls ("the machinery") run against a
// local Ollama GPU server. Joe changes models frequently, so the resolved
// model name MUST come from env first; the defaults below are last-resort
// fallbacks only.
//
// These env names are Hermod-owned and intentionally distinct from Anton's own
// config (ANTON_*) and from any cloud model name (LLM_MODEL). A cloud model
// name must NEVER reach the Ollama client.

export type LlmPurpose = "fast" | "smart";

/**
 * Resolve the Ollama model for a given purpose tier.
 * - "fast":  quick structured/JSON tasks (routing, header detection, pruning).
 * - "smart": heavier reasoning (ambiguous inference, schema/key recommendation).
 *
 * Env override always wins; the literal defaults are a last resort only.
 */
export function resolveOllamaModel(purpose: LlmPurpose): string {
  if (purpose === "smart") {
    return process.env.HERMOD_OLLAMA_MODEL_SMART?.trim() || "nemotron3:33b";
  }
  return process.env.HERMOD_OLLAMA_MODEL_FAST?.trim() || "qwen3:8b";
}

/**
 * Resolve the Ollama base URL. The Hermod-owned HERMOD_OLLAMA_URL wins, then
 * the legacy OLLAMA_URL, then a last-resort default pointing at the local GPU
 * box. Anton's base URL is deliberately NOT consulted here.
 */
export function resolveOllamaBaseUrl(): string {
  return (
    process.env.HERMOD_OLLAMA_URL?.trim() ||
    process.env.OLLAMA_URL?.trim() ||
    "http://192.168.1.181:11434"
  );
}
