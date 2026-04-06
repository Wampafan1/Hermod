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
import { getLlmProvider } from "@/lib/llm";

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
});
