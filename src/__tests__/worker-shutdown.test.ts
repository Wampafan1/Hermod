import { describe, it, expect, vi, beforeEach } from "vitest";
import { markInFlightJobsFailed } from "@/lib/worker-shutdown";

describe("markInFlightJobsFailed", () => {
  const mockPrisma = {
    runLog: { updateMany: vi.fn() },
    routeLog: { updateMany: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 0 });
  });

  it("does not globally mark logs failed when no owned IDs are provided", async () => {
    await markInFlightJobsFailed(mockPrisma);

    expect(mockPrisma.runLog.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.routeLog.updateMany).not.toHaveBeenCalled();
  });

  it("marks only owned RUNNING runLog entries as FAILED", async () => {
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 2 });

    await markInFlightJobsFailed(mockPrisma, {
      runLogIds: ["run-1", "run-1", "run-2"],
    });

    expect(mockPrisma.runLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["run-1", "run-2"] }, status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
    expect(mockPrisma.routeLog.updateMany).not.toHaveBeenCalled();
  });

  it("marks only owned running routeLog entries as failed", async () => {
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 1 });

    await markInFlightJobsFailed(mockPrisma, {
      routeLogIds: ["route-1"],
    });

    expect(mockPrisma.routeLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["route-1"] }, status: "running" },
      data: {
        status: "failed",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
    expect(mockPrisma.runLog.updateMany).not.toHaveBeenCalled();
  });

  it("runs both owned log updates when both ID lists are provided", async () => {
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 0 });

    await markInFlightJobsFailed(mockPrisma, {
      runLogIds: ["run-1"],
      routeLogIds: ["route-1"],
    });

    expect(mockPrisma.runLog.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.routeLog.updateMany).toHaveBeenCalledTimes(1);
  });
});
