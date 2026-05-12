import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAI } from "@/lib/ai/router";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("AI router Anton integration", () => {
  it("uses Anton when configured and sends the tenant key unchanged", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    vi.stubEnv("ANTON_MODEL", "anton-local");
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        model: "anton-local",
      })
    );

    const response = await runAI({
      messages: [{ role: "user", content: "Return JSON" }],
      responseFormat: "json",
    });

    expect(response.provider).toBe("anton");
    expect(response.model).toBe("anton-local");
    expect(response.content).toBe("{\"ok\":true}");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://anton.test/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer client_id:client_secret");
    expect(opts.headers.Authorization).not.toMatch(/^Basic /);

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("anton-local");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("Respond with ONLY valid JSON");
  });

  it("does not fall back to another provider for Anton auth failures", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "bad key" }, 401));

    await expect(
      runAI({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toThrow("ANTON_API_KEY is missing or invalid");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
