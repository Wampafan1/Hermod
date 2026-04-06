import { prisma } from "@/lib/db";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Finds any RavenJob stuck in 'running' or 'claimed' for more than 24 hours,
 * marks them as errors, and deletes their orphaned ingest chunks.
 *
 * Called lazily from the dashboard GET handler — the database self-heals
 * whenever an admin views the Ravens page.
 */
export async function cleanupStaleJobs(tenantId: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleJobs = await prisma.ravenJob.findMany({
    where: {
      raven: { tenantId },
      status: { in: ["running", "claimed"] },
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true },
  });

  if (staleJobs.length === 0) return 0;

  const jobIds = staleJobs.map((j) => j.id);

  await prisma.$transaction([
    // Delete orphaned chunks first (FK constraint)
    prisma.ravenIngestChunk.deleteMany({ where: { jobId: { in: jobIds } } }),
    // Mark jobs as failed
    prisma.ravenJob.updateMany({
      where: { id: { in: jobIds } },
      data: {
        status: "error",
        completedAt: new Date(),
        result: {
          error:
            "Job timed out: Abandoned by Raven (no completion after 24 hours)",
        },
      },
    }),
  ]);

  return staleJobs.length;
}
