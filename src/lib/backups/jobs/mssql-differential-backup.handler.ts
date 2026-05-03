import { prisma } from "@/lib/db";
import { withTimeout } from "@/lib/async-utils";
import { MssqlBackupEngine } from "@/lib/backups/mssql/mssql-backup-engine";
import type { MssqlBackupJobPayload } from "./mssql-full-backup.handler";

const DIFF_BACKUP_TIMEOUT_MS = 60 * 60_000;

export async function handleMssqlDifferentialBackupJob(job: { data: MssqlBackupJobPayload }) {
  const { policyId, triggeredBy } = job.data;
  const policy = await prisma.mssqlBackupPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, enabled: true, differentialFrequency: true, name: true },
  });
  if (!policy || !policy.enabled || !policy.differentialFrequency) {
    console.log(`[Niflheim:MSSQL] Skipping differential backup for disabled/missing policy ${policyId}`);
    return { status: "skipped", policyId };
  }

  console.log(`[Niflheim:MSSQL] Processing differential backup: policy=${policyId} triggeredBy=${triggeredBy}`);
  const engine = new MssqlBackupEngine();
  const result = await withTimeout(
    engine.runBackup({ policyId, triggeredBy, type: "DIFFERENTIAL", timeoutMs: DIFF_BACKUP_TIMEOUT_MS }),
    DIFF_BACKUP_TIMEOUT_MS + 30_000,
    `SQL Server differential backup ${policyId}`
  );
  console.log(`[Niflheim:MSSQL] Differential backup ${policyId} ${result.status}: ${result.bytesWritten} bytes`);
  return result;
}
