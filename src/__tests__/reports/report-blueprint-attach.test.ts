import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  mockBlueprintFindFirst,
  mockBlueprintVersionFindFirst,
  mockConnectionFindFirst,
  mockReportCreate,
  mockReportFindFirst,
  mockReportUpdate,
} = vi.hoisted(() => ({
  authState: { authorized: true },
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
  mockConnectionFindFirst: vi.fn(),
  mockReportCreate: vi.fn(),
  mockReportFindFirst: vi.fn(),
  mockReportUpdate: vi.fn(),
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
    report: {
      create: mockReportCreate,
      findFirst: mockReportFindFirst,
      update: mockReportUpdate,
    },
  },
}));

import { validateReportBlueprintAttachment } from "@/lib/mjolnir/report-blueprint-attach";

const baseInput = {
  userId: "user_1",
  tenantId: "tenant_1",
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

function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Revenue Report",
    sqlQuery: "select * from revenue",
    connectionId: "conn_1",
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

describe("validateReportBlueprintAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts no blueprint attachment", async () => {
    const result = await validateReportBlueprintAttachment(baseInput);

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

    const result = await validateReportBlueprintAttachment({
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

    const result = await validateReportBlueprintAttachment({
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

    const result = await validateReportBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version must be locked before it can be attached.",
    });
  });

  it("rejects versions whose parent is DRAFT", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      blueprint: {
        scope: "TENANT_PUBLISHED",
        status: "DRAFT",
      },
    }));

    const result = await validateReportBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    });
  });

  it("accepts legacy valid blueprintId attachments", async () => {
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint());

    const result = await validateReportBlueprintAttachment({
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

    const result = await validateReportBlueprintAttachment({
      ...baseInput,
      legacyBlueprintId: "bp_legacy",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint must be validated before it can be attached.",
    });
  });

  it("prefers blueprintVersionId when both version and legacy IDs are provided", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

    const result = await validateReportBlueprintAttachment({
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

describe("report API blueprint version attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockConnectionFindFirst.mockResolvedValue({ id: "conn_1" });
    mockReportFindFirst.mockResolvedValue({
      id: "report_1",
      blueprintId: "bp_legacy",
      blueprintVersionId: null,
    });
    mockReportCreate.mockImplementation(async ({ data }) => ({ id: "report_1", ...data }));
    mockReportUpdate.mockImplementation(async ({ data }) => ({ id: "report_1", ...data }));
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
    mockBlueprintFindFirst.mockResolvedValue(legacyBlueprint());
  });

  it("report create stores blueprintVersionId and clears legacy blueprintId", async () => {
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/reports",
      reportPayload({ blueprintVersionId: "bv_1", blueprintId: "bp_legacy" })
    ));

    expect(response.status).toBe(201);
    expect(mockReportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintVersionId: "bv_1",
        blueprintId: null,
      }),
    }));
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("report update stores blueprintVersionId and clears legacy blueprintId", async () => {
    const { PUT } = await import("@/app/api/reports/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/reports/report_1",
      { blueprintVersionId: "bv_1", blueprintId: "bp_legacy" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockReportUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "report_1" },
      data: expect.objectContaining({
        blueprintVersionId: "bv_1",
        blueprintId: null,
      }),
    }));
  });

  it("report create rejects invalid blueprintVersionId values", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/reports",
      reportPayload({ blueprintVersionId: "bv_missing" })
    ));

    expect(response.status).toBe(404);
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it("report update still supports legacy blueprintId for compatibility", async () => {
    mockReportFindFirst.mockResolvedValue({
      id: "report_1",
      blueprintId: null,
      blueprintVersionId: null,
    });
    const { PUT } = await import("@/app/api/reports/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/reports/report_1",
      { blueprintId: "bp_legacy" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockReportUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blueprintVersionId: null,
        blueprintId: "bp_legacy",
      }),
    }));
  });
});
