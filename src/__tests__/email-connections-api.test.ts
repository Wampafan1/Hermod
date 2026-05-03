import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEmailConnectionFindFirst,
  mockEmailConnectionUpdate,
  mockScheduleCount,
  mockEmailConnectionDelete,
} = vi.hoisted(() => ({
  mockEmailConnectionFindFirst: vi.fn(),
  mockEmailConnectionUpdate: vi.fn(),
  mockScheduleCount: vi.fn(),
  mockEmailConnectionDelete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    emailConnection: {
      findFirst: mockEmailConnectionFindFirst,
      update: mockEmailConnectionUpdate,
      delete: mockEmailConnectionDelete,
    },
    schedule: {
      count: mockScheduleCount,
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
}));

function updateRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/email-connections/email_1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("email connections API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailConnectionFindFirst.mockResolvedValue({
      id: "email_1",
      name: "Relay",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      authType: "NONE",
      username: null,
      password: null,
      fromAddress: "reports@example.com",
    });
  });

  it("rejects auth mode updates that leave required credentials missing", async () => {
    const { PUT } = await import("@/app/api/email-connections/[id]/route");
    const response = await PUT(updateRequest({ authType: "PLAIN" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(mockEmailConnectionUpdate).not.toHaveBeenCalled();
  });
});
