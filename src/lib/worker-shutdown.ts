interface UpdateManyArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

interface WorkerShutdownPrisma {
  runLog: { updateMany: (args: UpdateManyArgs) => Promise<{ count: number }> };
  routeLog: { updateMany: (args: UpdateManyArgs) => Promise<{ count: number }> };
}

interface InFlightLogIds {
  runLogIds?: string[];
  routeLogIds?: string[];
}

/**
 * Marks only logs known to be owned by this process as failed.
 * Called on SIGTERM/SIGINT before process exit.
 */
export async function markInFlightJobsFailed(
  prisma: WorkerShutdownPrisma,
  inFlight: InFlightLogIds = {}
): Promise<void> {
  const runLogIds = [...new Set(inFlight.runLogIds ?? [])];
  const routeLogIds = [...new Set(inFlight.routeLogIds ?? [])];

  if (runLogIds.length === 0 && routeLogIds.length === 0) {
    console.log("[Worker] Shutdown cleanup: no owned in-flight logs to mark failed");
    return;
  }

  const now = new Date();
  const message = "Worker process shut down while job was in flight";

  const [reports, routes] = await Promise.all([
    runLogIds.length > 0
      ? prisma.runLog.updateMany({
          where: { id: { in: runLogIds }, status: "RUNNING" },
          data: { status: "FAILED", error: message, completedAt: now },
        })
      : Promise.resolve({ count: 0 }),
    routeLogIds.length > 0
      ? prisma.routeLog.updateMany({
          where: { id: { in: routeLogIds }, status: "running" },
          data: { status: "failed", error: message, completedAt: now },
        })
      : Promise.resolve({ count: 0 }),
  ]);

  if (reports.count > 0 || routes.count > 0) {
    console.log(
      `[Worker] Shutdown cleanup: marked ${reports.count} report(s) and ${routes.count} route(s) as failed`
    );
  }
}
