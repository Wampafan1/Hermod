import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAntonJson, hasAntonConfig } from "@/lib/anton/client";

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

describe("Anton client", () => {
  it("sends ANTON_API_KEY unchanged as a Bearer token", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    await fetchAntonJson("/v1/chat/completions", {
      method: "POST",
      headers: { "X-Trace": "test" },
      body: "{}",
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://anton.test/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer client_id:client_secret");
    expect(opts.headers.Authorization).not.toMatch(/^Basic /);
    expect(opts.headers.Authorization).not.toContain("Y2xpZW50X2lk");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["X-Trace"]).toBe("test");
  });

  it("does not require callers to split or pass the key", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test/");
    vi.stubEnv("ANTON_API_KEY", "tenant-client:tenant-secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    await fetchAntonJson("health");

    expect(mockFetch.mock.calls[0][0]).toBe("https://anton.test/health");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer tenant-client:tenant-secret"
    );
  });

  it("reports a safe 401 authentication error", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "nope" }, 401));

    await expect(fetchAntonJson("/v1/chat/completions")).rejects.toThrow(
      "ANTON_API_KEY is missing or invalid"
    );
  });

  it("reports a safe 403 authorization error", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");
    vi.stubEnv("ANTON_API_KEY", "client_id:client_secret");
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "nope" }, 403));

    await expect(fetchAntonJson("/v1/chat/completions")).rejects.toThrow(
      "lacks permission"
    );
  });

  it("requires server-side Anton env configuration", async () => {
    vi.stubEnv("ANTON_API_BASE_URL", "https://anton.test");

    await expect(fetchAntonJson("/v1/chat/completions")).rejects.toThrow(
      "ANTON_API_KEY is required"
    );
  });

  it("detects complete Anton configuration", () => {
    expect(
      hasAntonConfig({ ...process.env, ANTON_API_BASE_URL: "", ANTON_API_KEY: "" })
    ).toBe(false);
    expect(
      hasAntonConfig({
        ...process.env,
        ANTON_API_BASE_URL: "https://anton.test",
        ANTON_API_KEY: "client_id:client_secret",
      })
    ).toBe(true);
  });
});
