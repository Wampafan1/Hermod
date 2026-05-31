import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// Replace global fetch with our mock
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { AnthropicProvider } from "@/lib/llm/providers/anthropic";
import { AntonProvider } from "@/lib/llm/providers/anton";
import { OllamaProvider } from "@/lib/llm/providers/ollama";
import { getLlmProvider, runMachineInference } from "@/lib/llm";
import { resolveOllamaModel, resolveOllamaBaseUrl } from "@/lib/llm/model-policy";

// ─── Helpers ────────────────────────────────────────

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const openaiSuccess = {
  choices: [{ message: { content: "Hello from GPT" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model: "gpt-4o",
};

const anthropicSuccess = {
  content: [{ type: "text", text: "Hello from Claude" }],
  usage: { input_tokens: 12, output_tokens: 8 },
  model: "claude-sonnet-4-20250514",
};

const antonSuccess = {
  choices: [{ message: { content: "Hello from Anton" } }],
  usage: { prompt_tokens: 14, completion_tokens: 6 },
  model: "anton-local",
};

const simpleRequest = {
  model: "gpt-4o",
  messages: [{ role: "user" as const, content: "Hi" }],
};

// ─── OpenAI-Compatible Provider ─────────────────────

describe("OpenAICompatibleProvider", () => {
  const provider = new OpenAICompatibleProvider({
    provider: "openai",
    model: "gpt-4o",
    apiKey: "sk-test-key",
  });

  it("sends a successful chat request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    const result = await provider.chat(simpleRequest);

    expect(result.content).toBe("Hello from GPT");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe("gpt-4o");

    // Verify fetch was called correctly
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("handles API error responses", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ error: { message: "Invalid API key" } }, 401)
    );

    await expect(provider.chat(simpleRequest)).rejects.toThrow(
      "openai API error (401)"
    );
  });

  it("handles timeout via AbortController", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(provider.chat(simpleRequest)).rejects.toThrow(
      "openai request timed out"
    );
  });

  it("passes response_format for JSON mode", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await provider.chat({
      ...simpleRequest,
      responseFormat: { type: "json_object" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("passes temperature and max_tokens when provided", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await provider.chat({
      ...simpleRequest,
      temperature: 0.7,
      maxTokens: 500,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(500);
  });

  it("uses correct base URL for xai provider", async () => {
    const xaiProvider = new OpenAICompatibleProvider({
      provider: "xai",
      model: "grok-3",
      apiKey: "xai-test-key",
    });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await xaiProvider.chat(simpleRequest);

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.x.ai/v1/chat/completions"
    );
  });

  it("uses correct base URL for groq provider", async () => {
    const groqProvider = new OpenAICompatibleProvider({
      provider: "groq",
      model: "llama-3.3-70b",
      apiKey: "gsk-test-key",
    });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await groqProvider.chat(simpleRequest);

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.groq.com/openai/v1/chat/completions"
    );
  });

  it("uses custom base URL when provided", async () => {
    const customProvider = new OpenAICompatibleProvider({
      provider: "custom",
      model: "local-model",
      apiKey: "test-key",
      baseUrl: "http://localhost:8080/v1",
    });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await customProvider.chat(simpleRequest);

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:8080/v1/chat/completions"
    );
  });

  it("returns provider/model as name", () => {
    expect(provider.name).toBe("openai/gpt-4o");
  });

  it("defaults usage to zero when response omits it", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [{ message: { content: "ok" } }],
        model: "gpt-4o",
      })
    );

    const result = await provider.chat(simpleRequest);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("uses configured model when request.model is omitted", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(openaiSuccess));

    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
  });
});

// ─── Anthropic Provider ─────────────────────────────

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider({
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-ant-test-key",
  });

  it("sends a successful chat request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    const result = await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.content).toBe("Hello from Claude");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
    expect(result.model).toBe("claude-sonnet-4-20250514");

    // Verify fetch was called correctly
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("extracts system message to top-level system field", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hi" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe("You are a helpful assistant");
    // System message should not appear in messages array
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("appends JSON instruction to system message for json_object format", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "Analyze this data" },
        { role: "user", content: "Hi" },
      ],
      responseFormat: { type: "json_object" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toContain("Analyze this data");
    expect(body.system).toContain("respond with valid JSON only");
  });

  it("creates JSON system message when no system message exists", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
      responseFormat: { type: "json_object" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toContain("respond with valid JSON only");
  });

  it("handles API error responses", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ error: { message: "Invalid key" } }, 401)
    );

    await expect(
      provider.chat({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hi" }],
      })
    ).rejects.toThrow("Anthropic API error (401)");
  });

  it("defaults max_tokens to 4096", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
  });

  it("returns provider/model as name", () => {
    expect(provider.name).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("appends /v1 to baseUrl when missing", async () => {
    const providerWithBareUrl = new AnthropicProvider({
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-ant-test-key",
      baseUrl: "https://api.anthropic.com",
    });

    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await providerWithBareUrl.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("does not double-append /v1 when baseUrl already has it", async () => {
    const providerWithV1 = new AnthropicProvider({
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-ant-test-key",
      baseUrl: "https://api.anthropic.com/v1",
    });

    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await providerWithV1.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("uses configured model when request.model is omitted", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-20250514");
  });

  it("uses request.model when explicitly provided", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));

    await provider.chat({
      model: "claude-opus-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-opus-4-20250514");
  });
});

// ─── Anton Provider ─────────────────────────────────

describe("AntonProvider", () => {
  it("sends ANTON_API_KEY unchanged as a Bearer token", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse(antonSuccess));

    const provider = new AntonProvider({
      model: "anton-local",
      baseUrl: "https://anton.test",
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.content).toBe("Hello from Anton");
    expect(result.usage).toEqual({ inputTokens: 14, outputTokens: 6 });
    expect(result.model).toBe("anton-local");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://anton.test/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer client_id:client_secret");
    expect(opts.headers.Authorization).not.toMatch(/^Basic /);

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("anton-local");
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("passes response_format for JSON mode", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse(antonSuccess));

    const provider = new AntonProvider({ model: "anton-local" });
    await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
      responseFormat: { type: "json_object" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("surfaces Anton 401 and 403 errors safely", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, 401));

    const provider = new AntonProvider({ model: "anton-local" });
    await expect(
      provider.chat({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toThrow("ANTON_API_KEY is missing or invalid");

    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "forbidden" }, 403));
    await expect(
      provider.chat({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toThrow("lacks permission");
  });

  it("returns provider/model as name", () => {
    const provider = new AntonProvider({ model: "anton-local" });
    expect(provider.name).toBe("anton/anton-local");
  });
});

// ─── Factory (getLlmProvider) ───────────────────────

describe("getLlmProvider", () => {
  it("creates OpenAI provider from env vars", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_MODEL", "gpt-4o");
    vi.stubEnv("LLM_API_KEY", "sk-test");

    const provider = getLlmProvider();
    expect(provider.name).toBe("openai/gpt-4o");
  });

  it("creates Anthropic provider when provider is 'anthropic'", () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-20250514");
    vi.stubEnv("LLM_API_KEY", "sk-ant-test");

    const provider = getLlmProvider();
    expect(provider.name).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("creates Anton provider without LLM_API_KEY", () => {
    vi.stubEnv("LLM_PROVIDER", "anton");
    vi.stubEnv("ANTON_MODEL", "anton-local");
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");

    const provider = getLlmProvider();
    expect(provider.name).toBe("anton/anton-local");
  });

  it("defaults to Anton when Anton env is configured", () => {
    vi.stubEnv("ANTON_MODEL", "anton-local");
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");

    const provider = getLlmProvider();
    expect(provider.name).toBe("anton/anton-local");
  });

  it("creates xai provider from env vars", () => {
    vi.stubEnv("LLM_PROVIDER", "xai");
    vi.stubEnv("LLM_MODEL", "grok-3");
    vi.stubEnv("LLM_API_KEY", "xai-test");

    const provider = getLlmProvider();
    expect(provider.name).toBe("xai/grok-3");
  });

  it("explicit config overrides env vars", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_MODEL", "gpt-4o");
    vi.stubEnv("LLM_API_KEY", "sk-env");

    const provider = getLlmProvider({
      provider: "xai",
      model: "grok-3",
      apiKey: "xai-override",
    });
    expect(provider.name).toBe("xai/grok-3");
  });

  it("throws when provider is missing", () => {
    vi.stubEnv("LLM_MODEL", "gpt-4o");
    vi.stubEnv("LLM_API_KEY", "sk-test");

    expect(() => getLlmProvider()).toThrow("LLM provider is required");
  });

  it("throws when model is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_API_KEY", "sk-test");

    expect(() => getLlmProvider()).toThrow("LLM model is required");
  });

  it("throws when API key is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_MODEL", "gpt-4o");

    expect(() => getLlmProvider()).toThrow("LLM API key is required");
  });

  it("creates an Ollama provider when LLM_PROVIDER=ollama (no API key needed)", () => {
    vi.stubEnv("LLM_PROVIDER", "ollama");

    const provider = getLlmProvider();
    expect(provider.name).toBe("ollama/qwen3:8b");
  });

  it("never resolves a cloud model name for ollama even if LLM_MODEL is set", () => {
    vi.stubEnv("LLM_PROVIDER", "ollama");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");

    const provider = getLlmProvider();
    expect(provider.name).toBe("ollama/qwen3:8b");
    expect(provider.name).not.toContain("claude");
  });

  it("does not let LLM_MODEL leak into the anton provider", () => {
    vi.stubEnv("LLM_PROVIDER", "anton");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
    vi.stubEnv("ANTON_MODEL", "anton");

    const provider = getLlmProvider();
    expect(provider.name).toBe("anton/anton");
  });
});

// ─── Ollama Provider ────────────────────────────────

describe("OllamaProvider", () => {
  const provider = new OllamaProvider({
    model: "qwen3:8b",
    baseUrl: "http://192.168.1.181:11434",
  });

  const ollamaSuccess = { message: { content: "Hello from Ollama" } };

  it("posts to /api/chat with think:false and num_predict:-1", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaSuccess));

    const result = await provider.chat({
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0,
    });

    expect(result.content).toBe("Hello from Ollama");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.model).toBe("qwen3:8b");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://192.168.1.181:11434/api/chat");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("qwen3:8b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_predict: -1 });
    expect(body.format).toBeUndefined();
  });

  it("sets format:json and appends the JSON instruction to the last message only", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaSuccess));

    await provider.chat({
      messages: [
        { role: "system", content: "Be precise" },
        { role: "user", content: "Give me data" },
      ],
      responseFormat: { type: "json_object" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toBe("json");
    expect(body.messages[0].content).toBe("Be precise");
    expect(body.messages[1].content).toContain("Give me data");
    expect(body.messages[1].content).toContain("ONLY valid JSON");
  });

  it("defaults temperature to 0 when omitted", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaSuccess));
    await provider.chat({ messages: [{ role: "user", content: "Hi" }] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options.temperature).toBe(0);
  });

  it("throws on empty content", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { content: "" } }));
    await expect(
      provider.chat({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toThrow("Ollama returned no content");
  });

  it("throws on a non-ok HTTP status", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "boom" }, 500));
    await expect(
      provider.chat({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toThrow("Ollama HTTP 500");
  });

  it("returns ollama/model as name", () => {
    expect(provider.name).toBe("ollama/qwen3:8b");
  });
});

// ─── Model policy (purpose → model resolution) ──────

describe("model-policy", () => {
  it("resolveOllamaModel defaults: fast → qwen3:8b, smart → nemotron3:33b", () => {
    expect(resolveOllamaModel("fast")).toBe("qwen3:8b");
    expect(resolveOllamaModel("smart")).toBe("nemotron3:33b");
  });

  it("resolveOllamaModel env override wins for each tier", () => {
    vi.stubEnv("HERMOD_OLLAMA_MODEL_FAST", "qwen3:14b");
    vi.stubEnv("HERMOD_OLLAMA_MODEL_SMART", "llama3.3:70b");
    expect(resolveOllamaModel("fast")).toBe("qwen3:14b");
    expect(resolveOllamaModel("smart")).toBe("llama3.3:70b");
  });

  it("resolveOllamaBaseUrl prefers HERMOD_OLLAMA_URL, then OLLAMA_URL, then default", () => {
    expect(resolveOllamaBaseUrl()).toBe("http://192.168.1.181:11434");
    vi.stubEnv("OLLAMA_URL", "http://legacy:11434");
    expect(resolveOllamaBaseUrl()).toBe("http://legacy:11434");
    vi.stubEnv("HERMOD_OLLAMA_URL", "http://hermod-gpu:11434");
    expect(resolveOllamaBaseUrl()).toBe("http://hermod-gpu:11434");
  });

  it("never resolves a cloud model name — LLM_MODEL is ignored", () => {
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
    expect(resolveOllamaModel("fast")).toBe("qwen3:8b");
    expect(resolveOllamaModel("smart")).toBe("nemotron3:33b");
  });
});

// ─── runMachineInference (machinery entry point) ────

describe("runMachineInference", () => {
  const ollamaJson = { message: { content: '{"ok":true}' } };

  it("runs against local Ollama with the purpose-resolved model", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaJson));

    const result = await runMachineInference(
      {
        messages: [{ role: "user", content: "Hi" }],
        responseFormat: { type: "json_object" },
      },
      { purpose: "smart" }
    );

    expect(result.provider).toBe("ollama");
    expect(result.content).toBe('{"ok":true}');
    expect(result.model).toBe("nemotron3:33b");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://192.168.1.181:11434/api/chat");
    expect(JSON.parse(opts.body).model).toBe("nemotron3:33b");
  });

  it("NEVER sends a claude-* model to Ollama, even when LLM_MODEL is a cloud model", async () => {
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaJson));

    const result = await runMachineInference(
      { messages: [{ role: "user", content: "Hi" }] },
      { purpose: "fast" }
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("qwen3:8b");
    expect(body.model).not.toContain("claude");
    expect(result.provider).toBe("ollama");
  });

  it("defaults to the fast purpose when opts is omitted", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(ollamaJson));
    await runMachineInference({ messages: [{ role: "user", content: "Hi" }] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("qwen3:8b");
  });

  it("falls back to Anthropic when Ollama errors and ANTHROPIC_API_KEY is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ error: "down" }, 500))
      .mockResolvedValueOnce(mockJsonResponse(anthropicSuccess));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runMachineInference(
      { messages: [{ role: "user", content: "Hi" }] },
      { purpose: "fast" }
    );

    expect(result.provider).toBe("anthropic");
    expect(result.content).toBe("Hello from Claude");

    // First fetch = Ollama (failed); second = Anthropic with the cloud model.
    expect(mockFetch.mock.calls[0][0]).toBe("http://192.168.1.181:11434/api/chat");
    const [anthUrl, anthOpts] = mockFetch.mock.calls[1];
    expect(anthUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(anthOpts.body).model).toBe("claude-sonnet-4-6");

    warnSpy.mockRestore();
  });

  it("rethrows the Ollama error when no ANTHROPIC_API_KEY is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "down" }, 500));

    await expect(
      runMachineInference(
        { messages: [{ role: "user", content: "Hi" }] },
        { purpose: "fast" }
      )
    ).rejects.toThrow("Ollama HTTP 500");

    // No cloud fallback attempted.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
