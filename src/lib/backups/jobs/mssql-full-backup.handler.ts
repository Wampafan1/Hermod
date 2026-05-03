import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { MssqlBackupEngine } from "@/lib/backups/mssql/mssql-backup-engine";
import { enforceMssqlBackupRetention } from "@/lib/backups/retention";

export interface MssqlBackupJobPayload {
  policyId: string;
  triggeredBy: "schedule" | "manual";
}

const FULL_BACKUP_TIMEOUT_MS = 120 * 60_000;

export async function handleMssqlFullBackupJob(job: { data: MssqlBackupJobPayload }) {
  const { policyId, triggeredBy } = job.data;
  const policy = await prisma.mssqlBackupPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, enabled: true, name: true },
  });
  if (!policy || !policy.enabled) {
    console.log(`[Niflheim:MSSQL] Skipping full backup for disabled/missing policy ${policyId}`);
    return { status: "skipped", policyId };
  }

  console.log(`[Niflheim:MSSQL] Processing full backup: policy=${policyId} triggeredBy=${triggeredBy}`);
  const engine = new MssqlBackupEngine();
  const result = await withTimeout(
    engine.runBackup({ policyId, triggeredBy, type: "FULL", timeoutMs: FULL_BACKUP_TIMEOUT_MS }),
    FULL_BACKUP_TIMEOUT_MS + 30_000,
    `SQL Server full backup ${policyId}`
  );
  if (result.succeeded > 0) {
    const retentionErrors = await enforceMssqlBackupRetention(policyId);
    if (retentionErrors.length > 0) {
      console.warn(`[Niflheim:MSSQL] Retention cleanup warning for ${policyId}: ${retentionErrors[0]}`);
    }
  }
  console.log(`[Niflheim:MSSQL] Full backup ${policyId} ${result.status}: ${result.bytesWritten} bytes`);
  return result;
}
