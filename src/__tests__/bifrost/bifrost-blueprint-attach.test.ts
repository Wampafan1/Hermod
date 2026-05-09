import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  mockBlueprintFindFirst,
  mockBlueprintVersionFindFirst,
  mockConnectionFindFirst,
  mockBifrostRouteCreate,
  mockBifrostRouteFindFirst,
  mockBifrostRouteUpdate,
  mockRavenSatelliteFindFirst,
} = vi.hoisted(() => ({
  authState: { authorized: true },
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
  mockConnectionFindFirst: vi.fn(),
  mockBifrostRouteCreate: vi.fn(),
  mockBifrostRouteFindFirst: vi.fn(),
  mockBifrostRouteUpdate: vi.fn(),
  mockRavenSatelliteFindFirst: vi.fn(),
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
      findFirst: mockBlueprintFindFirst,
    },
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    bifrostRoute: {
      create: mockBifrostRouteCreate,
      findFirst: mockBifrostRouteFindFirst,
      update: mockBifrostRouteUpdate,
    },
    ravenSatellite: {
      findFirst: mockRavenSatelliteFindFirst,
    },
  },
}));

import { validateBifrostBlueprintAttachment } from "@/lib/mjolnir/bifrost-blueprint-attach";

const baseInput = {
  userId: "user_1",
  tenantId: "tenant_1",
  transformEnabled: true,
};

function blueprintVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_1",
    blueprintId: "bp_published",
    tenantId: "tenant_1",
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

function legacyBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_legacy",
    userId: "user_1",
    status: "ACTIVE",
    steps: [{ type: "rename_columns" }],
    name: "Legacy Blueprint",
    ...overrides,
  };
}

function routePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Revenue Route",
    sourceId: "conn_source",
    sourceConfig: { query: "select * from source" },
    destId: "conn_dest",
    destConfig: {
      dataset: "analytics",
      table: "revenue",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: false,
    },
    transformEnabled: true,
    ...overrides,
  };
}

function existingRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Existing Route",
    transformEnabled: false,
    blueprintVersionId: null,
    blueprintId: null,
    frequency: null,
    daysOfWeek: [],
    dayOfMonth: null,
    timeHour: 7,
    timeMinute: 0,
    timezone: "America/Chicago",
    ...overrides,
  };
}

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validateBifrostBlueprintAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts no blueprint attachment when transform is disabled", async () => {
    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      transformEnabled: false,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: null,
        blueprintId: null,
        mode: "NONE",
      },
    });
    expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid blueprintVersionId", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: "bv_1",
        blueprintId: null,
        mode: "PINNED_VERSION",
      },
    });
  });

  it("rejects cross-tenant blueprintVersionId values", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      tenantId: "tenant_2",
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Blueprint version not found",
    });
    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "bv_1", tenantId: "tenant_2" },
    }));
  });

  it("rejects unlocked blueprint versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({ isLocked: false }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version must be locked before it can be attached.",
    });
  });

  it("rejects DRAFT parent blueprints", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      blueprint: { scope: "TENANT_PUBLISHED", status: "DRAFT" },
    }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    });
  });

  it("rejects ARCHIVED parent blueprints", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      blueprint: { scope: "TENANT_PUBLISHED", status: "ARCHIVED" },
    }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    });
  });

  it("rejects streaming-incompatible pinned versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      steps: [{ type: "sort" }],
    }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      statefulSteps: ["sort"],
    });
  });

  it("accepts legacy valid blueprintId attachments", async () => {
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint());

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      legacyBlueprintId: "bp_legacy",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: null,
        blueprintId: "bp_legacy",
        mode: "LEGACY_MUTABLE",
      },
    });
  });

  it("rejects legacy DRAFT blueprint attachments", async () => {
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint({ status: "DRAFT" }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      legacyBlueprintId: "bp_legacy",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint must be validated before it can be attached.",
      statefulSteps: undefined,
      suggestion: undefined,
    });
  });

  it("rejects legacy stateful blueprints when transform is enabled", async () => {
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint({
      steps: [{ type: "aggregate" }],
    }));

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      legacyBlueprintId: "bp_legacy",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      statefulSteps: ["aggregate"],
    });
  });

  it("prefers blueprintVersionId when both version and legacy IDs are provided", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

    const result = await validateBifrostBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
      legacyBlueprintId: "bp_legacy",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: "bv_1",
        blueprintId: null,
        mode: "PINNED_VERSION",
      },
    });
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
  });
});

describe("Bifrost route API blueprint version attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockConnectionFindFirst.mockResolvedValue({ id: "conn" });
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({
      transformEnabled: true,
      blueprintId: "bp_legacy",
      blueprintVersionId: null,
    }));
    mockBifrostRouteCreate.mockImplementation(async ({ data }) => ({ id: "route_1", ...data }));
    mockBifrostRouteUpdate.mockImplementation(async ({ data }) => ({ id: "route_1", ...data }));
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint());
  });

  it("Bifrost create stores blueprintVersionId and clears legacy blueprintId", async () => {
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload({ blueprintVersionId: "bv_1", blueprintId: "bp_legacy" })
    ));

    expect(response.status).toBe(201);
    expect(mockBifrostRouteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintVersionId: "bv_1",
        blueprintId: null,
      }),
    }));
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("Bifrost update stores blueprintVersionId and clears legacy blueprintId", async () => {
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { blueprintVersionId: "bv_1", blueprintId: "bp_legacy" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintVersionId: "bv_1",
        blueprintId: null,
      }),
    }));
  });

  it("Bifrost create rejects invalid blueprintVersionId values", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload({ blueprintVersionId: "bv_missing" })
    ));

    expect(response.status).toBe(404);
    expect(mockBifrostRouteCreate).not.toHaveBeenCalled();
  });

  it("Bifrost update rejects invalid blueprintVersionId values", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { blueprintVersionId: "bv_missing" },
      "PUT"
    ));

    expect(response.status).toBe(404);
    expect(mockBifrostRouteUpdate).not.toHaveBeenCalled();
  });

  it("Bifrost update still supports legacy blueprintId for compatibility", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({
      transformEnabled: true,
      blueprintId: null,
      blueprintVersionId: null,
    }));
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { blueprintId: "bp_legacy" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintVersionId: null,
        blueprintId: "bp_legacy",
      }),
    }));
  });
});
