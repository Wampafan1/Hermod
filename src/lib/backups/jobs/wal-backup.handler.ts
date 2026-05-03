import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { PostgresBackupEngine } from "@/lib/backups/postgres/postgres-backup-engine";
import { enforceBackupRetention } from "@/lib/backups/retention";
import type { PostgresBackupJobPayload } from "./full-backup.handler";

const WAL_BACKUP_TIMEOUT_MS = 15 * 60_000;

export async function handleWalBackupJob(job: { data: PostgresBackupJobPayload }) {
  const { policyId, triggeredBy, runId } = job.data;
  const policy = await prisma.postgresBackupPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, enabled: true, walEnabled: true, name: true },
  });
  if (!policy || !policy.enabled || !policy.walEnabled) {
    console.log(`[Niflheim] Skipping WAL archive for disabled/missing policy ${policyId}`);
    if (runId) {
      await prisma.postgresBackupRun.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: {
          status: "FAILED",
          error: "Backup policy was disabled, deleted, or had WAL coverage disabled before the job started",
          completedAt: new Date(),
        },
      });
    }
    return { status: "skipped", runId: runId ?? null };
  }

  console.log(`[Niflheim] Processing WAL archive: policy=${policyId} triggeredBy=${triggeredBy}`);
  const engine = new PostgresBackupEngine();
  const result = await withTimeout(
    engine.runWalArchive({ policyId, triggeredBy, runId, timeoutMs: WAL_BACKUP_TIMEOUT_MS }),
    WAL_BACKUP_TIMEOUT_MS + 30_000,
    `WAL archive ${policyId}`
  );

  if (result.status === "SUCCESS" || result.status === "PARTIAL") {
    try {
      const retentionErrors = await enforceBackupRetention(policyId);
      if (retentionErrors.length > 0) {
        console.warn(`[Niflheim] Retention cleanup warning for ${policyId}: ${retentionErrors[0]}`);
      }
    } catch (error) {
      console.warn(
        `[Niflheim] Retention cleanup warning for ${policyId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  console.log(`[Niflheim] WAL archive ${policyId} ${result.status}: ${result.bytesWritten} bytes`);
  return result;
}
