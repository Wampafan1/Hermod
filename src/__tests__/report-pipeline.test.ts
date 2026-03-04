/**
 * Tests for the shared executeReportPipeline function.
 *
 * These test the blueprint integration point — the core pipeline
 * that connects Mjolnir to the report runner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ForgeStep, BlueprintData } from "@/lib/mjolnir/types";

// ─── Mocks ─────────────────────────────────────────

const mockQuery = vi.fn();
const mockClose = vi.fn();
const mockConnect = vi.fn();

// Mock all external dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findUniqueOrThrow: vi.fn(),
    },
    blueprint: {
      findUnique: vi.fn(),
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

// ─── Tests ─────────────────────────────────────────

import { executeReportPipeline } from "@/lib/report-runner";
import { prisma } from "@/lib/db";

const baseInput = {
  name: "Test Report",
  sqlQuery: "SELECT * FROM test",
  connectionId: "conn_1",
  columnConfig: null,
  formatting: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Mock connection lookup
  vi.mocked(prisma.connection.findUniqueOrThrow).mockResolvedValue({
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
  } as never);

  // Mock provider connect/query
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
});

describe("executeReportPipeline", () => {
  it("executes query and generates Excel without blueprint", async () => {
    const result = await executeReportPipeline(baseInput);

    expect(result.excelBuffer).toBeInstanceOf(Buffer);
    expect(result.excelBuffer.length).toBeGreaterThan(0);
    expect(result.rowCount).toBe(3);
    expect(result.columns).toEqual(["Name", "Age", "City"]);
    expect(result.forgeWarnings).toEqual([]);
    expect(result.forgeMetrics).toEqual([]);
    expect(prisma.connection.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "conn_1" },
    });
    expect(mockConnect).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("skips blueprint when blueprintId is null", async () => {
    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: null,
    });

    expect(result.forgeWarnings).toEqual([]);
    expect(result.forgeMetrics).toEqual([]);
    expect(prisma.blueprint.findUnique).not.toHaveBeenCalled();
  });

  it("applies blueprint transformation to query results", async () => {
    const steps: ForgeStep[] = [
      {
        order: 0,
        type: "filter_rows",
        confidence: 1.0,
        config: { column: "City", operator: "eq", value: "NYC" },
        description: "Keep only NYC rows",
      },
      {
        order: 1,
        type: "remove_columns",
        confidence: 1.0,
        config: { columns: ["City"] },
        description: "Remove City column",
      },
    ];

    vi.mocked(prisma.blueprint.findUnique).mockResolvedValue({
      id: "bp_1",
      name: "NYC Filter",
      description: null,
      version: 1,
      steps: steps as unknown as never,
      sourceSchema: {
        columns: ["Name", "Age", "City"],
        types: { Name: "string", Age: "number", City: "string" },
      } as unknown as never,
      analysisLog: null,
      beforeSample: null,
      afterSample: null,
      status: "ACTIVE",
      userId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: "bp_1",
    });

    // Blueprint filtered to NYC rows (Alice + Charlie) and removed City
    expect(result.columns).toEqual(["Name", "Age"]);
    expect(result.rowCount).toBe(3); // raw query returned 3 rows
    expect(result.forgeMetrics).toHaveLength(2);
    expect(result.forgeMetrics[0].type).toBe("filter_rows");
    expect(result.forgeMetrics[0].rowsIn).toBe(3);
    expect(result.forgeMetrics[0].rowsOut).toBe(2);
    expect(result.forgeMetrics[1].type).toBe("remove_columns");
    expect(result.forgeWarnings).toEqual([]);
  });

  it("warns on blueprint schema mismatch instead of throwing", async () => {
    vi.mocked(prisma.blueprint.findUnique).mockResolvedValue({
      id: "bp_2",
      name: "Bad Schema",
      description: null,
      version: 1,
      steps: [] as unknown as never,
      sourceSchema: {
        columns: ["Name", "Age", "City", "Revenue"],
        types: { Name: "string", Age: "number", City: "string", Revenue: "number" },
      } as unknown as never,
      analysisLog: null,
      beforeSample: null,
      afterSample: null,
      status: "ACTIVE",
      userId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // Should NOT throw — schema mismatch is now a warning
    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: "bp_2",
    });

    expect(result.forgeWarnings).toHaveLength(1);
    expect(result.forgeWarnings[0]).toContain("Schema drift");
    expect(result.forgeWarnings[0]).toContain("Revenue");
  });

  it("skips archived blueprints", async () => {
    vi.mocked(prisma.blueprint.findUnique).mockResolvedValue({
      id: "bp_3",
      name: "Archived",
      description: null,
      version: 1,
      steps: [{ order: 0, type: "remove_columns", confidence: 1.0, config: { columns: ["City"] }, description: "" }] as unknown as never,
      sourceSchema: null,
      analysisLog: null,
      beforeSample: null,
      afterSample: null,
      status: "ARCHIVED",
      userId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: "bp_3",
    });

    // Blueprint is archived — should be skipped, all 3 columns present
    expect(result.columns).toEqual(["Name", "Age", "City"]);
    expect(result.forgeMetrics).toEqual([]);
  });

  it("collects forge warnings from blueprint execution", async () => {
    const steps: ForgeStep[] = [
      {
        order: 0,
        type: "lookup" as ForgeStep["type"],
        confidence: 1.0,
        config: {},
        description: "Unimplemented lookup step",
      },
    ];

    vi.mocked(prisma.blueprint.findUnique).mockResolvedValue({
      id: "bp_4",
      name: "Warning Test",
      description: null,
      version: 1,
      steps: steps as unknown as never,
      sourceSchema: null,
      analysisLog: null,
      beforeSample: null,
      afterSample: null,
      status: "ACTIVE",
      userId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await executeReportPipeline({
      ...baseInput,
      blueprintId: "bp_4",
    });

    expect(result.forgeWarnings).toHaveLength(1);
    expect(result.forgeWarnings[0]).toContain("lookup");
  });

  it("closes connection even on query failure", async () => {
    mockQuery.mockRejectedValue(new Error("Connection refused"));

    await expect(
      executeReportPipeline(baseInput)
    ).rejects.toThrow("Connection refused");

    expect(mockClose).toHaveBeenCalled();
  });
});
