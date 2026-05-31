import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────
// withAuth → passthrough that injects an auth context (no real session).
vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    }),
}));

// Mock only askHermod; keep the REAL AntonNotConfiguredError class so the
// route's `instanceof` check still works (and no live Anton call is made).
const { mockAskHermod } = vi.hoisted(() => ({ mockAskHermod: vi.fn() }));
vi.mock("@/lib/anton/voice-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anton/voice-client")>();
  return { ...actual, askHermod: mockAskHermod };
});

import { POST } from "@/app/api/voice/ask/route";
import { AntonNotConfiguredError } from "@/lib/anton/voice-client";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/voice/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/voice/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the typed voice answer on success", async () => {
    mockAskHermod.mockResolvedValue({
      answer: "Hermod carries your reports across the realms.",
      sessionId: "thread_42",
      classification: "help",
      domains: ["reports"],
      specialistsUsed: ["knowledge"],
      durationMs: 1200,
    });

    const res = await POST(postRequest({ question: "What is Hermod?" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toContain("Hermod");
    expect(json.sessionId).toBe("thread_42");
    expect(mockAskHermod).toHaveBeenCalledWith({
      question: "What is Hermod?",
      sessionId: undefined,
    });
  });

  it("forwards an existing sessionId to continue the conversation", async () => {
    mockAskHermod.mockResolvedValue({ answer: "Continuing.", sessionId: "thread_7" });

    await POST(postRequest({ question: "And then?", sessionId: "thread_7" }));

    expect(mockAskHermod).toHaveBeenCalledWith({
      question: "And then?",
      sessionId: "thread_7",
    });
  });

  it("returns 503 voice_unavailable when the voice tenant is not configured", async () => {
    mockAskHermod.mockRejectedValue(new AntonNotConfiguredError());

    const res = await POST(postRequest({ question: "Help me" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "voice_unavailable" });
  });

  it("rejects an empty question with 400 and never calls Anton", async () => {
    const res = await POST(postRequest({ question: "" }));

    expect(res.status).toBe(400);
    expect(mockAskHermod).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const badReq = new Request("http://localhost/api/voice/ask", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(badReq);

    expect(res.status).toBe(400);
    expect(mockAskHermod).not.toHaveBeenCalled();
  });
});
