-- CreateEnum
CREATE TYPE "BackupStorageProvider" AS ENUM ('AWS_S3', 'GCP_GCS', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "BackupPolicyStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEGRADED', 'ERROR');

-- CreateEnum
CREATE TYPE "BackupRunType" AS ENUM ('FULL_LOGICAL', 'FULL_PHYSICAL_BASE', 'WAL_ARCHIVE');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "BackupStorageTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "BackupStorageProvider" NOT NULL,
    "config" JSONB NOT NULL,
    "credentials" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupStorageTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostgresBackupPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceConnectionId" TEXT NOT NULL,
    "storageTargetId" TEXT NOT NULL,
    "backupMode" TEXT NOT NULL DEFAULT 'LOGICAL_WITH_OPTIONAL_WAL',
    "fullFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "walFrequency" TEXT DEFAULT 'HOURLY',
    "timeHour" INTEGER NOT NULL DEFAULT 2,
    "timeMinute" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "nextFullRunAt" TIMESTAMP(3),
    "nextWalRunAt" TIMESTAMP(3),
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "storagePrefix" TEXT,
    "walEnabled" BOOLEAN NOT NULL DEFAULT false,
    "replicationSlot" TEXT,
    "lastSuccessfulFullAt" TIMESTAMP(3),
    "lastSuccessfulWalAt" TIMESTAMP(3),
    "lastError" TEXT,
    "status" "BackupPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostgresBackupPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostgresBackupRun" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "type" "BackupRunType" NOT NULL,
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" TEXT NOT NULL,
    "objectKeys" JSONB,
    "bytesWritten" BIGINT,
    "checksumSha256" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    "userId" TEXT,

    CONSTRAINT "PostgresBackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupStorageTarget_tenantId_idx" ON "BackupStorageTarget"("tenantId");

-- CreateIndex
CREATE INDEX "BackupStorageTarget_userId_idx" ON "BackupStorageTarget"("userId");

-- CreateIndex
CREATE INDEX "PostgresBackupPolicy_tenantId_idx" ON "PostgresBackupPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "PostgresBackupPolicy_userId_idx" ON "PostgresBackupPolicy"("userId");

-- CreateIndex
CREATE INDEX "PostgresBackupPolicy_enabled_nextFullRunAt_idx" ON "PostgresBackupPolicy"("enabled", "nextFullRunAt");

-- CreateIndex
CREATE INDEX "PostgresBackupPolicy_enabled_nextWalRunAt_idx" ON "PostgresBackupPolicy"("enabled", "nextWalRunAt");

-- CreateIndex
CREATE INDEX "PostgresBackupRun_policyId_startedAt_idx" ON "PostgresBackupRun"("policyId", "startedAt");

-- CreateIndex
CREATE INDEX "PostgresBackupRun_tenantId_idx" ON "PostgresBackupRun"("tenantId");

-- CreateIndex
CREATE INDEX "PostgresBackupRun_status_idx" ON "PostgresBackupRun"("status");

-- AddForeignKey
ALTER TABLE "BackupStorageTarget" ADD CONSTRAINT "BackupStorageTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupStorageTarget" ADD CONSTRAINT "BackupStorageTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostgresBackupPolicy" ADD CONSTRAINT "PostgresBackupPolicy_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostgresBackupPolicy" ADD CONSTRAINT "PostgresBackupPolicy_storageTargetId_fkey" FOREIGN KEY ("storageTargetId") REFERENCES "BackupStorageTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostgresBackupPolicy" ADD CONSTRAINT "PostgresBackupPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostgresBackupPolicy" ADD CONSTRAINT "PostgresBackupPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostgresBackupRun" ADD CONSTRAINT "PostgresBackupRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PostgresBackupPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
