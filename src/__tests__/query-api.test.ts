import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnectionFindFirst,
  mockConnect,
  mockQuery,
  mockClose,
} = vi.hoisted(() => ({
  mockConnectionFindFirst: vi.fn(),
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => handler(req, {
    userId: "user_1",
    tenantId: "tenant_1",
    user: { id: "user_1" },
    session: { user: { id: "user_1", tenantId: "tenant_1" } },
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findFirst: mockConnectionFindFirst,
    },
  },
}));

vi.mock("@/lib/providers", () => ({
  getProvider: () => ({
    connect: mockConnect,
    query: mockQuery,
  }),
  toConnectionLike: (connection: unknown) => connection,
}));

function executeRequest() {
  return new Request("http://localhost/api/query/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId: "conn_1",
      sql: "SELECT 1",
    }),
  });
}

describe("query execution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_1",
      userId: "user_1",
      tenantId: "tenant_1",
      type: "POSTGRES",
      config: {},
      credentials: "encrypted",
    });
    mockConnect.mockResolvedValue({ close: mockClose });
    mockClose.mockResolvedValue(undefined);
  });

  it("scopes connection lookup to the active tenant", async () => {
    mockQuery.mockResolvedValue({ columns: ["one"], rows: [{ one: 1 }] });

    const { POST } = await import("@/app/api/query/execute/route");
    await POST(executeRequest());

    expect(mockConnectionFindFirst).toHaveBeenCalledWith({
      where: { id: "conn_1", userId: "user_1", tenantId: "tenant_1" },
    });
  });

  it("does not return raw provider errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("password=secret host=db.internal"));

    const { POST } = await import("@/app/api/query/execute/route");
    const response = await POST(executeRequest());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({ error: "Query execution failed" });
    expect(JSON.stringify(body)).not.toContain("secret");

    errorSpy.mockRestore();
  });
});
