import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBlueprintSchema,
  MAX_AFTER_FORMATTING_JSON_BYTES,
  MAX_ANALYSIS_LOG_JSON_BYTES,
  MAX_BLUEPRINT_STEPS,
  MAX_STEP_CONFIG_JSON_BYTES,
  MAX_UPLOAD_COLUMNS_FOR_ANALYSIS,
  MAX_UPLOAD_ROWS_FOR_ANALYSIS,
  validateParsedFileAnalysisLimits,
} from "@/lib/validations/mjolnir";

const {
  authState,
  mockBlueprintFindMany,
  mockCleanupExpired,
  mockForgeBlueprintFindFirst,
  mockMkdir,
  mockParseExcelBuffer,
  mockRollbackToVersion,
  mockTierGate,
  mockWriteFile,
} = vi.hoisted(() => ({
  authState: { authorized: true },
  mockBlueprintFindMany: vi.fn(),
  mockCleanupExpired: vi.fn(),
  mockForgeBlueprintFindFirst: vi.fn(),
  mockMkdir: vi.fn(),
  mockParseExcelBuffer: vi.fn(),
  mockRollbackToVersion: vi.fn(),
  mockTierGate: vi.fn(),
  mockWriteFile: vi.fn(),
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
      findMany: mockBlueprintFindMany,
    },
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
    },
  },
}));

vi.mock("@/lib/mjolnir/blueprint-versioning", () => ({
  rollbackToVersion: mockRollbackToVersion,
}));

vi.mock("@/lib/mjolnir/cleanup", () => ({
  cleanupExpiredMjolnirTempFiles: mockCleanupExpired,
  getMjolnirUserTempDir: (userId: string) => `C:\\Temp\\hermod-mjolnir\\${userId}`,
}));

vi.mock("@/lib/mjolnir/file-parser", () => ({
  parseExcelBuffer: mockParseExcelBuffer,
}));

vi.mock("@/lib/tier-gate", () => ({
  requireTierFeature: mockTierGate,
}));

vi.mock("fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

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

function deepConfig(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < depth; i++) {
    node = { nested: node };
  }
  return node;
}

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadRequest() {
  const formData = new FormData();
  formData.append("file", new File(["workbook"], "sample.xlsx"));
  return new Request("http://localhost/api/mjolnir/upload", {
    method: "POST",
    body: formData,
  });
}

describe("Mjolnir API validation hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.authorized = true;
    mockBlueprintFindMany.mockResolvedValue([]);
    mockCleanupExpired.mockResolvedValue({ filesDeleted: 0, dirsDeleted: 0 });
    mockForgeBlueprintFindFirst.mockResolvedValue({ id: "forge_bp_1", routeId: "route_1" });
    mockMkdir.mockResolvedValue(undefined);
    mockParseExcelBuffer.mockResolvedValue({
      fileId: "file_1",
      filename: "sample.xlsx",
      columns: ["Old", "New"],
      rowCount: 2,
      sampleRows: [],
    });
    mockRollbackToVersion.mockResolvedValue({
      id: "version_2",
      version: 2,
      changeReason: "Restore stable version",
    });
    mockTierGate.mockResolvedValue(null);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("accepts a valid blueprint create payload", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Valid Blueprint",
      description: "Safe sample transform",
      steps: [validStep()],
      analysisLog: { matchedColumns: [] },
      afterFormatting: { columns: ["New"], headerValues: {} },
    });

    expect(result.success).toBe(true);
  });

  it("rejects too many steps", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Too Many Steps",
      steps: Array.from({ length: MAX_BLUEPRINT_STEPS + 1 }, (_, order) => validStep({ order })),
    });

    expect(result.success).toBe(false);
  });

  it("rejects huge step config JSON", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Huge Step Config",
      steps: [validStep({ config: { payload: "x".repeat(MAX_STEP_CONFIG_JSON_BYTES) } })],
    });

    expect(result.success).toBe(false);
  });

  it("rejects deep step config JSON", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Deep Step Config",
      steps: [validStep({ config: deepConfig(10) })],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid status values", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Invalid Status",
      steps: [validStep()],
      status: "PUBLISHED",
    });

    expect(result.success).toBe(false);
  });

  it("rejects huge analysisLog metadata", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Huge Analysis",
      steps: [validStep()],
      analysisLog: { payload: "x".repeat(MAX_ANALYSIS_LOG_JSON_BYTES) },
    });

    expect(result.success).toBe(false);
  });

  it("rejects huge afterFormatting metadata", () => {
    const result = createBlueprintSchema.safeParse({
      name: "Huge Formatting",
      steps: [validStep()],
      afterFormatting: { payload: "x".repeat(MAX_AFTER_FORMATTING_JSON_BYTES) },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid status query filters", async () => {
    const { GET } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await GET(new Request(
      "http://localhost/api/mjolnir/blueprints?status=VALIDATED,NOPE"
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid blueprint status: NOPE",
    });
    expect(mockBlueprintFindMany).not.toHaveBeenCalled();
  });

  it("rejects empty status query filters", async () => {
    const { GET } = await import("@/app/api/mjolnir/blueprints/route");

    const response = await GET(new Request(
      "http://localhost/api/mjolnir/blueprints?status="
    ));

    expect(response.status).toBe(400);
    expect(mockBlueprintFindMany).not.toHaveBeenCalled();
  });

  it("rejects parsed uploads above row or column caps", async () => {
    expect(validateParsedFileAnalysisLimits({
      columns: ["A"],
      rowCount: MAX_UPLOAD_ROWS_FOR_ANALYSIS + 1,
    })).toMatchObject({ ok: false });
    expect(validateParsedFileAnalysisLimits({
      columns: Array.from({ length: MAX_UPLOAD_COLUMNS_FOR_ANALYSIS + 1 }),
      rowCount: 1,
    })).toMatchObject({ ok: false });
  });

  it("returns 400 when upload parse output exceeds analysis caps", async () => {
    mockParseExcelBuffer.mockResolvedValue({
      fileId: "file_1",
      filename: "sample.xlsx",
      columns: ["A"],
      rowCount: MAX_UPLOAD_ROWS_FOR_ANALYSIS + 1,
      sampleRows: [],
    });
    const { POST } = await import("@/app/api/mjolnir/upload/route");

    const response = await POST(uploadRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("rows"),
    });
  });

  it("rejects rollback invalid bodies", async () => {
    const { POST } = await import("@/app/api/blueprints/[routeId]/rollback/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/blueprints/route_1/rollback",
      { targetVersion: "2" }
    ));

    expect(response.status).toBe(400);
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockRollbackToVersion).not.toHaveBeenCalled();
  });

  it("rejects malformed rollback JSON bodies", async () => {
    const { POST } = await import("@/app/api/blueprints/[routeId]/rollback/route");

    const response = await POST(new Request(
      "http://localhost/api/blueprints/route_1/rollback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Malformed JSON body" });
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockRollbackToVersion).not.toHaveBeenCalled();
  });

  it("rejects rollback reasons above the length limit", async () => {
    const { POST } = await import("@/app/api/blueprints/[routeId]/rollback/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/blueprints/route_1/rollback",
      { targetVersion: 2, reason: "x".repeat(1001) }
    ));

    expect(response.status).toBe(400);
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
    expect(mockRollbackToVersion).not.toHaveBeenCalled();
  });

  it("accepts valid rollback bodies", async () => {
    const { POST } = await import("@/app/api/blueprints/[routeId]/rollback/route");

    const response = await POST(jsonRequest(
      "http://localhost/api/blueprints/route_1/rollback",
      { targetVersion: 2, reason: "Restore stable version" }
    ));

    expect(response.status).toBe(200);
    expect(mockRollbackToVersion).toHaveBeenCalledWith(
      "forge_bp_1",
      2,
      "user_1",
      "Restore stable version"
    );
  });
});
