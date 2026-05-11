import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeStep } from "@/lib/mjolnir/types";
import type { LoadedRoute } from "@/lib/bifrost/engine";

const {
  mockConnectionFindUniqueOrThrow,
  mockBlueprintFindUnique,
  mockBlueprintFindUniqueOrThrow,
  mockBlueprintVersionFindFirst,
  mockForgeBlueprintFindFirst,
  mockForgeBlueprintFindUnique,
  mockForgeBlueprintVersionFindFirst,
  mockRouteLogCreate,
  mockRouteLogUpdate,
  mockRouteLogUpdateMany,
  mockBifrostRouteUpdate,
  mockRealmGateFindUniqueOrThrow,
  mockRealmGateUpdate,
  mockGatePushUpdate,
  mockProviderConnect,
  mockProviderQuery,
  mockProviderExtract,
  mockProviderLoad,
  mockProviderGetSchema,
  mockProviderCreateTable,
  mockProviderMergeInto,
  mockProviderDropTable,
  mockExecuteBlueprint,
  mockValidateBlueprintForStreaming,
  mockCreateAnalyticsSession,
  mockDuckLoadCSV,
  mockDuckLoadExcel,
  mockDuckQuery,
  mockDuckClose,
  mockGetWatermark,
  mockSetWatermark,
  mockRecordExecution,
} = vi.hoisted(() => ({
  mockConnectionFindUniqueOrThrow: vi.fn(),
  mockBlueprintFindUnique: vi.fn(),
  mockBlueprintFindUniqueOrThrow: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
  mockForgeBlueprintFindFirst: vi.fn(),
  mockForgeBlueprintFindUnique: vi.fn(),
  mockForgeBlueprintVersionFindFirst: vi.fn(),
  mockRouteLogCreate: vi.fn(),
  mockRouteLogUpdate: vi.fn(),
  mockRouteLogUpdateMany: vi.fn(),
  mockBifrostRouteUpdate: vi.fn(),
  mockRealmGateFindUniqueOrThrow: vi.fn(),
  mockRealmGateUpdate: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockProviderConnect: vi.fn(),
  mockProviderQuery: vi.fn(),
  mockProviderExtract: vi.fn(),
  mockProviderLoad: vi.fn(),
  mockProviderGetSchema: vi.fn(),
  mockProviderCreateTable: vi.fn(),
  mockProviderMergeInto: vi.fn(),
  mockProviderDropTable: vi.fn(),
  mockExecuteBlueprint: vi.fn(),
  mockValidateBlueprintForStreaming: vi.fn(),
  mockCreateAnalyticsSession: vi.fn(),
  mockDuckLoadCSV: vi.fn(),
  mockDuckLoadExcel: vi.fn(),
  mockDuckQuery: vi.fn(),
  mockDuckClose: vi.fn(),
  mockGetWatermark: vi.fn(),
  mockSetWatermark: vi.fn(),
  mockRecordExecution: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findUniqueOrThrow: mockConnectionFindUniqueOrThrow,
    },
    blueprint: {
      findUnique: mockBlueprintFindUnique,
      findUniqueOrThrow: mockBlueprintFindUniqueOrThrow,
    },
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
      findUnique: mockForgeBlueprintFindUnique,
    },
    forgeBlueprintVersion: {
      findFirst: mockForgeBlueprintVersionFindFirst,
    },
    routeLog: {
      create: mockRouteLogCreate,
      update: mockRouteLogUpdate,
      updateMany: mockRouteLogUpdateMany,
    },
    bifrostRoute: {
      update: mockBifrostRouteUpdate,
    },
    realmGate: {
      findUniqueOrThrow: mockRealmGateFindUniqueOrThrow,
      update: mockRealmGateUpdate,
    },
    gatePush: {
      update: mockGatePushUpdate,
    },
  },
}));

vi.mock("@/lib/providers", () => ({
  getProvider: () => ({
    type: "POSTGRES",
    connect: mockProviderConnect,
    query: mockProviderQuery,
    extract: mockProviderExtract,
    load: mockProviderLoad,
    getSchema: mockProviderGetSchema,
    createTable: mockProviderCreateTable,
    mergeInto: mockProviderMergeInto,
    dropTable: mockProviderDropTable,
    ensureDataset: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn(),
  }),
  toConnectionLike: (conn: { type: string; config?: unknown }) => ({
    type: conn.type,
    config: conn.config ?? {},
    credentials: {},
  }),
}));

vi.mock("@/lib/mjolnir/engine/blueprint-executor", () => ({
  executeBlueprint: mockExecuteBlueprint,
}));

vi.mock("@/lib/bifrost/forge/forge-validator", () => ({
  validateBlueprintForStreaming: mockValidateBlueprintForStreaming,
}));

vi.mock("@/lib/bifrost/helheim/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue("dead_letter_1"),
}));

vi.mock("@/lib/mjolnir/blueprint-versioning", () => ({
  recordExecution: mockRecordExecution,
  completeExecution: vi.fn().mockResolvedValue(undefined),
  computeDataHash: vi.fn().mockReturnValue("data_hash"),
}));

vi.mock("@/lib/sync/watermark", () => ({
  getWatermark: mockGetWatermark,
  setWatermark: mockSetWatermark,
  buildIncrementalClause: vi.fn().mockReturnValue(null),
  extractNewWatermark: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/schedule-utils", () => ({
  calculateNextRun: vi.fn().mockReturnValue(new Date("2026-05-11T12:00:00Z")),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("{}"),
}));

vi.mock("@/lib/duckdb/engine", () => ({
  createAnalyticsSession: mockCreateAnalyticsSession,
}));

import { executeReportPipeline } from "@/lib/report-runner";
import { BifrostEngine } from "@/lib/bifrost/engine";
import { executePush } from "@/lib/gates/push-executor";
import { validateRealmGateBlueprintAttachment } from "@/lib/mjolnir/realm-gate-blueprint-attach";

const pinnedHash = "b".repeat(64);

function steps(marker: string): ForgeStep[] {
  return [
    {
      order: 0,
      type: "rename_columns",
      confidence: 1,
      config: { marker },
      description: `${marker} transform`,
    },
  ];
}

function blueprintVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_1",
    blueprintId: "bp_published",
    tenantId: "tenant_1",
    version: 1,
    steps: steps("pinned"),
    stepsHash: pinnedHash,
    sourceSchema: null,
    afterFormatting: null,
    isLocked: true,
    blueprint: {
      id: "bp_published",
      name: "Published Transform",
      status: "ACTIVE",
      scope: "TENANT_PUBLISHED",
    },
    ...overrides,
  };
}

function legacyBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_legacy",
    name: "Legacy Mutable Transform",
    status: "ACTIVE",
    steps: steps("legacy"),
    sourceSchema: null,
    afterFormatting: null,
    ...overrides,
  };
}

function makeRoute(overrides: Partial<LoadedRoute> = {}): LoadedRoute {
  return {
    id: "route_1",
    name: "Pinned Route",
    enabled: true,
    tenantId: "tenant_1",
    sourceId: "source_1",
    source: {
      id: "source_1",
      type: "POSTGRES",
      config: {},
      credentials: null,
    },
    ravenSatelliteId: null,
    ravenSatellite: null,
    destId: "dest_1",
    dest: {
      id: "dest_1",
      type: "POSTGRES",
      config: {},
      credentials: null,
    },
    sourceConfig: { query: "select * from source_rows" },
    destConfig: {
      dataset: "public",
      table: "dest_rows",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: false,
      chunkSize: 100,
    },
    transformEnabled: false,
    blueprintVersionId: null,
    blueprintId: null,
    lastCheckpoint: null,
    cursorConfig: null,
    needsFullReload: false,
    frequency: null,
    daysOfWeek: [],
    dayOfMonth: null,
    timeHour: 8,
    timeMinute: 0,
    timezone: "America/Chicago",
    ...overrides,
  } as LoadedRoute;
}

async function* chunks(rows: Record<string, unknown>[][]) {
  for (const chunk of rows) {
    yield chunk;
  }
}

function configuredConnection() {
  return {
    id: "conn_1",
    name: "Warehouse",
    type: "POSTGRES",
    config: {},
    credentials: null,
    status: "ACTIVE",
    userId: "user_1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockConnectionFindUniqueOrThrow.mockResolvedValue(configuredConnection());
  mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());
  mockBlueprintFindUnique.mockResolvedValue(legacyBlueprint());
  mockBlueprintFindUniqueOrThrow.mockResolvedValue(legacyBlueprint());
  mockForgeBlueprintFindFirst.mockResolvedValue(null);
  mockForgeBlueprintFindUnique.mockResolvedValue(null);
  mockForgeBlueprintVersionFindFirst.mockResolvedValue(null);
  mockRecordExecution.mockResolvedValue({ id: "exec_1" });

  mockProviderConnect.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
  mockProviderQuery.mockResolvedValue({
    columns: ["id", "value"],
    rows: [{ id: 1, value: "alpha" }],
  });
  mockProviderExtract.mockImplementation(() => chunks([[{ id: 1, value: "alpha" }]]));
  mockProviderLoad.mockResolvedValue({ rowsLoaded: 1, errors: [] });
  mockProviderGetSchema.mockResolvedValue({
    fields: [
      { name: "id", type: "TEXT" },
      { name: "value", type: "TEXT" },
    ],
  });
  mockRouteLogCreate.mockResolvedValue({ id: "route_log_1" });
  mockRouteLogUpdate.mockResolvedValue({});
  mockRouteLogUpdateMany.mockResolvedValue({ count: 0 });
  mockBifrostRouteUpdate.mockResolvedValue({});
  mockRealmGateUpdate.mockResolvedValue({});
  mockGatePushUpdate.mockResolvedValue({});
  mockDuckLoadCSV.mockResolvedValue(undefined);
  mockDuckLoadExcel.mockResolvedValue(undefined);
  mockDuckQuery.mockResolvedValue([
    { ID: "", Value: "held for review" },
    { ID: "2", Value: "safe row" },
  ]);
  mockDuckClose.mockResolvedValue(undefined);
  mockCreateAnalyticsSession.mockResolvedValue({
    loadCSV: mockDuckLoadCSV,
    loadExcel: mockDuckLoadExcel,
    query: mockDuckQuery,
    close: mockDuckClose,
  });

  mockValidateBlueprintForStreaming.mockReturnValue({
    valid: true,
    statefulSteps: [],
    suggestion: null,
  });
  mockExecuteBlueprint.mockImplementation((inputSteps: ForgeStep[], input: { columns: string[]; rows: Record<string, unknown>[] }) => {
    const marker = String(inputSteps[0]?.config?.marker ?? "unknown");
    return {
      columns: [...input.columns, "transform_marker"],
      rows: input.rows.map((row) => ({ ...row, transform_marker: marker })),
      warnings: [],
      metrics: [{
        stepIndex: 0,
        type: inputSteps[0]?.type ?? "unknown",
        rowsIn: input.rows.length,
        rowsOut: input.rows.length,
        durationMs: 0,
      }],
      totalDurationMs: 0,
    };
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("pinned Mjolnir execution consumers", () => {
  describe("Report", () => {
    it("uses BlueprintVersion.steps and records a pinned descriptor", async () => {
      const version = blueprintVersion();
      mockBlueprintVersionFindFirst.mockResolvedValue(version);

      const result = await executeReportPipeline({
        name: "Pinned Report",
        sqlQuery: "select * from source_rows",
        connectionId: "conn_1",
        columnConfig: null,
        formatting: null,
        tenantId: "tenant_1",
        blueprintVersionId: "bv_1",
        blueprintId: "bp_legacy",
      });

      expect(mockBlueprintFindUnique).not.toHaveBeenCalled();
      expect(mockExecuteBlueprint).toHaveBeenCalledWith(
        version.steps,
        expect.objectContaining({ rows: [{ id: 1, value: "alpha" }] })
      );
      expect(result.columns).toEqual(["id", "value", "transform_marker"]);
      expect(result.forgeMetrics).toHaveLength(1);
      expect(result.blueprintExecutionDescriptor).toMatchObject({
        blueprintId: "bp_published",
        blueprintVersionId: "bv_1",
        executionMode: "PINNED_VERSION",
        stepsHash: pinnedHash,
      });
    });

    it("preserves legacy mutable blueprint fallback and descriptor", async () => {
      const result = await executeReportPipeline({
        name: "Legacy Report",
        sqlQuery: "select * from source_rows",
        connectionId: "conn_1",
        columnConfig: null,
        formatting: null,
        blueprintId: "bp_legacy",
      });

      expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
      expect(mockBlueprintFindUnique).toHaveBeenCalledWith({ where: { id: "bp_legacy" } });
      expect(result.columns).toEqual(["id", "value", "transform_marker"]);
      expect(result.forgeMetrics).toHaveLength(1);
      expect(result.blueprintExecutionDescriptor).toMatchObject({
        blueprintId: "bp_legacy",
        blueprintVersionId: null,
        executionMode: "MUTABLE_LEGACY",
      });
      expect(result.blueprintExecutionDescriptor?.stepsHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("fails clearly for wrong-tenant and unlocked pinned versions", async () => {
      mockBlueprintVersionFindFirst.mockResolvedValueOnce(null);

      await expect(executeReportPipeline({
        name: "Wrong Tenant Report",
        sqlQuery: "select * from source_rows",
        connectionId: "conn_1",
        columnConfig: null,
        formatting: null,
        tenantId: "tenant_2",
        blueprintVersionId: "bv_1",
      })).rejects.toThrow("Pinned blueprint version not found for this tenant.");
      expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "bv_1", tenantId: "tenant_2" },
      }));

      mockBlueprintVersionFindFirst.mockResolvedValueOnce(blueprintVersion({ isLocked: false }));

      await expect(executeReportPipeline({
        name: "Unlocked Report",
        sqlQuery: "select * from source_rows",
        connectionId: "conn_1",
        columnConfig: null,
        formatting: null,
        tenantId: "tenant_1",
        blueprintVersionId: "bv_1",
      })).rejects.toThrow("Pinned blueprint version must be locked before execution.");
    });
  });

  describe("Bifrost", () => {
    it("uses BlueprintVersion.steps and records a pinned descriptor", async () => {
      const engine = new BifrostEngine();
      const version = blueprintVersion();
      mockBlueprintVersionFindFirst.mockResolvedValue(version);

      const result = await engine.execute(
        makeRoute({
          transformEnabled: true,
          blueprintVersionId: "bv_1",
          blueprintId: "bp_legacy",
        }),
        "manual"
      );

      expect(result.status).toBe("completed");
      expect(mockBlueprintFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockExecuteBlueprint).toHaveBeenCalledWith(
        version.steps,
        expect.objectContaining({ rows: [{ id: 1, value: "alpha" }] })
      );
      expect(mockProviderLoad).toHaveBeenCalledWith(
        expect.anything(),
        [{ id: 1, value: "alpha", transform_marker: "pinned" }],
        expect.objectContaining({ table: "dest_rows" })
      );
      expect(result.blueprintExecutionDescriptor).toMatchObject({
        blueprintId: "bp_published",
        blueprintVersionId: "bv_1",
        executionMode: "PINNED_VERSION",
        stepsHash: pinnedHash,
      });
    });

    it("preserves legacy mutable blueprint fallback and descriptor", async () => {
      const engine = new BifrostEngine();

      const result = await engine.execute(
        makeRoute({
          transformEnabled: true,
          blueprintId: "bp_legacy",
        }),
        "manual"
      );

      expect(result.status).toBe("completed");
      expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
      expect(mockBlueprintFindUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "bp_legacy" },
      }));
      expect(mockProviderLoad).toHaveBeenCalledWith(
        expect.anything(),
        [{ id: 1, value: "alpha", transform_marker: "legacy" }],
        expect.objectContaining({ table: "dest_rows" })
      );
      expect(result.blueprintExecutionDescriptor).toMatchObject({
        blueprintId: "bp_legacy",
        blueprintVersionId: null,
        executionMode: "MUTABLE_LEGACY",
      });
      expect(result.blueprintExecutionDescriptor?.stepsHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("fails streaming-incompatible pinned versions before chunk execution", async () => {
      const engine = new BifrostEngine();
      mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
        steps: [{ order: 0, type: "sort_rows", config: {}, description: "Sort" }],
      }));
      mockValidateBlueprintForStreaming.mockReturnValueOnce({
        valid: false,
        statefulSteps: ["sort_rows"],
        suggestion: "Sort in SQL before streaming.",
      });

      const result = await engine.execute(
        makeRoute({
          transformEnabled: true,
          blueprintVersionId: "bv_1",
        }),
        "manual"
      );

      expect(result.status).toBe("failed");
      expect(mockProviderExtract).not.toHaveBeenCalled();
      expect(mockExecuteBlueprint).not.toHaveBeenCalled();
      expect(mockRouteLogUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          error: "Blueprint version contains stateful steps not supported in streaming mode: sort_rows",
        }),
      }));
    });
  });

  describe("RealmGate", () => {
    it("prefers pinned BlueprintVersion attachments over legacy ForgeBlueprint attachments", async () => {
      mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

      const result = await validateRealmGateBlueprintAttachment({
        blueprintVersionId: "bv_1",
        legacyForgeBlueprintId: "forge_legacy",
        userId: "user_1",
        tenantId: "tenant_1",
        forgeEnabled: true,
      });

      expect(result).toEqual({
        ok: true,
        data: {
          blueprintVersionId: "bv_1",
          forgeBlueprintId: null,
          mode: "PINNED_VERSION",
        },
      });
      expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
    });

    it("preserves legacy ForgeBlueprint attachment fallback", async () => {
      mockBlueprintVersionFindFirst.mockResolvedValue(null);
      mockForgeBlueprintFindFirst.mockResolvedValue({
        id: "forge_legacy",
        routeId: "gate_1",
        tenantId: "tenant_1",
        status: "ACTIVE",
        name: "Legacy Forge",
        route: {
          id: "gate_1",
          userId: "user_1",
          tenantId: "tenant_1",
        },
      });

      const result = await validateRealmGateBlueprintAttachment({
        legacyForgeBlueprintId: "forge_legacy",
        userId: "user_1",
        tenantId: "tenant_1",
        forgeEnabled: true,
      });

      expect(result).toEqual({
        ok: true,
        data: {
          blueprintVersionId: null,
          forgeBlueprintId: "forge_legacy",
          mode: "LEGACY_FORGE_BLUEPRINT",
        },
      });
    });

    it("keeps Gate KEY_DRIFT behavior with pinned version metadata present", async () => {
      mockBlueprintVersionFindFirst.mockClear();
      mockForgeBlueprintFindFirst.mockClear();
      mockExecuteBlueprint.mockClear();
      mockRealmGateFindUniqueOrThrow.mockResolvedValue({
        id: "gate_1",
        tenantId: "tenant_1",
        name: "Pinned Gate",
        targetSchema: "public",
        targetTable: "gate_rows",
        mergeStrategy: "UPSERT",
        primaryKeyColumns: ["ID"],
        columnMapping: [
          { sourceColumn: "ID", destinationColumn: "id", sourceType: "string", destType: "TEXT" },
          { sourceColumn: "Value", destinationColumn: "value", sourceType: "string", destType: "TEXT" },
        ],
        forgeEnabled: true,
        blueprintVersionId: "bv_gate",
        forgeBlueprintId: null,
        connection: configuredConnection(),
      });

      const result = await executePush(
        "gate_1",
        "push_1",
        Buffer.from("ID,Value\n,held for review\n2,safe row\n"),
        ".csv"
      );

      expect(result.status).toBe("KEY_DRIFT");
      expect(result.keyDrift).toMatchObject({
        driftType: "BLANK_KEY",
        oldKey: ["id"],
        currentKeyStillUniqueForBusinessRows: true,
        recommendedAction: "REVIEW_INCOMPLETE_ROWS",
      });
      expect(mockGatePushUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "push_1" },
        data: expect.objectContaining({
          status: "KEY_DRIFT",
          blankRowsSkipped: 0,
        }),
      }));
      expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
      expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
      expect(mockExecuteBlueprint).not.toHaveBeenCalled();
    });
  });
});
