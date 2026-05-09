import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWithAuth } = vi.hoisted(() => ({
  mockWithAuth: vi.fn((handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1", tenantId: "tenant_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    })
  ),
}));

vi.mock("@/lib/api", () => ({
  withAuth: mockWithAuth,
}));

describe("worker health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a safe worker-required payload", async () => {
    const { GET } = await import("@/app/api/system/worker-health/route");
    const response = await GET(new Request("http://localhost/api/system/worker-health"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      workerRequired: true,
      message: "Gate validation requires npm run worker in development.",
    });
    expect(JSON.stringify(payload)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(payload)).not.toContain("credentials");
    expect(mockWithAuth).toHaveBeenCalled();
  });
});
