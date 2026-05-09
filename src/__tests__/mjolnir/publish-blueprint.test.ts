import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  mockBlueprintCreate,
  mockBlueprintFindFirst,
  mockBlueprintFindMany,
  mockBlueprintUpdate,
  mockBlueprintVersionCreate,
  mockBlueprintVersionFindFirst,
} = vi.hoisted(() => ({
  authState: { authorized: true },
  mockBlueprintCreate: vi.fn(),
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintFindMany: vi.fn(),
  mockBlueprintUpdate: vi.fn(),
  mockBlueprintVersionCreate: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
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
      findMany: mockBlueprintFindMany,
      update: mockBlueprintUpdate,
    },
    blueprintVersion: {
      create: mockBlueprintVersionCreate,
      findFirst: mockBlueprintVersionFindFirst,
    },
  },
}));

import { calculateBlueprintStepsHash } from "@/lib/mjolnir/blueprint-version";
import {
  PublishBlueprintError,
  publishBlueprintToTenant,
} from "@/lib/mjolnir/publish-blueprint";

function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function validStep(overrides: Record<string, unknown> = {}) {
  return {
    order: 0,
    type: "filter_rows",
    confidence: 0.92,
    config: { column: "Customer", operator: "eq", value: "Acme Corp" },
    description: 'Filter "Acme Corp"',
    ...overrides,
  };
}

function draftBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_draft",
    name: "Customer Cleanup",
    description: "Clean customer workbook",
    status: "VALIDATED",
    scope: "PERSONAL_DRAFT",
    steps: [validStep()],
    sourceSchema: {
      columns: ["Customer", "Email"],
      sampleRows: [{ Customer: "Acme Corp", Email: "ops@acme.test" }],
    },
    analysisLog: {
      formatChanges: [{
        column: "Customer",
        beforeValue: "Acme Corp",
        afterValue: "ACME CORP",
      }],
    },
    afterFormatting: {
      headerValues: { "0:0": "Acme Corp" },
      columns: ["Customer"],
    },
    beforeSample: "C:\\Customers\\Acme Before.xlsx",
    afterSample: "C:\\Customers\\Acme After.xlsx",
    ...overrides,
  };
}

const publishInput = {
  draftBlueprintId: "bp_draft",
  userId: "user_1",
  tenantId: "tenant_1",
};

describe("publishBlueprintToTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint());
    mockBlueprintFindMany.mockResolvedValue([]);
    mockBlueprintCreate.mockImplementation(async ({ data }) => ({
      id: "bp_published",
      name: data.name,
      description: data.description,
      scope: data.scope,
      tenantId: data.tenantId,
      status: data.status,
    }));
    mockBlueprintUpdate.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      name: data.name,
      description: data.description,
      scope: "TENANT_PUBLISHED",
      tenantId: "tenant_1",
      status: data.status,
    }));
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    mockBlueprintVersionCreate.mockImplementation(async ({ data }) => ({
      id: "bv_1",
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
      ...data,
    }));
  });

  it("returns not found for a missing draft", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);

    await expect(publishBlueprintToTenant(publishInput)).rejects.toMatchObject({
      status: 404,
      message: "Blueprint not found",
    });
  });

  it("rejects archived drafts", async () => {
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint({ status: "ARCHIVED" }));

    await expect(publishBlueprintToTenant(publishInput)).rejects.toBeInstanceOf(PublishBlueprintError);
    expect(mockBlueprintCreate).not.toHaveBeenCalled();
  });

  it("rejects DRAFT blueprints without validation evidence", async () => {
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint({ status: "DRAFT" }));

    await expect(publishBlueprintToTenant(publishInput)).rejects.toMatchObject({
      status: 400,
      message: "Blueprint must pass validation before it can be published.",
    });
  });

  it("publishes a DRAFT blueprint with passed validation evidence as VALIDATED", async () => {
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint({ status: "DRAFT" }));

    const result = await publishBlueprintToTenant({
      ...publishInput,
      validation: { passed: true, overallMatchRate: 0.98 },
    });

    expect(result.publishedBlueprint.status).toBe("VALIDATED");
    expect(mockBlueprintCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scope: "TENANT_PUBLISHED",
        tenantId: "tenant_1",
        publishedFromId: "bp_draft",
      }),
    }));
  });

  it("publishes VALIDATED and ACTIVE personal drafts", async () => {
    const validated = await publishBlueprintToTenant(publishInput);
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint({ status: "ACTIVE" }));
    const active = await publishBlueprintToTenant(publishInput);

    expect(validated.publishedBlueprint.status).toBe("VALIDATED");
    expect(active.publishedBlueprint.status).toBe("ACTIVE");
    expect(mockBlueprintVersionCreate).toHaveBeenCalledTimes(2);
  });

  it("creates a locked immutable version with the expected hash and source draft", async () => {
    const result = await publishBlueprintToTenant({
      ...publishInput,
      changeReason: "Ready for production",
    });

    const versionCreateArg = mockBlueprintVersionCreate.mock.calls[0][0];
    expect(result.createdParent).toBe(true);
    expect(result.version).toMatchObject({
      blueprintId: "bp_published",
      version: 1,
      stepsHash: calculateBlueprintStepsHash(versionCreateArg.data.steps),
      source: "PUBLISH",
      isLocked: true,
    });
    expect(versionCreateArg.data).toMatchObject({
      sourceDraftId: "bp_draft",
      changeReason: "Ready for production",
      lockedBy: "user_1",
      createdBy: "user_1",
    });
  });

  it("reuses an existing tenant-published parent for the same draft and tenant lineage", async () => {
    mockBlueprintFindMany.mockResolvedValue([{
      id: "bp_published_existing",
      createdAt: new Date("2026-05-08T00:00:00.000Z"),
    }]);
    mockBlueprintVersionFindFirst.mockResolvedValue({ version: 2 });

    const result = await publishBlueprintToTenant(publishInput);

    expect(result.createdParent).toBe(false);
    expect(mockBlueprintCreate).not.toHaveBeenCalled();
    expect(mockBlueprintUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "bp_published_existing" },
    }));
    expect(mockBlueprintVersionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintId: "bp_published_existing",
        version: 3,
        source: "REPUBLISH",
      }),
    }));
  });

  it("sanitizes sample-derived fields before parent and version persistence", async () => {
    await publishBlueprintToTenant(publishInput);

    const parentData = mockBlueprintCreate.mock.calls[0][0].data;
    const versionData = mockBlueprintVersionCreate.mock.calls[0][0].data;

    expect(parentData.beforeSample).toBe("Acme Before.xlsx");
    expect(parentData.afterSample).toBe("Acme After.xlsx");
    expect(JSON.stringify(parentData)).not.toContain("Acme Corp");
    expect(JSON.stringify(parentData)).not.toContain("ops@acme.test");
    expect(JSON.stringify(versionData)).not.toContain("Acme Corp");
    expect(JSON.stringify(versionData)).not.toContain("ops@acme.test");
  });
});

describe("publish blueprint API endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockBlueprintFindFirst.mockResolvedValue(draftBlueprint());
    mockBlueprintFindMany.mockResolvedValue([]);
    mockBlueprintCreate.mockImplementation(async ({ data }) => ({
      id: "bp_published",
      name: data.name,
      description: data.description,
      scope: data.scope,
      tenantId: data.tenantId,
      status: data.status,
    }));
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    mockBlueprintVersionCreate.mockImplementation(async ({ data }) => ({
      id: "bv_1",
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
      ...data,
    }));
  });

  it("POST publish requires auth", async () => {
    authState.authorized = false;
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/publish/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_draft/publish",
      {}
    ));

    expect(response.status).toBe(401);
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("POST publish uses the active tenant and does not return raw steps or analysis", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/publish/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_draft/publish",
      { changeReason: "Ship it" }
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.publishedBlueprint.tenantId).toBe("tenant_1");
    expect(body.version).toEqual(expect.objectContaining({
      id: "bv_1",
      blueprintId: "bp_published",
      version: 1,
      source: "PUBLISH",
      isLocked: true,
    }));
    expect(body.publishedBlueprint.steps).toBeUndefined();
    expect(body.version.steps).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("analysisLog");
    expect(JSON.stringify(body)).not.toContain("Acme Corp");
  });

  it("GET published-blueprints returns tenant-published blueprints for the active tenant", async () => {
    mockBlueprintFindMany.mockResolvedValue([{
      id: "bp_published",
      name: "Customer Cleanup",
      description: null,
      scope: "TENANT_PUBLISHED",
      tenantId: "tenant_1",
      status: "ACTIVE",
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
      updatedAt: new Date("2026-05-09T00:00:00.000Z"),
      versions: [{
        id: "bv_1",
        blueprintId: "bp_published",
        version: 1,
        stepsHash: "hash_1",
        createdAt: new Date("2026-05-09T00:00:00.000Z"),
        source: "PUBLISH",
        isLocked: true,
      }],
    }]);
    const { GET } = await import("@/app/api/mjolnir/published-blueprints/route");

    const response = await GET(new Request(
      "http://localhost/api/mjolnir/published-blueprints?includeVersions=true"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockBlueprintFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        scope: "TENANT_PUBLISHED",
        tenantId: "tenant_1",
        status: { in: ["ACTIVE", "VALIDATED"] },
      },
    }));
    expect(body.blueprints[0]).toMatchObject({
      id: "bp_published",
      scope: "TENANT_PUBLISHED",
      tenantId: "tenant_1",
      latestVersion: {
        id: "bv_1",
        version: 1,
        stepsHash: "hash_1",
      },
    });
    expect(body.blueprints[0].steps).toBeUndefined();
    expect(body.blueprints[0].latestVersion.steps).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("analysisLog");
  });

  it("GET published-blueprints rejects invalid status filters", async () => {
    const { GET } = await import("@/app/api/mjolnir/published-blueprints/route");

    const response = await GET(new Request(
      "http://localhost/api/mjolnir/published-blueprints?status=DRAFT"
    ));

    expect(response.status).toBe(400);
    expect(mockBlueprintFindMany).not.toHaveBeenCalled();
  });
});
