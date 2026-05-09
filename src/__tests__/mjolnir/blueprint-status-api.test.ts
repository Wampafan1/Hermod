import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBlueprintCreate,
  mockBlueprintFindFirst,
  mockBlueprintUpdate,
  mockCleanupUser,
} = vi.hoisted(() => ({
  mockBlueprintCreate: vi.fn(),
  mockBlueprintFindFirst: vi.fn(),
  mockBlueprintUpdate: vi.fn(),
  mockCleanupUser: vi.fn(),
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
      create: mockBlueprintCreate,
      findFirst: mockBlueprintFindFirst,
      update: mockBlueprintUpdate,
    },
  },
}));

vi.mock("@/lib/mjolnir/cleanup", () => ({
  cleanupUserTempFiles: mockCleanupUser,
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
    type: "rename_columns",
    confidence: 0.95,
    config: { mapping: { Old: "New" } },
    description: "Rename Old to New",
    ...overrides,
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Lifecycle Blueprint",
    steps: [validStep()],
    ...overrides,
  };
}

function existingBlueprint(status: string) {
  return {
    id: "bp_1",
    userId: "user_1",
    name: "Lifecycle Blueprint",
    status,
    steps: [validStep()],
  };
}

describe("Mjolnir blueprint status API lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlueprintCreate.mockImplementation(async ({ data }) => ({ id: "bp_1", ...data }));
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("DRAFT"));
    mockBlueprintUpdate.mockImplementation(async ({ data }) => ({
      ...existingBlueprint(data.status ?? "DRAFT"),
      ...data,
    }));
    mockCleanupUser.mockResolvedValue(undefined);
  });

  it("creates new blueprints as DRAFT without validation evidence", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/mjolnir/blueprints",
      createPayload()
    ));

    expect(response.status).toBe(201);
    expect(mockBlueprintCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT" }),
    }));
  });

  it("creates VALIDATED blueprints only with passed validation evidence", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/mjolnir/blueprints",
      createPayload({
        status: "VALIDATED",
        validation: { passed: true, overallMatchRate: 0.99 },
      })
    ));

    expect(response.status).toBe(201);
    expect(mockBlueprintCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "VALIDATED" }),
    }));
  });

  it("rejects creating ACTIVE blueprints directly", async () => {
    const { POST } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/mjolnir/blueprints",
      createPayload({
        status: "ACTIVE",
        validation: { passed: true, overallMatchRate: 1 },
      })
    ));

    expect(response.status).toBe(400);
    expect(mockBlueprintCreate).not.toHaveBeenCalled();
  });

  it("allows DRAFT to VALIDATED with validation evidence", async () => {
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("DRAFT"));
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      {
        status: "VALIDATED",
        validation: { passed: true, overallMatchRate: 0.97 },
      },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBlueprintUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "VALIDATED" }),
    }));
  });

  it("allows VALIDATED to ACTIVE", async () => {
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("VALIDATED"));
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      { status: "ACTIVE" },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBlueprintUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ACTIVE" }),
    }));
  });

  it("rejects ARCHIVED to ACTIVE", async () => {
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("ARCHIVED"));
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      { status: "ACTIVE" },
      "PUT"
    ));

    expect(response.status).toBe(400);
    expect(mockBlueprintUpdate).not.toHaveBeenCalled();
  });

  it("demotes ACTIVE to DRAFT when steps change without validation evidence", async () => {
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("ACTIVE"));
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      { steps: [validStep({ description: "Rename changed columns" })] },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBlueprintUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT" }),
    }));
  });

  it("demotes VALIDATED to DRAFT when formatting changes without validation evidence", async () => {
    mockBlueprintFindFirst.mockResolvedValue(existingBlueprint("VALIDATED"));
    const { PUT } = await import("@/app/api/mjolnir/blueprints/[id]/route");

    const response = await PUT(jsonRequest(
      "http://localhost/api/mjolnir/blueprints/bp_1",
      { afterFormatting: { columns: ["A"], headerValues: {} } },
      "PUT"
    ));

    expect(response.status).toBe(200);
    expect(mockBlueprintUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT" }),
    }));
  });
});
