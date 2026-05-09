import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBlueprintFindFirst,
  mockConnectionFindFirst,
  mockReportCreate,
  mockReportFindFirst,
  mockReportUpdate,
  mockBifrostRouteCreate,
  mockBifrostRouteFindFirst,
  mockBifrostRouteUpdate,
  mockRavenSatelliteFindFirst,
} = vi.hoisted(() => ({
  mockBlueprintFindFirst: vi.fn(),
  mockConnectionFindFirst: vi.fn(),
  mockReportCreate: vi.fn(),
  mockReportFindFirst: vi.fn(),
  mockReportUpdate: vi.fn(),
  mockBifrostRouteCreate: vi.fn(),
  mockBifrostRouteFindFirst: vi.fn(),
  mockBifrostRouteUpdate: vi.fn(),
  mockRavenSatelliteFindFirst: vi.fn(),
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
    blueprint: {
      findFirst: mockBlueprintFindFirst,
    },
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    report: {
      create: mockReportCreate,
      findFirst: mockReportFindFirst,
      update: mockReportUpdate,
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

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function blueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_valid",
    userId: "user_1",
    status: "ACTIVE",
    steps: [{ type: "rename_columns" }],
    name: "Valid Blueprint",
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
    blueprintId: "bp_valid",
    ...overrides,
  };
}

function existingRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Existing Route",
    transformEnabled: false,
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

describe("report blueprint attach API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionFindFirst.mockResolvedValue({ id: "conn_1" });
    mockReportFindFirst.mockResolvedValue({ id: "report_1" });
    mockReportCreate.mockImplementation(async ({ data }) => ({ id: "report_1", ...data }));
    mockReportUpdate.mockImplementation(async ({ data }) => ({ id: "report_1", ...data }));
  });

  it("creates reports without a blueprint", async () => {
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest("http://localhost/api/reports", reportPayload()));

    expect(response.status).toBe(201);
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockReportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ blueprintId: null }),
    }));
  });

  it("creates reports with a valid same-user non-archived blueprint", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint());
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/reports",
      reportPayload({ blueprintId: "bp_valid" })
    ));

    expect(response.status).toBe(201);
    expect(mockReportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ blueprintId: "bp_valid" }),
    }));
  });

  it("rejects missing blueprints on report create", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/reports",
      reportPayload({ blueprintId: "bp_missing" })
    ));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Blueprint not found" });
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it("rejects archived blueprints on report create", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));
    const { POST } = await import("@/app/api/reports/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/reports",
      reportPayload({ blueprintId: "bp_valid" })
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Archived blueprints") });
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it("updates reports with a valid blueprint", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint());
    const { PUT } = await import("@/app/api/reports/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/reports/report_1",
      { blueprintId: "bp_valid" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockReportUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "report_1" },
      data: expect.objectContaining({ blueprintId: "bp_valid" }),
    }));
  });

  it("rejects missing blueprints on report update", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/reports/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/reports/report_1",
      { blueprintId: "bp_missing" },
      "PUT"
    ));

    expect(response.status).toBe(404);
    expect(mockReportUpdate).not.toHaveBeenCalled();
  });

  it("rejects archived blueprints on report update", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));
    const { PUT } = await import("@/app/api/reports/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/reports/report_1",
      { blueprintId: "bp_valid" },
      "PUT"
    ));

    expect(response.status).toBe(400);
    expect(mockReportUpdate).not.toHaveBeenCalled();
  });
});

describe("Bifrost blueprint attach API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionFindFirst.mockResolvedValue({ id: "conn" });
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute());
    mockBifrostRouteCreate.mockImplementation(async ({ data }) => ({ id: "route_1", ...data }));
    mockBifrostRouteUpdate.mockImplementation(async ({ data }) => ({ id: "route_1", ...data }));
  });

  it("creates transform routes with a streaming-compatible blueprint", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint());
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload()
    ));

    expect(response.status).toBe(201);
    expect(mockBifrostRouteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        transformEnabled: true,
        blueprintId: "bp_valid",
      }),
    }));
  });

  it("rejects missing blueprints on Bifrost route create", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload({ blueprintId: "bp_missing" })
    ));

    expect(response.status).toBe(404);
    expect(mockBifrostRouteCreate).not.toHaveBeenCalled();
  });

  it("rejects archived blueprints on Bifrost route create", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload()
    ));

    expect(response.status).toBe(400);
    expect(mockBifrostRouteCreate).not.toHaveBeenCalled();
  });

  it("rejects stateful blueprints on Bifrost route create", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ steps: [{ type: "sort" }] }));
    const { POST } = await import("@/app/api/bifrost/routes/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/bifrost/routes",
      routePayload()
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.statefulSteps).toEqual(["sort"]);
    expect(mockBifrostRouteCreate).not.toHaveBeenCalled();
  });

  it("rejects turning transform on with a stateful existing blueprint", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({
      transformEnabled: false,
      blueprintId: "bp_stateful",
    }));
    mockBlueprintFindFirst.mockResolvedValue(blueprint({
      id: "bp_stateful",
      steps: [{ type: "aggregate" }],
    }));
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { transformEnabled: true },
      "PUT"
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.statefulSteps).toEqual(["aggregate"]);
    expect(mockBifrostRouteUpdate).not.toHaveBeenCalled();
  });

  it("rejects changing blueprintId to a stateful blueprint while transform is enabled", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({ transformEnabled: true }));
    mockBlueprintFindFirst.mockResolvedValue(blueprint({
      id: "bp_stateful",
      steps: [{ type: "lookup" }],
    }));
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { blueprintId: "bp_stateful" },
      "PUT"
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.statefulSteps).toEqual(["lookup"]);
    expect(mockBifrostRouteUpdate).not.toHaveBeenCalled();
  });

  it("does not revalidate blueprints for unrelated route updates", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({
      transformEnabled: true,
      blueprintId: "bp_stateful",
    }));
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { name: "Renamed Route" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "Renamed Route" }),
    }));
  });

  it("allows turning transform off while a stateful blueprint remains attached", async () => {
    mockBifrostRouteFindFirst.mockResolvedValue(existingRoute({
      transformEnabled: true,
      blueprintId: "bp_stateful",
    }));
    mockBlueprintFindFirst.mockResolvedValue(blueprint({
      id: "bp_stateful",
      steps: [{ type: "pivot" }],
    }));
    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/bifrost/routes/route_1",
      { transformEnabled: false },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transformEnabled: false }),
    }));
  });
});
