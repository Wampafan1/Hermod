import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExecutionDeleteMany,
  mockExecutionFindMany,
  mockForgeBlueprintFindMany,
  mockForgeBlueprintFindUnique,
  mockVersionDeleteMany,
  mockVersionFindMany,
} = vi.hoisted(() => ({
  mockExecutionDeleteMany: vi.fn(),
  mockExecutionFindMany: vi.fn(),
  mockForgeBlueprintFindMany: vi.fn(),
  mockForgeBlueprintFindUnique: vi.fn(),
  mockVersionDeleteMany: vi.fn(),
  mockVersionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    forgeBlueprint: {
      findMany: mockForgeBlueprintFindMany,
      findUnique: mockForgeBlueprintFindUnique,
    },
    forgeBlueprintVersion: {
      deleteMany: mockVersionDeleteMany,
      findMany: mockVersionFindMany,
    },
    forgeBlueprintExecution: {
      deleteMany: mockExecutionDeleteMany,
      findMany: mockExecutionFindMany,
    },
  },
}));

import {
  enforceRetentionPolicy,
  pruneBlueprintExecutions,
} from "@/lib/mjolnir/blueprint-versioning";

const originalVersionRetention = process.env.MJOLNIR_VERSION_RETENTION_COUNT;
const originalExecutionRetentionDays = process.env.MJOLNIR_EXECUTION_RETENTION_DAYS;
const originalExecutionRetentionMax = process.env.MJOLNIR_EXECUTION_RETENTION_MAX;

function version(
  versionNumber: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `ver_${versionNumber}`,
    version: versionNumber,
    isLocked: false,
    _count: { executions: 0 },
    ...overrides,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("Mjolnir blueprint version and execution retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv("MJOLNIR_VERSION_RETENTION_COUNT", originalVersionRetention);
    restoreEnv("MJOLNIR_EXECUTION_RETENTION_DAYS", originalExecutionRetentionDays);
    restoreEnv("MJOLNIR_EXECUTION_RETENTION_MAX", originalExecutionRetentionMax);

    mockForgeBlueprintFindUnique.mockResolvedValue({ currentVersion: 5 });
    mockForgeBlueprintFindMany.mockResolvedValue([{ id: "forge_1", currentVersion: 2 }]);
    mockVersionDeleteMany.mockResolvedValue({ count: 0 });
    mockExecutionDeleteMany.mockResolvedValue({ count: 0 });
    mockVersionFindMany.mockResolvedValue([{ id: "ver_2", version: 2 }]);
    mockExecutionFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    restoreEnv("MJOLNIR_VERSION_RETENTION_COUNT", originalVersionRetention);
    restoreEnv("MJOLNIR_EXECUTION_RETENTION_DAYS", originalExecutionRetentionDays);
    restoreEnv("MJOLNIR_EXECUTION_RETENTION_MAX", originalExecutionRetentionMax);
  });

  it("never prunes the current version", async () => {
    mockForgeBlueprintFindUnique.mockResolvedValue({ currentVersion: 2 });
    mockVersionFindMany.mockResolvedValue([
      version(5),
      version(4),
      version(3),
      version(2),
      version(1),
    ]);

    const pruned = await enforceRetentionPolicy("forge_1", {
      retentionCount: 1,
      allowPruneVersionOne: true,
    });

    expect(pruned).toBe(3);
    expect(mockVersionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ver_4", "ver_3", "ver_1"] } },
    });
  });

  it("never prunes locked, executed, or default-protected version 1 records", async () => {
    mockForgeBlueprintFindUnique.mockResolvedValue({ currentVersion: 99 });
    mockVersionFindMany.mockResolvedValue([
      version(6),
      version(5),
      version(4, { isLocked: true }),
      version(3, { _count: { executions: 1 } }),
      version(2),
      version(1),
    ]);

    const pruned = await enforceRetentionPolicy("forge_1", { retentionCount: 1 });

    expect(pruned).toBe(2);
    expect(mockVersionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ver_5", "ver_2"] } },
    });
  });

  it("respects the version retention count environment override", async () => {
    process.env.MJOLNIR_VERSION_RETENTION_COUNT = "2";
    mockForgeBlueprintFindUnique.mockResolvedValue({ currentVersion: 99 });
    mockVersionFindMany.mockResolvedValue([
      version(5),
      version(4),
      version(3),
      version(2),
      version(1),
    ]);

    const pruned = await enforceRetentionPolicy("forge_1", {
      allowPruneVersionOne: true,
    });

    expect(pruned).toBe(3);
    expect(mockVersionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ver_3", "ver_2", "ver_1"] } },
    });
  });

  it("does not delete RUNNING executions", async () => {
    await pruneBlueprintExecutions({
      blueprintId: "forge_1",
      olderThanDays: 30,
      maxRecordsPerBlueprint: 10,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    expect(mockExecutionFindMany).toHaveBeenCalled();
    for (const call of mockExecutionFindMany.mock.calls) {
      expect(call[0].where.status).toEqual({ not: "RUNNING" });
    }
    expect(mockExecutionDeleteMany).not.toHaveBeenCalled();
  });

  it("prunes old completed executions while protecting current and locked versions", async () => {
    mockVersionFindMany.mockResolvedValue([
      { id: "ver_2", version: 2 },
      { id: "ver_3", version: 3 },
    ]);
    mockExecutionFindMany
      .mockResolvedValueOnce([{ id: "exec_old" }])
      .mockResolvedValueOnce([]);

    const pruned = await pruneBlueprintExecutions({
      blueprintId: "forge_1",
      olderThanDays: 30,
      maxRecordsPerBlueprint: 10,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    expect(pruned).toBe(1);
    expect(mockExecutionFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        blueprintId: "forge_1",
        completedAt: { lt: new Date("2026-04-09T00:00:00.000Z") },
        status: { not: "RUNNING" },
      },
      take: 500,
    });
    expect(mockExecutionFindMany.mock.calls[0][0].where.AND).toEqual([
      {
        OR: [
          { versionId: null },
          { versionId: { notIn: ["ver_2", "ver_3"] } },
        ],
      },
      { versionNumber: { notIn: [2, 3] } },
    ]);
    expect(mockExecutionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["exec_old"] } },
    });
  });

  it("prunes completed executions beyond the per-blueprint max", async () => {
    mockExecutionFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "exec_excess" }])
      .mockResolvedValueOnce([]);

    const pruned = await pruneBlueprintExecutions({
      blueprintId: "forge_1",
      olderThanDays: 180,
      maxRecordsPerBlueprint: 2,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    expect(pruned).toBe(1);
    expect(mockExecutionFindMany.mock.calls[1][0]).toMatchObject({
      skip: 2,
      take: 500,
      where: {
        blueprintId: "forge_1",
        completedAt: { not: null },
        status: { not: "RUNNING" },
      },
    });
    expect(mockExecutionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["exec_excess"] } },
    });
  });

  it("uses bounded batches for execution deletion", async () => {
    mockExecutionFindMany
      .mockResolvedValueOnce([{ id: "exec_1" }, { id: "exec_2" }])
      .mockResolvedValueOnce([{ id: "exec_3" }, { id: "exec_4" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const pruned = await pruneBlueprintExecutions({
      blueprintId: "forge_1",
      olderThanDays: 30,
      maxRecordsPerBlueprint: 10,
      batchSize: 2,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    expect(pruned).toBe(4);
    expect(mockExecutionFindMany.mock.calls.map((call) => call[0].take)).toEqual([2, 2, 2, 2]);
    expect(mockExecutionDeleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["exec_1", "exec_2"] } },
    });
    expect(mockExecutionDeleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["exec_3", "exec_4"] } },
    });
  });
});
