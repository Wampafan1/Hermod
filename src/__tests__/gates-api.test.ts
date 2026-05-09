import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConnectionFindFirst,
  mockRealmGateCreate,
  mockRealmGateFindFirst,
  mockRealmGateUpdate,
  mockGatePushCreate,
  mockGatePushFindFirst,
  mockGatePushUpdate,
  mockBlueprintVersionFindFirst,
  mockForgeBlueprintFindFirst,
  mockReadTempFile,
  mockDeleteTempFile,
  mockExecutePush,
  mockAnalyzeExcel,
} = vi.hoisted(() => ({
  mockConnectionFindFirst: vi.fn(),
  mockRealmGateCreate: vi.fn(),
  mockRealmGateFindFirst: vi.fn(),
  mockRealmGateUpdate: vi.fn(),
  mockGatePushCreate: vi.fn(),
  mockGatePushFindFirst: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
  mockForgeBlueprintFindFirst: vi.fn(),
  mockReadTempFile: vi.fn(),
  mockDeleteTempFile: vi.fn(),
  mockExecutePush: vi.fn(),
  mockAnalyzeExcel: vi.fn(),
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
      findFirst: mockRealmGateFindFirst,
      findMany: vi.fn(),
      update: mockRealmGateUpdate,
    },
    gatePush: {
      create: mockGatePushCreate,
      findFirst: mockGatePushFindFirst,
      update: mockGatePushUpdate,
    },
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
    },
  },
}));

vi.mock("@/lib/gates/temp-files", () => ({
  readTempFile: mockReadTempFile,
  deleteTempFile: mockDeleteTempFile,
}));

vi.mock("@/lib/gates/push-executor", () => ({
  executePush: mockExecutePush,
}));

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/duckdb/file-analyzer", () => ({
  analyzeCSV: vi.fn(),
  analyzeExcel: mockAnalyzeExcel,
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

function gatePatchRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/gates/gate_1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
}

function gatePushDeleteRequest(gateId = "gate_1", pushId = "push_1") {
  return new Request(`http://localhost/api/gates/${gateId}/push/${pushId}`, {
    method: "DELETE",
  });
}

function gatePushExecuteRequest(gateId = "gate_1", pushId = "push_1") {
  return new Request(`http://localhost/api/gates/${gateId}/push/${pushId}/execute`, {
    method: "POST",
  });
}

function forgeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "forge_tenant_b",
    routeId: "route_1",
    tenantId: "tenant_b",
    status: "ACTIVE",
    name: "Tenant B Forge Blueprint",
    route: {
      id: "route_1",
      userId: "user_1",
      tenantId: "tenant_b",
    },
    ...overrides,
  };
}

function blueprintVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_1",
    blueprintId: "bp_published",
    tenantId: "tenant_b",
    version: 1,
    steps: [{ type: "rename_columns" }],
    stepsHash: "steps_hash",
    isLocked: true,
    blueprint: {
      scope: "TENANT_PUBLISHED",
      status: "VALIDATED",
    },
    ...overrides,
  };
}

function setupSuccessfulCreate() {
  mockConnectionFindFirst.mockResolvedValue({
    id: "conn_tenant_b",
    type: "POSTGRES",
    config: {},
    credentials: null,
  });
  mockReadTempFile.mockResolvedValue({
    buffer: Buffer.from("fixture"),
    extension: ".xlsx",
  });
  mockAnalyzeExcel.mockResolvedValue({
    columns: [
      {
        name: "id",
        duckdbType: "INTEGER",
        inferredType: "INTEGER",
        nullable: false,
      },
    ],
  });
  mockRealmGateCreate.mockResolvedValue({
    id: "gate_1",
    tenantId: "tenant_b",
    name: "Tenant B gate",
    forgeEnabled: false,
    forgeBlueprintId: null,
  });
  mockGatePushCreate.mockResolvedValue({ id: "push_1" });
  mockExecutePush.mockResolvedValue({
    status: "SUCCESS",
    rowCount: 1,
    rowsInserted: 1,
    rowsUpdated: 0,
    rowsErrored: 0,
    blankRowsSkipped: 0,
    duration: 10,
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

  it("creates gates without forgeBlueprintId", async () => {
    setupSuccessfulCreate();

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b"));

    expect(response.status).toBe(201);
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockRealmGateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        forgeEnabled: false,
        forgeBlueprintId: null,
      }),
    }));
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("uses the real initial push status and preserves staged files on KEY_DRIFT", async () => {
    setupSuccessfulCreate();
    mockExecutePush.mockResolvedValue({
      status: "KEY_DRIFT",
      rowCount: 3,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 1,
      keyDrift: {
        oldKey: ["id"],
        duplicateExamples: [],
        nullKeyExamples: [
          { rowIndex: 2, keyValues: { id: null }, missingColumns: ["id"] },
        ],
        reason: "Current UPSERT key has blank values in this upload.",
        candidateKeys: [],
        recommendation: null,
        validationStats: null,
        selectedKey: null,
      },
      duration: 12,
    });

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b"));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.initialPush.status).toBe("KEY_DRIFT");
    expect(payload.initialPush.blankRowsSkipped).toBe(1);
    expect(mockGatePushCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PUSHING",
        tempFileId: "tmp_1",
      }),
    }));
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("creates gates with same-tenant forgeBlueprintId", async () => {
    setupSuccessfulCreate();
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint());
    mockRealmGateCreate.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      name: "Tenant B gate",
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_b",
    });

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_b",
    }));

    expect(response.status).toBe(201);
    expect(mockForgeBlueprintFindFirst).toHaveBeenCalledWith({
      where: { id: "forge_tenant_b" },
      select: {
        id: true,
        routeId: true,
        tenantId: true,
        status: true,
        name: true,
        route: {
          select: {
            id: true,
            userId: true,
            tenantId: true,
          },
        },
      },
    });
    expect(mockRealmGateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        forgeEnabled: true,
        forgeBlueprintId: "forge_tenant_b",
      }),
    }));
  });

  it("creates gates with blueprintVersionId and clears legacy forgeBlueprintId", async () => {
    setupSuccessfulCreate();
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
    mockRealmGateCreate.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      name: "Tenant B gate",
      forgeEnabled: true,
      forgeBlueprintId: null,
      blueprintVersionId: "bv_1",
    });

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      blueprintVersionId: "bv_1",
      forgeBlueprintId: "forge_tenant_b",
    }));

    expect(response.status).toBe(201);
    expect(mockRealmGateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        forgeEnabled: true,
        blueprintVersionId: "bv_1",
        forgeBlueprintId: null,
      }),
    }));
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid blueprintVersionId on gate create", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_tenant_b",
      type: "POSTGRES",
      config: {},
      credentials: null,
    });
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      blueprintVersionId: "bv_missing",
    }));

    expect(response.status).toBe(404);
    expect(mockRealmGateCreate).not.toHaveBeenCalled();
  });

  it("rejects missing forgeBlueprintId on gate create", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_tenant_b",
      type: "POSTGRES",
      config: {},
      credentials: null,
    });
    mockForgeBlueprintFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      forgeBlueprintId: "forge_missing",
    }));

    expect(response.status).toBe(404);
    expect(mockForgeBlueprintFindFirst).toHaveBeenCalledWith({
      where: { id: "forge_missing" },
      select: {
        id: true,
        routeId: true,
        tenantId: true,
        status: true,
        name: true,
        route: {
          select: {
            id: true,
            userId: true,
            tenantId: true,
          },
        },
      },
    });
    expect(mockRealmGateCreate).not.toHaveBeenCalled();
  });

  it("requires forge blueprint attachments to belong to the active tenant", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_tenant_b",
      type: "POSTGRES",
      config: {},
      credentials: null,
    });
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({
      id: "forge_tenant_a",
      tenantId: "tenant_a",
      route: {
        id: "route_tenant_a",
        userId: "user_1",
        tenantId: "tenant_a",
        sourceConfig: { query: "select secret" },
        destConfig: { password: "do-not-return" },
      },
    }));

    const { POST } = await import("@/app/api/gates/route");
    const response = await POST(gateCreateRequest("conn_tenant_b", {
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_a",
    }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "Forge blueprint not found" });
    expect(JSON.stringify(payload)).not.toContain("select secret");
    expect(JSON.stringify(payload)).not.toContain("do-not-return");
    expect(mockRealmGateCreate).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant forgeBlueprintId on gate update", async () => {
    mockRealmGateFindFirst.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      forgeEnabled: false,
      forgeBlueprintId: null,
    });
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({
      id: "forge_tenant_a",
      tenantId: "tenant_a",
      route: {
        id: "route_tenant_a",
        userId: "user_1",
        tenantId: "tenant_a",
        sourceConfig: { query: "select secret" },
        destConfig: { token: "do-not-return" },
      },
    }));

    const { PATCH } = await import("@/app/api/gates/[gateId]/route");
    const response = await PATCH(gatePatchRequest({
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_a",
    }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "Forge blueprint not found" });
    expect(JSON.stringify(payload)).not.toContain("select secret");
    expect(JSON.stringify(payload)).not.toContain("do-not-return");
    expect(mockRealmGateCreate).not.toHaveBeenCalled();
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });

  it("stores blueprintVersionId on gate update and clears forgeBlueprintId", async () => {
    mockRealmGateFindFirst.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_b",
      blueprintVersionId: null,
    });
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
    mockRealmGateUpdate.mockResolvedValue({
      id: "gate_1",
      forgeEnabled: true,
      blueprintVersionId: "bv_1",
      forgeBlueprintId: null,
    });

    const { PATCH } = await import("@/app/api/gates/[gateId]/route");
    const response = await PATCH(gatePatchRequest({
      forgeEnabled: true,
      blueprintVersionId: "bv_1",
      forgeBlueprintId: "forge_tenant_b",
    }));

    expect(response.status).toBe(200);
    expect(mockRealmGateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        forgeEnabled: true,
        blueprintVersionId: "bv_1",
        forgeBlueprintId: null,
      }),
    }));
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid blueprintVersionId on gate update", async () => {
    mockRealmGateFindFirst.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      forgeEnabled: false,
      forgeBlueprintId: null,
      blueprintVersionId: null,
    });
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/gates/[gateId]/route");
    const response = await PATCH(gatePatchRequest({
      forgeEnabled: true,
      blueprintVersionId: "bv_missing",
    }));

    expect(response.status).toBe(404);
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });

  it("still supports legacy forgeBlueprintId on gate update", async () => {
    mockRealmGateFindFirst.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_b",
      forgeEnabled: false,
      forgeBlueprintId: null,
      blueprintVersionId: null,
    });
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint());
    mockRealmGateUpdate.mockResolvedValue({
      id: "gate_1",
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_b",
      blueprintVersionId: null,
    });

    const { PATCH } = await import("@/app/api/gates/[gateId]/route");
    const response = await PATCH(gatePatchRequest({
      forgeEnabled: true,
      forgeBlueprintId: "forge_tenant_b",
    }));

    expect(response.status).toBe(200);
    expect(mockRealmGateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        forgeEnabled: true,
        blueprintVersionId: null,
        forgeBlueprintId: "forge_tenant_b",
      }),
    }));
  });

  it("clears staged gate pushes and deletes their temp file", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_b",
      status: "SCHEMA_DRIFT",
      tempFileId: "tmp_1",
    });
    mockGatePushUpdate.mockResolvedValue({
      id: "push_1",
      status: "CANCELLED",
      tempFileId: null,
    });

    const { DELETE } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await DELETE(gatePushDeleteRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ pushId: "push_1", status: "CANCELLED" });
    expect(mockGatePushFindFirst).toHaveBeenCalledWith({
      where: { id: "push_1", gateId: "gate_1", tenantId: "tenant_b" },
    });
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: {
        status: "CANCELLED",
        tempFileId: null,
        completedAt: expect.any(Date),
      },
    });
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("does not clear gate pushes that are already running", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_b",
      status: "PUSHING",
      tempFileId: "tmp_1",
    });

    const { DELETE } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await DELETE(gatePushDeleteRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Push is already running and cannot be cleared" });
    expect(mockGatePushUpdate).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("preserves staged temp files when execution fails after validation", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_b",
      status: "VALIDATED",
      tempFileId: "tmp_1",
    });
    mockReadTempFile.mockResolvedValue({
      buffer: Buffer.from("fixture"),
      extension: ".csv",
    });
    mockExecutePush.mockResolvedValue({
      status: "FAILED",
      rowCount: 2,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsErrored: 2,
      blankRowsSkipped: 0,
      errorMessage: "Gate push failed for all rows.",
      duration: 10,
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/execute/route");
    const response = await POST(gatePushExecuteRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "FAILED",
      rowsErrored: 2,
    });
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: { status: "PUSHING" },
    });
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });
});
