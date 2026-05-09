import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  mockBlueprintDelete,
  mockBlueprintFindFirst,
  mockBlueprintUpdate,
  mockReportFindFirst,
  mockReportFindMany,
  mockReportUpdate,
  mockBifrostRouteFindFirst,
  mockBifrostRouteFindMany,
  mockBifrostRouteUpdate,
} = vi.hoisted(() => ({
  authState: { authorized: true, tenantId: "tenant_1" },
  mockBlueprintDelete: vi.fn(),
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintUpdate: vi.fn(),
  mockReportFindFirst: vi.fn(),
  mockReportFindMany: vi.fn(),
  mockReportUpdate: vi.fn(),
  mockBifrostRouteFindFirst: vi.fn(),
  mockBifrostRouteFindMany: vi.fn(),
  mockBifrostRouteUpdate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => {
    if (!authState.authorized) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, {
      userId: "user_1",
      tenantId: authState.tenantId,
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: authState.tenantId } },
    });
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprint: {
      delete: mockBlueprintDelete,
      findFirst: mockBlueprintFindFirst,
      update: mockBlueprintUpdate,
    },
    report: {
      findFirst: mockReportFindFirst,
      findMany: mockReportFindMany,
      update: mockReportUpdate,
    },
    bifrostRoute: {
      findFirst: mockBifrostRouteFindFirst,
      findMany: mockBifrostRouteFindMany,
      update: mockBifrostRouteUpdate,
    },
  },
}));

import { validateAttachableBlueprint } from "@/lib/mjolnir/blueprint-attach";

function request(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function blueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_1",
    userId: "user_1",
    name: "Customer Cleanup",
    status: "ACTIVE",
    steps: [{ type: "rename_columns" }],
    ...overrides,
  };
}

function reportUsage(overrides: Record<string, unknown> = {}) {
  return {
    id: "report_1",
    name: "Revenue Report",
    tenantId: "tenant_1",
    tenant: { name: "Midgard" },
    schedule: { enabled: true },
    updatedAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

function routeUsage(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Customer Sync",
    tenantId: "tenant_1",
    tenant: { name: "Midgard" },
    enabled: true,
    updatedAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Mjolnir blueprint delete/archive safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    authState.tenantId = "tenant_1";
    mockBlueprintFindFirst.mockResolvedValue(blueprint());
    mockBlueprintDelete.mockResolvedValue({ id: "bp_1" });
    mockBlueprintUpdate.mockImplementation(async ({ data }) => ({
      ...blueprint(),
      ...data,
    }));
    mockReportFindMany.mockResolvedValue([]);
    mockBifrostRouteFindMany.mockResolvedValue([]);
    mockReportFindFirst.mockResolvedValue(null);
    mockBifrostRouteFindFirst.mockResolvedValue(null);
    mockReportUpdate.mockResolvedValue({ id: "report_1", blueprintId: null });
    mockBifrostRouteUpdate.mockResolvedValue({ id: "route_1", blueprintId: null });
  });

  it("DELETE unused blueprint succeeds", async () => {
    const { DELETE } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await DELETE(request(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      "DELETE"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockBlueprintDelete).toHaveBeenCalledWith({ where: { id: "bp_1" } });
  });

  it("DELETE in-use blueprint returns 409 with usage summary", async () => {
    mockReportFindMany.mockResolvedValue([reportUsage()]);
    mockBifrostRouteFindMany.mockResolvedValue([routeUsage()]);
    const { DELETE } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await DELETE(request(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      "DELETE"
    ));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Blueprint is in use");
    expect(body.suggestion).toContain("Archive the blueprint");
    expect(body.usage.total).toBe(2);
    expect(body.usage.reports[0]).toMatchObject({
      id: "report_1",
      type: "report",
      name: "Revenue Report",
      tenantId: "tenant_1",
      tenantName: "Midgard",
    });
    expect(body.usage.bifrostRoutes[0]).toMatchObject({
      id: "route_1",
      type: "bifrost_route",
      name: "Customer Sync",
    });
    expect(JSON.stringify(body)).not.toContain("sqlQuery");
    expect(JSON.stringify(body)).not.toContain("sourceConfig");
    expect(mockBlueprintDelete).not.toHaveBeenCalled();
  });

  it("DELETE another user's blueprint returns 404", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await DELETE(request(
      "http://localhost/api/mjolnir/blueprints/bp_other",
      "DELETE"
    ));

    expect(response.status).toBe(404);
    expect(mockReportFindMany).not.toHaveBeenCalled();
    expect(mockBifrostRouteFindMany).not.toHaveBeenCalled();
    expect(mockBlueprintDelete).not.toHaveBeenCalled();
  });

  it("usage endpoint requires ownership and returns usage", async () => {
    mockReportFindMany.mockResolvedValue([reportUsage()]);
    const { GET } = await import("@/app/api/mjolnir/blueprints/[id]/usage/route");

    const response = await GET(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/usage"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(mockBlueprintFindFirst).toHaveBeenCalledWith({
      where: { id: "bp_1", userId: "user_1" },
      select: { id: true },
    });
  });

  it("archive endpoint sets status ARCHIVED", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/archive/route");

    const response = await POST(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/archive",
      "POST"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.blueprint.status).toBe("ARCHIVED");
    expect(body.usage.total).toBe(0);
    expect(mockBlueprintUpdate).toHaveBeenCalledWith({
      where: { id: "bp_1" },
      data: { status: "ARCHIVED" },
    });
    expect(mockBlueprintDelete).not.toHaveBeenCalled();
  });

  it("archive endpoint is idempotent for already archived blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/archive/route");

    const response = await POST(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/archive",
      "POST"
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.blueprint.status).toBe("ARCHIVED");
    expect(mockBlueprintUpdate).not.toHaveBeenCalled();
    expect(mockBlueprintDelete).not.toHaveBeenCalled();
  });

  it("existing attach validation rejects archived blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));

    const result = await validateAttachableBlueprint({
      blueprintId: "bp_1",
      userId: "user_1",
      tenantId: "tenant_1",
      context: "report",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Archived blueprints");
    }
  });

  it("detach endpoint only detaches an owned active-tenant report target", async () => {
    mockReportFindFirst.mockResolvedValue({ id: "report_1" });
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/detach/route");

    const response = await POST(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/detach",
      "POST",
      { type: "report", targetId: "report_1" }
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, type: "report", targetId: "report_1" });
    expect(mockReportFindFirst).toHaveBeenCalledWith({
      where: {
        id: "report_1",
        userId: "user_1",
        tenantId: "tenant_1",
        blueprintId: "bp_1",
      },
      select: { id: true },
    });
    expect(mockReportUpdate).toHaveBeenCalledWith({
      where: { id: "report_1" },
      data: { blueprintId: null },
    });
  });

  it("detach endpoint rejects targets outside the active tenant", async () => {
    mockReportFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/detach/route");

    const response = await POST(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/detach",
      "POST",
      { type: "report", targetId: "report_other_tenant" }
    ));

    expect(response.status).toBe(404);
    expect(mockReportUpdate).not.toHaveBeenCalled();
  });

  it("detach endpoint can detach an owned active-tenant Bifrost route target", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue({ id: "route_1" });
    const { POST } = await import("@/app/api/mjolnir/blueprints/[id]/detach/route");

    const response = await POST(request(
      "http://localhost/api/mjolnir/blueprints/bp_1/detach",
      "POST",
      { type: "bifrost_route", targetId: "route_1" }
    ));

    expect(response.status).toBe(200);
    expect(mockBifrostRouteFindFirst).toHaveBeenCalledWith({
      where: {
        id: "route_1",
        userId: "user_1",
        tenantId: "tenant_1",
        blueprintId: "bp_1",
      },
      select: { id: true },
    });
    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith({
      where: { id: "route_1" },
      data: { blueprintId: null },
    });
  });
});
