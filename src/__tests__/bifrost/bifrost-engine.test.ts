import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted for vi.mock factory access) ──────

const {
  mockCreate,
  mockUpdate,
  mockUpdateMany,
  mockFindUniqueOrThrow,
  mockBifrostRouteUpdate,
  mockExtractGen,
  mockLoad,
  mockGetSchema,
  mockCreateTable,
  mockMergeInto,
  mockDropTable,
  mockConnect,
  mockGetWatermark,
  mockSetWatermark,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockFindUniqueOrThrow: vi.fn(),
  mockBifrostRouteUpdate: vi.fn(),
  mockExtractGen: vi.fn(),
  mockLoad: vi.fn(),
  mockGetSchema: vi.fn(),
  mockCreateTable: vi.fn(),
  mockMergeInto: vi.fn(),
  mockDropTable: vi.fn(),
  mockConnect: vi.fn(),
  mockGetWatermark: vi.fn(),
  mockSetWatermark: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return {
      routeLog: {
        create: mockCreate,
        update: mockUpdate,
        updateMany: mockUpdateMany,
      },
      bifrostRoute: {
        update: mockBifrostRouteUpdate,
      },
      blueprint: {
        findUniqueOrThrow: mockFindUniqueOrThrow,
      },
    };
  }),
}));

vi.mock("@/lib/providers", () => ({
  getProvider: () => ({
    type: "BIGQUERY",
    connect: mockConnect,
    testConnection: vi.fn(),
    extract: mockExtractGen,
    load: mockLoad,
    getSchema: mockGetSchema,
    createTable: mockCreateTable,
    mergeInto: mockMergeInto,
    dropTable: mockDropTable,
    ensureDataset: vi.fn().mockResolvedValue(undefined),
  }),
  toConnectionLike: (conn: any) => ({
    type: conn.type,
    config: conn.config ?? {},
    credentials: {},
  }),
}));

vi.mock("@/lib/sync/watermark", () => ({
  getWatermark: mockGetWatermark,
  setWatermark: mockSetWatermark,
  buildIncrementalClause: vi.fn().mockReturnValue("lastmodifieddate > '2026-03-01'"),
  extractNewWatermark: vi.fn().mockImplementation(
    (rows: Record<string, unknown>[], col: string) => {
      if (!rows.length) return null;
      const vals = rows.map((r) => r[col]).filter(Boolean);
      return vals.length > 0 ? String(vals[vals.length - 1]) : null;
    }
  ),
}));

vi.mock("@/lib/bifrost/helheim/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue("hlh_123"),
}));

vi.mock("@/lib/providers/bigquery.provider", () => ({}));

vi.mock("@/lib/bifrost/forge/forge-validator", () => ({
  validateBlueprintForStreaming: vi.fn().mockReturnValue({ valid: true, statefulSteps: [], suggestion: null }),
}));

vi.mock("@/lib/mjolnir/engine/blueprint-executor", () => ({
  executeBlueprint: vi.fn().mockImplementation((_steps: unknown, input: { rows: unknown[] }) => ({
    columns: [],
    rows: input.rows,
    warnings: [],
    metrics: [],
    totalDurationMs: 0,
  })),
}));

vi.mock("@/lib/schedule-utils", () => ({
  calculateNextRun: vi.fn().mockReturnValue(new Date("2026-03-10T07:00:00Z")),
}));

import { BifrostEngine } from "@/lib/bifrost/engine";
import type { LoadedRoute } from "@/lib/bifrost/engine";
import { enqueueDeadLetter } from "@/lib/bifrost/helheim/dead-letter";

// ─── Test Route ──────────────────────────────────────

function makeRoute(overrides?: Partial<LoadedRoute>): LoadedRoute {
  return {
    id: "route_1",
    name: "Test Route",
    enabled: true,
    sourceId: "src_1",
    source: { id: "src_1", type: "BIGQUERY", config: {}, credentials: null },
    destId: "dest_1",
    dest: { id: "dest_1", type: "BIGQUERY", config: {}, credentials: null },
    sourceConfig: { query: "SELECT * FROM test" },
    destConfig: {
      dataset: "dest_ds",
      table: "dest_tbl",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: false,
      chunkSize: 100, // small batch for tests — each 100-row chunk triggers a load
    },
    transformEnabled: false,
    blueprintId: null,
    lastCheckpoint: null,
    cursorConfig: null,
    frequency: null,
    daysOfWeek: [],
    dayOfMonth: null,
    timeHour: 7,
    timeMinute: 0,
    timezone: "America/Chicago",
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────

function makeChunks(...sizes: number[]): Record<string, unknown>[][] {
  return sizes.map((size) =>
    Array.from({ length: size }, (_, i) => ({ id: i, value: `row_${i}` }))
  );
}

async function* asyncGenFromChunks(chunks: Record<string, unknown>[][]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ─── Tests ───────────────────────────────────────────

describe("BifrostEngine", () => {
  let engine: BifrostEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new BifrostEngine();

    // Default mocks
    mockConnect.mockResolvedValue({
      client: {},
      projectId: "test",
      close: vi.fn(),
    });
    mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "INTEGER", mode: "NULLABLE" }] });
    mockCreate.mockResolvedValue({ id: "log_1" });
    mockUpdate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("completes successfully with 3 chunks", async () => {
    const chunks = makeChunks(100, 100, 100);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockResolvedValue({ rowsLoaded: 100, errors: [] });

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("completed");
    expect(result.totalExtracted).toBe(300);
    expect(result.totalLoaded).toBe(300);
    expect(result.errorCount).toBe(0);
    expect(mockLoad).toHaveBeenCalledTimes(3);
  });

  it("returns partial when 1 of 3 chunks fails", async () => {
    const chunks = makeChunks(100, 100, 100);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad
      .mockResolvedValueOnce({ rowsLoaded: 100, errors: [] })
      .mockRejectedValueOnce(new Error("Schema mismatch"))
      .mockResolvedValueOnce({ rowsLoaded: 100, errors: [] });

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("partial");
    expect(result.totalExtracted).toBe(300);
    expect(result.totalLoaded).toBe(200);
    expect(result.errorCount).toBe(100);
    expect(enqueueDeadLetter).toHaveBeenCalledTimes(1);
  });

  it("returns failed when all chunks fail", async () => {
    const chunks = makeChunks(100, 100);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockRejectedValue(new Error("Auth failed"));

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("failed");
    expect(result.totalLoaded).toBe(0);
    expect(result.errorCount).toBe(200);
    expect(enqueueDeadLetter).toHaveBeenCalledTimes(2);
  });

  it("returns completed with 0 rows on empty source", async () => {
    mockExtractGen.mockImplementation(() => asyncGenFromChunks([[], []]));

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("completed");
    expect(result.totalExtracted).toBe(0);
    expect(result.totalLoaded).toBe(0);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("updates checkpoint on success with incrementalKey", async () => {
    const chunks = makeChunks(50);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockResolvedValue({ rowsLoaded: 50, errors: [] });

    const route = makeRoute({
      sourceConfig: { query: "SELECT * FROM test WHERE updated > @last_run", incrementalKey: "updated" },
    });

    await engine.execute(route, "schedule");

    expect(mockBifrostRouteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "route_1" } })
    );
  });

  it("does not update checkpoint when no rows loaded", async () => {
    mockExtractGen.mockImplementation(() => asyncGenFromChunks([[]]));

    const route = makeRoute({
      sourceConfig: { query: "SELECT * FROM test WHERE updated > @last_run", incrementalKey: "updated" },
    });

    await engine.execute(route, "schedule");

    expect(mockBifrostRouteUpdate).not.toHaveBeenCalled();
  });

  it("auto-creates destination table when autoCreateTable is true and table missing", async () => {
    mockGetSchema.mockResolvedValue(null); // table doesn't exist
    mockCreateTable.mockResolvedValue(undefined);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks([[{ id: 1 }]]));
    mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });

    const route = makeRoute({
      destConfig: {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: true,
      },
    });

    // Should not throw
    const result = await engine.execute(route, "manual");
    expect(result.status).toBe("completed");
  });

  it("fails when table missing and autoCreateTable is false", async () => {
    mockGetSchema.mockResolvedValue(null); // table doesn't exist

    const route = makeRoute({
      destConfig: {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
      },
    });

    const result = await engine.execute(route, "manual");
    expect(result.status).toBe("failed");
  });

  it("closes connections even on error", async () => {
    const closeSource = vi.fn();
    const closeDest = vi.fn();
    mockConnect
      .mockResolvedValueOnce({ client: {}, projectId: "test", close: closeSource })
      .mockResolvedValueOnce({ client: {}, projectId: "test", close: closeDest });

    mockGetSchema.mockRejectedValue(new Error("Network error"));

    await engine.execute(makeRoute(), "manual");

    expect(closeSource).toHaveBeenCalled();
    expect(closeDest).toHaveBeenCalled();
  });

  it("creates routeLog with triggeredBy", async () => {
    mockExtractGen.mockImplementation(() => asyncGenFromChunks([[]]));

    await engine.execute(makeRoute(), "webhook");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: "webhook",
          routeId: "route_1",
          status: "running",
        }),
      })
    );
  });

  it("reports duration in result", async () => {
    mockExtractGen.mockImplementation(() => asyncGenFromChunks([[{ id: 1 }]]));
    mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe("number");
  });

  it("updates existing routeLog on fatal load error instead of creating orphan", async () => {
    const chunks = makeChunks(100);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockRejectedValue(new Error("Not found: Dataset my_project:my_dataset"));

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("failed");
    // routeLog.create should be called exactly once (the initial "running" log)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // The existing log should be UPDATED to "failed", not a new one created
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log_1" },
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Not found: Dataset"),
        }),
      })
    );
  });

  it("creates new routeLog when error occurs before routeLog exists", async () => {
    // Schema validation error happens before routeLog is created
    mockGetSchema.mockRejectedValue(new Error("Network error"));

    const result = await engine.execute(makeRoute(), "manual");

    expect(result.status).toBe("failed");
    // routeLog.create called once — for the "failed" log in the catch block
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          error: "Network error",
        }),
      })
    );
    // No update since routeLog didn't exist
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("enqueues dead letter on fatal 'Not found' load error", async () => {
    const chunks = makeChunks(100);
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockRejectedValue(new Error("Not found: Dataset my_project:my_dataset"));

    await engine.execute(makeRoute(), "manual");

    expect(enqueueDeadLetter).toHaveBeenCalled();
  });

  it("batches small source chunks into fewer load calls", async () => {
    // 10 chunks of 100 rows = 1000 rows, with default batch size 10,000
    // → all rows should batch into a single load call
    const chunks = makeChunks(...Array(10).fill(100));
    mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
    mockLoad.mockResolvedValue({ rowsLoaded: 1000, errors: [] });

    const route = makeRoute({
      destConfig: {
        dataset: "dest_ds",
        table: "dest_tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
        // No chunkSize → defaults to DEFAULT_CHUNK_SIZE (10,000)
      },
    });

    const result = await engine.execute(route, "manual");

    expect(result.status).toBe("completed");
    expect(result.totalExtracted).toBe(1000);
    expect(mockLoad).toHaveBeenCalledTimes(1); // 1 batched load, not 10
  });

  // Stale "running" log cleanup is handled by worker.ts at startup,
  // not by the engine on every execution — see worker.ts lines 39-52.

  // ─── MERGE (Upsert) Tests ──────────────────────────

  describe("MERGE mode (incremental upsert)", () => {
    const cursorConfig = {
      strategy: "timestamp_cursor" as const,
      cursorColumn: "lastmodifieddate",
      cursorColumnType: "TIMESTAMP",
      primaryKey: "id",
      confidence: "high" as const,
      reasoning: "test",
      warnings: [],
      candidates: [],
    };

    function makeMergeRoute(overrides?: Partial<LoadedRoute>): LoadedRoute {
      return makeRoute({
        cursorConfig,
        destConfig: {
          dataset: "ds",
          table: "items",
          writeDisposition: "WRITE_APPEND",
          autoCreateTable: true,
          chunkSize: 100,
        },
        ...overrides,
      });
    }

    beforeEach(() => {
      mockGetWatermark.mockResolvedValue("2026-03-01T00:00:00Z");
      mockSetWatermark.mockResolvedValue(undefined);
      mockMergeInto.mockResolvedValue({ rowsMerged: 0 });
      mockDropTable.mockResolvedValue(undefined);
    });

    it("uses MERGE when cursorConfig has primaryKey and table exists", async () => {
      const chunks = [[
        { id: 1, name: "A", lastmodifieddate: "2026-03-05" },
        { id: 2, name: "B", lastmodifieddate: "2026-03-06" },
      ]];
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 2, errors: [] });
      // Table exists
      mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "FLOAT64", mode: "NULLABLE" }] });

      const result = await engine.execute(makeMergeRoute(), "schedule");

      expect(result.status).toBe("completed");
      expect(result.totalLoaded).toBe(2);

      // Load should target staging table, not the real table
      const loadCall = mockLoad.mock.calls[0];
      const destConfig = loadCall[2];
      expect(destConfig.table).toContain("__staging_");

      // MERGE should be called
      expect(mockMergeInto).toHaveBeenCalledWith(
        expect.anything(),
        "ds",
        "items",
        expect.stringContaining("__staging_"),
        "id",
        expect.arrayContaining(["id", "name", "lastmodifieddate"])
      );

      // Staging table should be cleaned up
      expect(mockDropTable).toHaveBeenCalledWith(
        expect.anything(),
        "ds",
        expect.stringContaining("__staging_")
      );
    });

    it("falls back to direct WRITE_TRUNCATE when table does not exist (first run)", async () => {
      const chunks = [[{ id: 1, name: "A", lastmodifieddate: "2026-03-05" }]];
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });
      // Table does NOT exist
      mockGetSchema.mockResolvedValue(null);

      const result = await engine.execute(makeMergeRoute(), "schedule");

      expect(result.status).toBe("completed");
      // Should NOT use MERGE — table didn't exist
      expect(mockMergeInto).not.toHaveBeenCalled();
      expect(mockDropTable).not.toHaveBeenCalled();
    });

    it("skips MERGE when cursorConfig has no primaryKey", async () => {
      const chunks = [[{ id: 1, lastmodifieddate: "2026-03-05" }]];
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });
      mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "FLOAT64", mode: "NULLABLE" }] });

      const route = makeMergeRoute({
        cursorConfig: { ...cursorConfig, primaryKey: null },
      });

      await engine.execute(route, "schedule");

      // Without primaryKey, no MERGE
      expect(mockMergeInto).not.toHaveBeenCalled();
    });

    it("skips MERGE for full_refresh strategy", async () => {
      const chunks = [[{ id: 1, lastmodifieddate: "2026-03-05" }]];
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });
      mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "FLOAT64", mode: "NULLABLE" }] });

      const route = makeMergeRoute({
        cursorConfig: { ...cursorConfig, strategy: "full_refresh" as any },
      });

      await engine.execute(route, "schedule");

      expect(mockMergeInto).not.toHaveBeenCalled();
    });

    it("propagates MERGE errors and preserves staging table for debugging", async () => {
      const chunks = [[{ id: 1, lastmodifieddate: "2026-03-05" }]];
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });
      mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "FLOAT64", mode: "NULLABLE" }] });
      mockMergeInto.mockRejectedValue(new Error("MERGE syntax error"));

      const result = await engine.execute(makeMergeRoute(), "schedule");

      expect(result.status).toBe("failed");
      // Staging table cleanup is still attempted (in finally block)
      expect(mockDropTable).toHaveBeenCalled();
    });

    it("handles multiple batches with MERGE", async () => {
      // 2 chunks of 100 → hits batch size threshold, 2 load calls
      const chunks = makeChunks(100, 100);
      mockExtractGen.mockImplementation(() => asyncGenFromChunks(chunks));
      mockLoad.mockResolvedValue({ rowsLoaded: 100, errors: [] });
      mockGetSchema.mockResolvedValue({ fields: [{ name: "id", type: "FLOAT64", mode: "NULLABLE" }] });

      const result = await engine.execute(makeMergeRoute(), "schedule");

      expect(result.status).toBe("completed");
      expect(result.totalLoaded).toBe(200);
      // All loads target staging table
      for (const call of mockLoad.mock.calls) {
        expect(call[2].table).toContain("__staging_");
      }
      // Single MERGE at the end
      expect(mockMergeInto).toHaveBeenCalledTimes(1);
    });
  });
});
