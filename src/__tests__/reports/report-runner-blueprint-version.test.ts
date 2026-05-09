import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeStep } from "@/lib/mjolnir/types";

const mockQuery = vi.fn();
const mockClose = vi.fn();
const mockConnect = vi.fn();

const {
  mockConnectionFindUniqueOrThrow,
  mockBlueprintFindUnique,
  mockBlueprintVersionFindFirst,
} = vi.hoisted(() => ({
  mockConnectionFindUniqueOrThrow: vi.fn(),
  mockBlueprintFindUnique: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findUniqueOrThrow: mockConnectionFindUniqueOrThrow,
    },
    blueprint: {
      findUnique: mockBlueprintFindUnique,
    },
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
  },
}));

vi.mock("@/lib/providers", () => ({
  getProvider: () => ({
    type: "POSTGRES",
    query: mockQuery,
    connect: mockConnect,
    testConnection: vi.fn(),
  }),
  toConnectionLike: () => ({
    type: "POSTGRES",
    config: { host: "localhost", port: 5432, database: "test" },
    credentials: { password: "pass" },
  }),
}));

import { executeReportPipeline } from "@/lib/report-runner";

const baseInput = {
  name: "Pinned Report",
  sqlQuery: "SELECT * FROM test",
  connectionId: "conn_1",
  columnConfig: null,
  formatting: null,
};

const pinnedHash = "a".repeat(64);

function pinnedSteps(): ForgeStep[] {
  return [
    {
      order: 0,
      type: "filter_rows",
      confidence: 1,
      config: { column: "City", operator: "eq", value: "NYC" },
      description: "Keep NYC rows",
    },
    {
      order: 1,
      type: "remove_columns",
      confidence: 1,
      config: { columns: ["City", "Age"] },
      description: "Remove helper columns",
    },
  ];
}

function blueprintVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_1",
    blueprintId: "bp_published",
    tenantId: "tenant_1",
    version: 1,
    steps: pinnedSteps(),
    stepsHash: pinnedHash,
    sourceSchema: {
      columns: ["Name", "Age", "City"],
      types: { Name: "string", Age: "number", City: "string" },
    },
    afterFormatting: null,
    isLocked: true,
    blueprint: {
      id: "bp_published",
      name: "Published NYC Filter",
      status: "ACTIVE",
      scope: "TENANT_PUBLISHED",
    },
    ...overrides,
  };
}

function legacyBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_legacy",
    name: "Legacy City Remover",
    description: null,
    version: 1,
    steps: [{
      order: 0,
      type: "remove_columns",
      confidence: 1,
      config: { columns: ["City"] },
      description: "Remove city only",
    }],
    sourceSchema: null,
    analysisLog: null,
    beforeSample: null,
    afterSample: null,
    afterFormatting: null,
    status: "ACTIVE",
    userId: "user_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  mockConnectionFindUniqueOrThrow.mockResolvedValue({
    id: "conn_1",
    name: "Test DB",
    type: "POSTGRES",
    config: { host: "localhost", port: 5432, database: "test" },
    credentials: null,
    status: "ACTIVE",
    lastTestedAt: null,
    userId: "user_1",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockConnect.mockResolvedValue({ close: mockClose });
  mockClose.mockResolvedValue(undefined);
  mockQuery.mockResolvedValue({
    columns: ["Name", "Age", "City"],
    rows: [
      { Name: "Alice", Age: 30, City: "NYC" },
      { Name: "Bob", Age: 25, City: "LA" },
      { Name: "Charlie", Age: 35, City: "NYC" },
    ],
  });
  mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
  mockBlueprintFindUnique.mockResolvedValue(legacyBlueprint());
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("report runner pinned BlueprintVersion execution", () => {
  it("uses BlueprintVersion.steps when blueprintVersionId exists", async () => {
    const result = await executeReportPipeline({
      ...baseInput,
      blueprintVersionId: "bv_1",
      tenantId: "tenant_1",
      blueprintId: "bp_legacy",
    });

    expect(result.columns).toEqual(["Name"]);
    expect(result.forgeMetrics).toHaveLength(2);
    expect(result.blueprintExecutionDescriptor).toMatchObject({
      blueprintId: "bp_published",
      blueprintName: "Published NYC Filter",
      blueprintStatus: "ACTIVE",
      blueprintVersionId: "bv_1",
      executionMode: "PINNED_VERSION",
      stepsHash: pinnedHash,
    });
    expect(result.blueprintExecutionDescriptor?.warning).toBeUndefined();
    expect(mockBlueprintFindUnique).not.toHaveBeenCalled();
  });

  it("falls back to legacy blueprintId when no blueprintVersionId exists", async () => {
    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: "bp_legacy",
    });

    expect(result.columns).toEqual(["Name", "Age"]);
    expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
    expect(mockBlueprintFindUnique).toHaveBeenCalledWith({
      where: { id: "bp_legacy" },
    });
    expect(result.blueprintExecutionDescriptor).toMatchObject({
      blueprintId: "bp_legacy",
      blueprintVersionId: null,
      executionMode: "MUTABLE_LEGACY",
    });
    expect(result.blueprintExecutionDescriptor?.warning).toContain("Mutable legacy blueprint execution");
  });

  it("does not load mutable Blueprint.steps when a pinned version exists", async () => {
    await executeReportPipeline({
      ...baseInput,
      blueprintVersionId: "bv_1",
      tenantId: "tenant_1",
      blueprintId: "bp_legacy",
    });

    expect(mockBlueprintFindUnique).not.toHaveBeenCalled();
  });

  it("fails clearly when the pinned version is missing", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    await expect(executeReportPipeline({
      ...baseInput,
      blueprintVersionId: "bv_missing",
      tenantId: "tenant_1",
      blueprintId: "bp_legacy",
    })).rejects.toThrow("Pinned blueprint version not found for this tenant.");
  });

  it("fails clearly when the pinned version is outside the report tenant", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    await expect(executeReportPipeline({
      ...baseInput,
      blueprintVersionId: "bv_1",
      tenantId: "tenant_2",
    })).rejects.toThrow("Pinned blueprint version not found for this tenant.");
    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "bv_1",
        tenantId: "tenant_2",
      },
    }));
  });

  it("fails clearly when the pinned version is unlocked", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({ isLocked: false }));

    await expect(executeReportPipeline({
      ...baseInput,
      blueprintVersionId: "bv_1",
      tenantId: "tenant_1",
    })).rejects.toThrow("Pinned blueprint version must be locked before execution.");
  });
});
