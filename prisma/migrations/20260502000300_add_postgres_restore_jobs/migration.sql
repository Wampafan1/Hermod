-- Add auditable PostgreSQL restore jobs for Niflheim backups.

CREATE TYPE "PostgresRestoreStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TYPE "PostgresRestoreMode" AS ENUM ('LOGICAL_PG_RESTORE', 'PHYSICAL_PITR_PREPARE');

CREATE TABLE "PostgresRestoreJob" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "backupRunId" TEXT,
    "targetConnectionId" TEXT NOT NULL,
    "mode" "PostgresRestoreMode" NOT NULL DEFAULT 'LOGICAL_PG_RESTORE',
    "status" "PostgresRestoreStatus" NOT NULL DEFAULT 'RUNNING',
    "options" JSONB NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "checksumVerified" BOOLEAN NOT NULL DEFAULT false,
    "bytesDownloaded" BIGINT,
    "durationMs" INTEGER,
    "error" TEXT,
    "triggeredByUserId" TEXT NOT NULL,
    "tenantId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PostgresRestoreJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostgresRestoreJob_policyId_idx" ON "PostgresRestoreJob"("policyId");
CREATE INDEX "PostgresRestoreJob_backupRunId_idx" ON "PostgresRestoreJob"("backupRunId");
CREATE INDEX "PostgresRestoreJob_targetConnectionId_idx" ON "PostgresRestoreJob"("targetConnectionId");
CREATE INDEX "PostgresRestoreJob_tenantId_idx" ON "PostgresRestoreJob"("tenantId");
CREATE INDEX "PostgresRestoreJob_status_idx" ON "PostgresRestoreJob"("status");
CREATE INDEX "PostgresRestoreJob_startedAt_idx" ON "PostgresRestoreJob"("startedAt");

ALTER TABLE "PostgresRestoreJob" ADD CONSTRAINT "PostgresRestoreJob_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PostgresBackupPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostgresRestoreJob" ADD CONSTRAINT "PostgresRestoreJob_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "PostgresBackupRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostgresRestoreJob" ADD CONSTRAINT "PostgresRestoreJob_targetConnectionId_fkey" FOREIGN KEY ("targetConnectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostgresRestoreJob" ADD CONSTRAINT "PostgresRestoreJob_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostgresRestoreJob" ADD CONSTRAINT "PostgresRestoreJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
