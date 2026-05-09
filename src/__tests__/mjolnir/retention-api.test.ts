import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  mockBlueprintCreate,
  mockBlueprintFindFirst,
  mockBlueprintUpdate,
  mockCleanupExpired,
  mockCleanupFile,
  mockCleanupUser,
  mockCleanupUserExpired,
} = vi.hoisted(() => ({
  authState: { authorized: true },
  mockBlueprintCreate: vi.fn(),
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintUpdate: vi.fn(),
  mockCleanupExpired: vi.fn(),
  mockCleanupFile: vi.fn(),
  mockCleanupUser: vi.fn(),
  mockCleanupUserExpired: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => {
    if (!authState.authorized) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    });
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprint: {
      create: mockBlueprintCreate,
      findFirst: mockBlueprintFindFirst,
      update: mockBlueprintUpdate,
    },
  },
}));

vi.mock("@/lib/mjolnir/cleanup", () => ({
  cleanupExpiredMjolnirTempFiles: mockCleanupExpired,
  cleanupMjolnirFile: mockCleanupFile,
  cleanupUserTempFiles: mockCleanupUser,
  cleanupUserExpiredTempFiles: mockCleanupUserExpired,
  getMjolnirUserTempDir: (userId: string) => `C:\\Temp\\hermod-mjolnir\\${userId}`,
}));

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validStep(overrides: Record<string, unknown> = {}) {
  return {
    order: 0,
    type: "filter_rows",
    confidence: 0.8,
    config: { column: "Customer", operator: "eq", value: "Acme Corp" },
    description: 'Filter "Acme Corp"',
    ...overrides,
  };
}

describe("Mjolnir retention API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockBlueprintCreate.mockImplementation(async ({ data }) => ({ id: "bp_1", ...data }));
    mockBlueprintFindFirst.mockResolvedValue({ id: "bp_1", userId: "user_1", status: "DRAFT" });
    mockBlueprintUpdate.mockImplementation(async ({ data }) => ({ id: "bp_1", ...data }));
    mockCleanupExpired.mockResolvedValue({ filesDeleted: 0, dirsDeleted: 0 });
    mockCleanupFile.mockResolvedValue({ filesDeleted: 2, dirsDeleted: 1 });
    mockCleanupUser.mockResolvedValue(undefined);
    mockCleanupUserExpired.mockResolvedValue({ filesDeleted: 1, dirsDeleted: 0 });
  });

  it("blueprint create persists sanitized payload", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await POST(jsonRequest("http://localhost/api/mjolnir/blueprints", {
      name: "Sensitive Blueprint",
      description: 'Built from "Acme Corp"',
      steps: [validStep()],
      sourceSchema: {
        columns: ["Customer"],
        types: {},
        sampleRows: [{ Customer: "Acme Corp" }],
      },
      analysisLog: {
        formatChanges: [{
          column: "Customer",
          changeType: "case",
          beforeSample: "Acme Corp",
          afterSample: "ACME CORP",
        }],
      },
      afterFormatting: {
        headerValues: { "0:0": "Acme Corp" },
        columns: ["Customer"],
      },
      beforeSample: "C:\\Customers\\Acme Before.xlsx",
      afterSample: "C:\\Customers\\Acme After.xlsx",
    }));

    expect(response.status).toBe(201);
    const createArg = mockBlueprintCreate.mock.calls[0][0];
    expect(createArg.data.beforeSample).toBe("Acme Before.xlsx");
    expect(createArg.data.afterSample).toBe("Acme After.xlsx");
    expect(createArg.data.afterFormatting.headerValues).toEqual({
      "0:0": "[REDACTED_SAMPLE]",
    });
    expect(JSON.stringify(createArg.data)).not.toContain("Acme Corp");
    expect(mockCleanupUser).toHaveBeenCalledWith("user_1");
  });

  it("blueprint update sanitizes sample-derived fields", async () => {
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest("http://localhost/api/mjolnir/blueprints/bp_1", {
      steps: [validStep()],
      analysisLog: {
        formatChanges: [{
          column: "Customer",
          changeType: "trim",
          beforeSample: " Acme Corp ",
          afterSample: "Acme Corp",
        }],
      },
      afterFormatting: {
        headerValues: { "0:0": "Acme Corp" },
        columns: ["Customer"],
      },
      beforeSample: "Acme Before.xlsx",
      afterSample: "Acme After.xlsx",
    }, "PUT"));

    expect(response.status).toBe(200);
    const updateArg = mockBlueprintUpdate.mock.calls[0][0];
    expect(updateArg.data.beforeSample).toBe("Acme Before.xlsx");
    expect(updateArg.data.afterSample).toBe("Acme After.xlsx");
    expect(updateArg.data.afterFormatting.headerValues).toEqual({
      "0:0": "[REDACTED_SAMPLE]",
    });
    expect(JSON.stringify(updateArg.data)).not.toContain("Acme Corp");
  });

  it("cleanup endpoint requires auth", async () => {
    authState.authorized = false;
    const { POST } = await import("@/app/api/mjolnir/cleanup/route");

    const response = await POST(jsonRequest("http://localhost/api/mjolnir/cleanup", {
      expiredOnly: false,
    }));

    expect(response.status).toBe(401);
    expect(mockCleanupFile).not.toHaveBeenCalled();
  });

  it("cleanup endpoint rejects arbitrary paths", async () => {
    const { POST } = await import("@/app/api/mjolnir/cleanup/route");

    const response = await POST(jsonRequest("http://localhost/api/mjolnir/cleanup", {
      expiredOnly: false,
      path: "C:\\Customers\\Acme Before.xlsx",
    }));

    expect(response.status).toBe(400);
    expect(mockCleanupFile).not.toHaveBeenCalled();
  });

  it("cleanup endpoint cleans only the current user's temp directory", async () => {
    const { POST } = await import("@/app/api/mjolnir/cleanup/route");

    const response = await POST(jsonRequest("http://localhost/api/mjolnir/cleanup", {
      expiredOnly: false,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ filesDeleted: 2, dirsDeleted: 1 });
    expect(mockCleanupFile).toHaveBeenCalledWith("C:\\Temp\\hermod-mjolnir\\user_1");
  });

  it("cleanup endpoint can delete only expired current-user temp files", async () => {
    const { POST } = await import("@/app/api/mjolnir/cleanup/route");

    const response = await POST(jsonRequest("http://localhost/api/mjolnir/cleanup", {
      expiredOnly: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ filesDeleted: 1, dirsDeleted: 0 });
    expect(mockCleanupUserExpired).toHaveBeenCalledWith("user_1");
    expect(mockCleanupFile).not.toHaveBeenCalled();
  });
});
