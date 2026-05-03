import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRouteFindUniqueOrThrow,
  mockRavenJobFindUniqueOrThrow,
  mockRouteLogUpdate,
  mockRavenIngestChunkFindMany,
  mockGetProvider,
} = vi.hoisted(() => ({
  mockRouteFindUniqueOrThrow: vi.fn(),
  mockRavenJobFindUniqueOrThrow: vi.fn(),
  mockRouteLogUpdate: vi.fn(),
  mockRavenIngestChunkFindMany: vi.fn(),
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
      deleteMany: vi.fn(),
    },
    routeLog: {
      update: mockRouteLogUpdate,
    },
    blueprint: {
      findUniqueOrThrow: vi.fn(),
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
});
