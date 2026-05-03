-- Additive Niflheim SQL Server backup support.

ALTER TYPE "ScheduleFrequency" ADD VALUE IF NOT EXISTS 'EVERY_6_HOURS';

CREATE TYPE "DatabaseEngine" AS ENUM ('POSTGRES', 'MSSQL');

CREATE TYPE "MssqlBackupType" AS ENUM ('FULL', 'DIFFERENTIAL', 'LOG');

CREATE TYPE "MssqlBackupRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

CREATE TYPE "MssqlBackupDestinationMode" AS ENUM (
  'BACKUP_TO_URL',
  'BACKUP_TO_DISK_SHARED_PATH',
  'BACKUP_TO_DISK_SERVER_ONLY',
  'RAVEN_AGENT_BACKUP'
);

CREATE TYPE "MssqlBackupPolicyStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');

CREATE TYPE "DatabaseSelectionMode" AS ENUM ('SINGLE', 'MULTIPLE', 'ALL_USER_DATABASES', 'PATTERN');

CREATE TABLE "MssqlBackupPolicy" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" "MssqlBackupPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceConnectionId" TEXT NOT NULL,
  "storageTargetId" TEXT,
  "destinationMode" "MssqlBackupDestinationMode" NOT NULL,
  "databaseSelectionMode" "DatabaseSelectionMode" NOT NULL DEFAULT 'SINGLE',
  "selectedDatabases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludedDatabases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "databasePattern" TEXT,
  "fullFrequency" TEXT NOT NULL DEFAULT 'DAILY',
  "differentialFrequency" TEXT DEFAULT 'EVERY_6_HOURS',
  "logFrequency" TEXT DEFAULT 'HOURLY',
  "fullTimeHour" INTEGER NOT NULL DEFAULT 2,
  "fullTimeMinute" INTEGER NOT NULL DEFAULT 0,
  "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "nextFullRunAt" TIMESTAMP(3),
  "nextDifferentialRunAt" TIMESTAMP(3),
  "nextLogRunAt" TIMESTAMP(3),
  "backupPath" TEXT,
  "hermodReadablePath" TEXT,
  "urlCredentialName" TEXT,
  "urlBase" TEXT,
  "compressionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "checksumEnabled" BOOLEAN NOT NULL DEFAULT true,
  "copyOnly" BOOLEAN NOT NULL DEFAULT false,
  "verifyAfterBackup" BOOLEAN NOT NULL DEFAULT true,
  "retentionDays" INTEGER NOT NULL DEFAULT 30,
  "lastSuccessfulFullAt" TIMESTAMP(3),
  "lastSuccessfulDiffAt" TIMESTAMP(3),
  "lastSuccessfulLogAt" TIMESTAMP(3),
  "lastError" TEXT,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MssqlBackupPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MssqlBackupRun" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "type" "MssqlBackupType" NOT NULL,
  "status" "MssqlBackupRunStatus" NOT NULL DEFAULT 'RUNNING',
  "triggeredBy" TEXT NOT NULL,
  "databaseName" TEXT,
  "artifactMetadata" JSONB,
  "bytesWritten" BIGINT,
  "checksumSha256" TEXT,
  "durationMs" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "tenantId" TEXT,
  "userId" TEXT,

  CONSTRAINT "MssqlBackupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MssqlBackupPolicy_tenantId_idx" ON "MssqlBackupPolicy"("tenantId");
CREATE INDEX "MssqlBackupPolicy_userId_idx" ON "MssqlBackupPolicy"("userId");
CREATE INDEX "MssqlBackupPolicy_enabled_nextFullRunAt_idx" ON "MssqlBackupPolicy"("enabled", "nextFullRunAt");
CREATE INDEX "MssqlBackupPolicy_enabled_nextDifferentialRunAt_idx" ON "MssqlBackupPolicy"("enabled", "nextDifferentialRunAt");
CREATE INDEX "MssqlBackupPolicy_enabled_nextLogRunAt_idx" ON "MssqlBackupPolicy"("enabled", "nextLogRunAt");

CREATE INDEX "MssqlBackupRun_policyId_startedAt_idx" ON "MssqlBackupRun"("policyId", "startedAt");
CREATE INDEX "MssqlBackupRun_tenantId_idx" ON "MssqlBackupRun"("tenantId");
CREATE INDEX "MssqlBackupRun_status_idx" ON "MssqlBackupRun"("status");
CREATE INDEX "MssqlBackupRun_databaseName_idx" ON "MssqlBackupRun"("databaseName");

ALTER TABLE "MssqlBackupPolicy"
  ADD CONSTRAINT "MssqlBackupPolicy_sourceConnectionId_fkey"
  FOREIGN KEY ("sourceConnectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MssqlBackupPolicy"
  ADD CONSTRAINT "MssqlBackupPolicy_storageTargetId_fkey"
  FOREIGN KEY ("storageTargetId") REFERENCES "BackupStorageTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MssqlBackupPolicy"
  ADD CONSTRAINT "MssqlBackupPolicy_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MssqlBackupPolicy"
  ADD CONSTRAINT "MssqlBackupPolicy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MssqlBackupRun"
  ADD CONSTRAINT "MssqlBackupRun_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "MssqlBackupPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
