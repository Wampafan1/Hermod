import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { PostgresBackupEngine } from "@/lib/backups/postgres/postgres-backup-engine";
import { enforceBackupRetention } from "@/lib/backups/retention";

export interface PostgresBackupJobPayload {
  policyId: string;
  triggeredBy: "schedule" | "manual";
  runId?: string;
}

const FULL_BACKUP_TIMEOUT_MS = 60 * 60_000;

export async function handleFullBackupJob(job: { data: PostgresBackupJobPayload }) {
  const { policyId, triggeredBy, runId } = job.data;
  const policy = await prisma.postgresBackupPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, enabled: true, name: true },
  });
  if (!policy || !policy.enabled) {
    console.log(`[Niflheim] Skipping full backup for disabled/missing policy ${policyId}`);
    if (runId) {
      await prisma.postgresBackupRun.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: {
          status: "FAILED",
          error: "Backup policy was disabled or deleted before the job started",
          completedAt: new Date(),
        },
      });
    }
    return { status: "skipped", runId: runId ?? null };
  }

  console.log(`[Niflheim] Processing full backup: policy=${policyId} triggeredBy=${triggeredBy}`);
  const engine = new PostgresBackupEngine();
  const result = await withTimeout(
    engine.runFullBackup({ policyId, triggeredBy, runId, timeoutMs: FULL_BACKUP_TIMEOUT_MS }),
    FULL_BACKUP_TIMEOUT_MS + 30_000,
    `Full backup ${policyId}`
  );

  if (result.status === "SUCCESS") {
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

  console.log(`[Niflheim] Full backup ${policyId} ${result.status}: ${result.bytesWritten} bytes`);
  return result;
}
