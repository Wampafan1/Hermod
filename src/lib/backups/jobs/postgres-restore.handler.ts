import { PostgresRestoreStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { PostgresRestoreEngine } from "@/lib/backups/postgres/postgres-restore-engine";

export interface PostgresRestoreJobPayload {
  restoreJobId: string;
}

const RESTORE_TIMEOUT_MS = 60 * 60_000;

export async function handlePostgresRestoreJob(job: { data: PostgresRestoreJobPayload }) {
  const { restoreJobId } = job.data;
  const restoreJob = await prisma.postgresRestoreJob.findUnique({
    where: { id: restoreJobId },
    select: { id: true, status: true, mode: true },
  });

  if (!restoreJob || restoreJob.status !== PostgresRestoreStatus.RUNNING) {
    console.log(`[Niflheim] Skipping restore job ${restoreJobId}: missing or not running`);
    return { status: "skipped", restoreJobId };
  }

  console.log(`[Niflheim] Processing restore job ${restoreJobId} mode=${restoreJob.mode}`);
  const engine = new PostgresRestoreEngine();
  const result = await withTimeout(
    engine.runRestore({ restoreJobId, timeoutMs: RESTORE_TIMEOUT_MS }),
    RESTORE_TIMEOUT_MS + 30_000,
    `PostgreSQL restore ${restoreJobId}`
  );

  console.log(`[Niflheim] Restore job ${restoreJobId} ${result.status}: ${result.bytesDownloaded} bytes`);
  return result;
}
