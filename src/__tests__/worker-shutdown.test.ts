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

  it("marks all RUNNING runLog entries as FAILED", async () => {
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 2 });

    await markInFlightJobsFailed(mockPrisma as any);

    expect(mockPrisma.runLog.updateMany).toHaveBeenCalledWith({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
  });

  it("marks all running routeLog entries as failed", async () => {
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 1 });

    await markInFlightJobsFailed(mockPrisma as any);

    expect(mockPrisma.routeLog.updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: {
        status: "failed",
        error: "Worker process shut down while job was in flight",
        completedAt: expect.any(Date),
      },
    });
  });

  it("runs both updates in parallel", async () => {
    mockPrisma.runLog.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.routeLog.updateMany.mockResolvedValue({ count: 0 });

    await markInFlightJobsFailed(mockPrisma as any);

    expect(mockPrisma.runLog.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.routeLog.updateMany).toHaveBeenCalledTimes(1);
  });
});
