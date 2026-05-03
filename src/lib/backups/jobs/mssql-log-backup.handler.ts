import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { MssqlBackupEngine } from "@/lib/backups/mssql/mssql-backup-engine";
import { enforceMssqlBackupRetention } from "@/lib/backups/retention";
import type { MssqlBackupJobPayload } from "./mssql-full-backup.handler";

const LOG_BACKUP_TIMEOUT_MS = 30 * 60_000;

export async function handleMssqlLogBackupJob(job: { data: MssqlBackupJobPayload }) {
  const { policyId, triggeredBy } = job.data;
  const policy = await prisma.mssqlBackupPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, enabled: true, logFrequency: true, name: true },
  });
  if (!policy || !policy.enabled || !policy.logFrequency) {
    console.log(`[Niflheim:MSSQL] Skipping log backup for disabled/missing policy ${policyId}`);
    return { status: "skipped", policyId };
  }

  console.log(`[Niflheim:MSSQL] Processing transaction log backup: policy=${policyId} triggeredBy=${triggeredBy}`);
  const engine = new MssqlBackupEngine();
  const result = await withTimeout(
    engine.runBackup({ policyId, triggeredBy, type: "LOG", timeoutMs: LOG_BACKUP_TIMEOUT_MS }),
    LOG_BACKUP_TIMEOUT_MS + 30_000,
    `SQL Server transaction log backup ${policyId}`
  );
  if (result.succeeded > 0) {
    const retentionErrors = await enforceMssqlBackupRetention(policyId);
    if (retentionErrors.length > 0) {
      console.warn(`[Niflheim:MSSQL] Retention cleanup warning for ${policyId}: ${retentionErrors[0]}`);
    }
  }
  console.log(`[Niflheim:MSSQL] Transaction log backup ${policyId} ${result.status}: ${result.bytesWritten} bytes`);
  return result;
}
