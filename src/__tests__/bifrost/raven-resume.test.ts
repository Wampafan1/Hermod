import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRouteFindUniqueOrThrow,
  mockRavenJobFindUniqueOrThrow,
  mockRouteLogUpdate,
  mockRavenIngestChunkFindMany,
  mockRavenIngestChunkDeleteMany,
  mockBlueprintFindUniqueOrThrow,
  mockBlueprintVersionFindFirst,
  mockGetProvider,
} = vi.hoisted(() => ({
  mockRouteFindUniqueOrThrow: vi.fn(),
  mockRavenJobFindUniqueOrThrow: vi.fn(),
  mockRouteLogUpdate: vi.fn(),
  mockRavenIngestChunkFindMany: vi.fn(),
  mockRavenIngestChunkDeleteMany: vi.fn(),
  mockBlueprintFindUniqueOrThrow: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
  mockGetProvider: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    bifrostRoute: {
      findUniqueOrThrow: mockRouteFindUniqueOrThrow,
      update: vi.fn(),
    },
    ravenJob: {
      findUniqueOrThrow: mockRavenJobFindUniqueOrThrow,
    },
    ravenIngestChunk: {
      findMany: mockRavenIngestChunkFindMany,
      deleteMany: mockRavenIngestChunkDeleteMany,
    },
    routeLog: {
      update: mockRouteLogUpdate,
    },
    blueprint: {
      findUniqueOrThrow: mockBlueprintFindUniqueOrThrow,
    },
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
  },
}));

vi.mock("@/lib/providers", () => ({
  getProvider: mockGetProvider,
  toConnectionLike: (connection: unknown) => connection,
}));

vi.mock("@/lib/bifrost/helheim/dead-letter", () => ({
  enqueueDeadLetter: vi.fn(),
}));

vi.mock("@/lib/mjolnir/engine/blueprint-executor", () => ({
  executeBlueprint: vi.fn(),
}));

vi.mock("@/lib/bifrost/forge/forge-validator", () => ({
  validateBlueprintForStreaming: vi.fn().mockReturnValue({ valid: true, statefulSteps: [] }),
}));

import { executeBlueprint } from "@/lib/mjolnir/engine/blueprint-executor";

function makeRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Raven route",
    enabled: true,
    tenantId: "tenant_1",
    sourceId: null,
    source: null,
    ravenSatelliteId: "raven_1",
    ravenSatellite: {
      id: "raven_1",
      name: "Raven",
      tenantId: "tenant_1",
      connections: [],
      lastHeartbeatAt: new Date(),
    },
    destId: "dest_1",
    dest: {
      id: "dest_1",
      type: "BIGQUERY",
      config: {},
      credentials: null,
    },
    sourceConfig: { query: "SELECT * FROM customers" },
    destConfig: {
      dataset: "ds",
      table: "customers",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: false,
    },
    transformEnabled: false,
    blueprintVersionId: null,
    blueprintId: null,
    lastCheckpoint: null,
    cursorConfig: {
      strategy: "timestamp_cursor",
      cursorColumn: "updated_at",
      cursorColumnType: "TIMESTAMP",
      primaryKey: "id",
      confidence: "high",
      reasoning: "test",
      warnings: [],
      candidates: [],
    },
    needsFullReload: false,
    frequency: null,
    daysOfWeek: [],
    dayOfMonth: null,
    timeHour: 7,
    timeMinute: 0,
    timezone: "America/Chicago",
    ...overrides,
  };
}

describe("Raven resume handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteFindUniqueOrThrow.mockResolvedValue(makeRoute());
    mockRavenJobFindUniqueOrThrow.mockResolvedValue({ id: "job_1", status: "success" });
    mockRouteLogUpdate.mockResolvedValue({});
    mockRavenIngestChunkDeleteMany.mockResolvedValue({ count: 0 });
    mockBlueprintVersionFindFirst.mockResolvedValue(null);
    mockBlueprintFindUniqueOrThrow.mockResolvedValue(null);
    mockGetProvider.mockReturnValue({ mergeInto: vi.fn() });
  });

  it("fails before loading incremental routes that require staged MERGE", async () => {
    const { handleRavenResume } = await import("@/lib/bifrost/jobs/raven-resume.handler");

    await handleRavenResume({
      data: {
        routeId: "route_1",
        routeLogId: "log_1",
        ravenJobId: "job_1",
      },
    });

    expect(mockRavenIngestChunkFindMany).not.toHaveBeenCalled();
    expect(mockRouteLogUpdate).toHaveBeenCalledWith({
      where: { id: "log_1" },
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("MERGE"),
      }),
    });
  });

  it("fails before loading WRITE_TRUNCATE routes", async () => {
    mockRouteFindUniqueOrThrow.mockResolvedValueOnce(makeRoute({
      cursorConfig: null,
      destConfig: {
        dataset: "ds",
        table: "customers",
        writeDisposition: "WRITE_TRUNCATE",
        autoCreateTable: false,
      },
    }));
    mockGetProvider.mockReturnValueOnce({});

    const { handleRavenResume } = await import("@/lib/bifrost/jobs/raven-resume.handler");

    await handleRavenResume({
      data: {
        routeId: "route_1",
        routeLogId: "log_1",
        ravenJobId: "job_1",
      },
    });

    expect(mockRavenIngestChunkFindMany).not.toHaveBeenCalled();
    expect(mockRouteLogUpdate).toHaveBeenCalledWith({
      where: { id: "log_1" },
      data: expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("WRITE_TRUNCATE"),
      }),
    });
  });

  it("prefers pinned BlueprintVersion steps when resuming a Raven route", async () => {
    const close = vi.fn();
    const load = vi.fn().mockResolvedValue({ rowsLoaded: 1, errors: [] });
    const versionSteps = [{ order: 0, type: "rename_columns", config: { mapping: { value: "Value" } } }];
    mockRouteFindUniqueOrThrow.mockResolvedValueOnce(makeRoute({
      cursorConfig: null,
      transformEnabled: true,
      blueprintVersionId: "bv_1",
      blueprintId: "bp_legacy",
    }));
    mockBlueprintVersionFindFirst.mockResolvedValue({
      id: "bv_1",
      blueprintId: "bp_published",
      tenantId: "tenant_1",
      version: 1,
      steps: versionSteps,
      stepsHash: "a".repeat(64),
      sourceSchema: null,
      afterFormatting: null,
      isLocked: true,
      blueprint: {
        id: "bp_published",
        name: "Published Raven Transform",
        status: "ACTIVE",
        scope: "TENANT_PUBLISHED",
      },
    });
    mockRavenIngestChunkFindMany.mockResolvedValue([
      { data: [{ id: 1, value: "A" }] },
    ]);
    mockGetProvider.mockReturnValue({
      connect: vi.fn().mockResolvedValue({ close }),
      load,
    });
    vi.mocked(executeBlueprint).mockReturnValue({
      columns: [],
      rows: [{ id: 1, Value: "A" }],
      warnings: [],
      metrics: [],
      totalDurationMs: 0,
    });

    const { handleRavenResume } = await import("@/lib/bifrost/jobs/raven-resume.handler");

    await handleRavenResume({
      data: {
        routeId: "route_1",
        routeLogId: "log_1",
        ravenJobId: "job_1",
      },
    });

    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "bv_1", tenantId: "tenant_1" },
    }));
    expect(mockBlueprintFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(vi.mocked(executeBlueprint)).toHaveBeenCalledWith(
      versionSteps,
      expect.objectContaining({ rows: [{ id: 1, value: "A" }] })
    );
    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      [{ id: 1, Value: "A" }],
      expect.objectContaining({ table: "customers" })
    );
    expect(mockRouteLogUpdate).toHaveBeenCalledWith({
      where: { id: "log_1" },
      data: expect.objectContaining({
        status: "completed",
        rowsExtracted: 1,
        rowsLoaded: 1,
      }),
    });
  });
});
