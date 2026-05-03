import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { safeErrorMessage } from "@/lib/async-utils";
import { markInFlightJobsFailed } from "@/lib/worker-shutdown";
import {
  buildJobSingletonKey,
  dueEnabledWhere,
  isStaleRunningLog,
  STALE_MSSQL_BACKUP_RUN_MS,
  STALE_POSTGRES_BACKUP_RUN_MS,
  STALE_ROUTE_LOG_MS,
} from "@/lib/worker-guardrails";

describe("worker scheduling guardrails", () => {
  it("selects due enabled schedules using the requested date field", () => {
    const now = new Date("2026-05-03T12:00:00.000Z");

    expect(dueEnabledWhere("nextRunAt", now)).toEqual({
      enabled: true,
      nextRunAt: { lte: now },
    });
    expect(dueEnabledWhere("nextFullRunAt", now)).toEqual({
      enabled: true,
      nextFullRunAt: { lte: now },
    });
  });

  it("keeps singleton keys stable and non-overlapping for the same ID", () => {
    const id = "same-id";
    const keys = [
      buildJobSingletonKey("report", id),
      buildJobSingletonKey("route", id),
      buildJobSingletonKey("postgres-full", id),
      buildJobSingletonKey("postgres-wal", id),
      buildJobSingletonKey("postgres-restore", id),
      buildJobSingletonKey("mssql-full", id),
      buildJobSingletonKey("mssql-differential", id),
      buildJobSingletonKey("mssql-log", id),
    ];

    expect(keys).toEqual([
      "report-same-id",
      "same-id",
      "backup-full-same-id",
      "backup-wal-same-id",
      "restore-same-id",
      "mssql-full-same-id",
      "mssql-diff-same-id",
      "mssql-log-same-id",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("classifies stale running logs by configured thresholds", () => {
    const now = new Date("2026-05-03T12:00:00.000Z");

    expect(isStaleRunningLog("2026-05-03T11:44:59.000Z", now, STALE_ROUTE_LOG_MS)).toBe(true);
    expect(isStaleRunningLog("2026-05-03T11:45:01.000Z", now, STALE_ROUTE_LOG_MS)).toBe(false);
    expect(isStaleRunningLog("2026-05-03T10:44:59.000Z", now, STALE_POSTGRES_BACKUP_RUN_MS)).toBe(true);
    expect(isStaleRunningLog("2026-05-03T09:54:59.000Z", now, STALE_MSSQL_BACKUP_RUN_MS)).toBe(true);
  });

  it("keeps enqueue calls before schedule advancement in the worker source", () => {
    const workerSource = readFileSync(path.join(process.cwd(), "src/lib/worker.ts"), "utf8").replace(/\r\n/g, "\n");
    const expectBefore = (first: string, second: string) => {
      const firstIndex = workerSource.indexOf(first);
      const secondIndex = workerSource.indexOf(second);
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThanOrEqual(0);
      expect(firstIndex).toBeLessThan(secondIndex);
    };

    expectBefore('await boss.send("send-report"', "await prisma.schedule.update");
    expectBefore('await boss.send("run-route"', "await advanceRouteNextRun(route)");
    expectBefore('await boss.send(\n            "postgres-backup-full"', "data: { nextFullRunAt }");
    expectBefore('await boss.send(\n            "postgres-backup-wal"', "data: { nextWalRunAt }");
  });

  it("redacts failed job errors before worker logging helpers return them", () => {
    const message = safeErrorMessage(new Error("failed password=abc secretAccessKey=def PGPASSWORD=ghi"));

    expect(message).toBe("failed password=[redacted] secretAccessKey=[redacted] PGPASSWORD=[redacted]");
  });

  it("does not mark unrelated jobs failed during shutdown cleanup", async () => {
    const prisma = {
      runLog: { updateMany: vi.fn() },
      routeLog: { updateMany: vi.fn() },
    };

    await markInFlightJobsFailed(prisma);

    expect(prisma.runLog.updateMany).not.toHaveBeenCalled();
    expect(prisma.routeLog.updateMany).not.toHaveBeenCalled();
  });

  it("marks only owned in-flight report and route logs during shutdown cleanup", async () => {
    const prisma = {
      runLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      routeLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await markInFlightJobsFailed(prisma, {
      runLogIds: ["run_1", "run_1"],
      routeLogIds: ["route_log_1"],
    });

    expect(prisma.runLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["run_1"] }, status: "RUNNING" },
    }));
    expect(prisma.routeLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["route_log_1"] }, status: "running" },
    }));
  });
});
