/**
 * Marks all currently-running jobs as failed.
 * Called on SIGTERM/SIGINT before process exit.
 */
export async function markInFlightJobsFailed(prisma: {
  runLog: { updateMany: (args: any) => Promise<{ count: number }> };
  routeLog: { updateMany: (args: any) => Promise<{ count: number }> };
}): Promise<void> {
  const now = new Date();
  const message = "Worker process shut down while job was in flight";

  const [reports, routes] = await Promise.all([
    prisma.runLog.updateMany({
      where: { status: "RUNNING" },
      data: { status: "FAILED", error: message, completedAt: now },
    }),
    prisma.routeLog.updateMany({
      where: { status: "running" },
      data: { status: "failed", error: message, completedAt: now },
    }),
  ]);

  if (reports.count > 0 || routes.count > 0) {
    console.log(
      `[Worker] Shutdown cleanup: marked ${reports.count} report(s) and ${routes.count} route(s) as failed`
    );
  }
}
