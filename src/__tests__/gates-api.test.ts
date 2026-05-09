import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnectionFindFirst,
  mockRealmGateCreate,
  mockGatePushCreate,
  mockForgeBlueprintFindFirst,
} = vi.hoisted(() => ({
  mockConnectionFindFirst: vi.fn(),
  mockRealmGateCreate: vi.fn(),
  mockGatePushCreate: vi.fn(),
  mockForgeBlueprintFindFirst: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_b",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_b" } },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    realmGate: {
      create: mockRealmGateCreate,
      findMany: vi.fn(),
    },
    gatePush: {
      create: mockGatePushCreate,
    },
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
    },
  },
}));

vi.mock("@/lib/gates/temp-files", () => ({
  readTempFile: vi.fn(),
  deleteTempFile: vi.fn(),
}));

vi.mock("@/lib/gates/push-executor", () => ({
  executePush: vi.fn(),
}));

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/duckdb/file-analyzer", () => ({
  analyzeCSV: vi.fn(),
  analyzeExcel: vi.fn(),
}));

function gateCreateRequest(connectionId = "conn_tenant_a", overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/gates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Tenant B gate",
      tempFileId: "tmp_1",
      realmType: "VANAHEIM",
      connectionId,
      targetTable: "customers",
      targetSchema: "public",
      primaryKeyColumns: ["id"],
      mergeStrategy: "UPSERT",
      columnMapping: [
        {
          sourceColumn: "id",
          destinationColumn: "id",
          sourceType: "INTEGER",
          destType: "INTEGER",
        },
      ],
      forgeEnabled: false,
      forgeBlueprintId: null,
      ...overrides,
    }),
  });
}

describe("gates API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires create gate connections to belong to the active tenant", async () => {
    mockConnectionFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest());

    expect(response.status).toBe(404);
    expect(mockConnectionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "conn_tenant_a",
        tenantId: "tenant_b",
      },
    });
  });

  it("requires forge blueprint attachments to belong to the active tenant", async () => {
    mockConnectionFindFirst.mockResolvedValue({ id: "conn_tenant_b", type: "POSTGRES", config: {}, credentials: null });
    mockForgeBlueprintFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_a",
    }));

    expect(response.status).toBe(404);
    expect(mockForgeBlueprintFindFirst).toHaveBeenCalledWith({
      where: {
        id: "forge_tenant_a",
        tenantId: "tenant_b",
      },
      select: { id: true },
    });
    expect(mockRealmGateCreate).not.toHaveBeenCalled();
  });
});
