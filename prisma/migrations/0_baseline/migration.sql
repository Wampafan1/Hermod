-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'USER', 'ANALYTICS', 'BILLING', 'API_SERVICE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SftpSourceType" AS ENUM ('ADP', 'QUICKBOOKS', 'SAP', 'GENERIC_FILE', 'CUSTOM_SFTP');

-- CreateEnum
CREATE TYPE "FileFormat" AS ENUM ('CSV', 'TSV', 'XLSX');

-- CreateEnum
CREATE TYPE "LoadMode" AS ENUM ('APPEND', 'REPLACE');

-- CreateEnum
CREATE TYPE "SftpStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmailAuthType" AS ENUM ('NONE', 'PLAIN', 'OAUTH2');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('EVERY_15_MIN', 'EVERY_30_MIN', 'HOURLY', 'EVERY_4_HOURS', 'EVERY_12_HOURS', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "BlueprintStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ForgeBlueprintStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('FORGE', 'MANUAL_EDIT', 'ROLLBACK', 'IMPORT');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('POSTGRES', 'MSSQL', 'MYSQL', 'BIGQUERY', 'NETSUITE', 'SFTP', 'REST_API', 'CSV_FILE', 'EXCEL_FILE', 'GOOGLE_SHEETS');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApiAuthType" AS ENUM ('API_KEY', 'BEARER', 'BASIC', 'OAUTH2', 'CUSTOM');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "ext_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "activeTenantId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'loki',
    "planExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SftpConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "SftpSourceType" NOT NULL,
    "sftpHost" TEXT NOT NULL DEFAULT 'localhost',
    "sftpPort" INTEGER NOT NULL DEFAULT 2222,
    "sftpUsername" TEXT NOT NULL,
    "sftpPassword" TEXT NOT NULL,
    "fileFormat" "FileFormat" NOT NULL DEFAULT 'CSV',
    "bqDataset" TEXT NOT NULL,
    "bqTable" TEXT NOT NULL,
    "loadMode" "LoadMode" NOT NULL DEFAULT 'REPLACE',
    "notificationEmails" TEXT[],
    "status" "SftpStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastFileAt" TIMESTAMP(3),
    "lastFileName" TEXT,
    "filesProcessed" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SftpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "authType" "EmailAuthType" NOT NULL DEFAULT 'PLAIN',
    "username" TEXT,
    "password" TEXT,
    "fromAddress" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sqlQuery" TEXT NOT NULL,
    "formatting" JSONB,
    "columnConfig" JSONB,
    "connectionId" TEXT NOT NULL,
    "blueprintId" TEXT,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "ScheduleFrequency" NOT NULL,
    "daysOfWeek" INTEGER[],
    "dayOfMonth" INTEGER,
    "timeHour" INTEGER NOT NULL,
    "timeMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "emailSubject" TEXT NOT NULL DEFAULT '{report_name} ΓÇö {date}',
    "emailBody" TEXT NOT NULL DEFAULT '',
    "monthsOfYear" INTEGER[],
    "emailConnectionId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "pgBossJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "scheduleId" TEXT NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "rowCount" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blueprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "steps" JSONB NOT NULL,
    "sourceSchema" JSONB,
    "analysisLog" JSONB,
    "afterFormatting" JSONB,
    "beforeSample" TEXT,
    "afterSample" TEXT,
    "status" "BlueprintStatus" NOT NULL DEFAULT 'DRAFT',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeBlueprint" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "ForgeBlueprintStatus" NOT NULL DEFAULT 'ACTIVE',
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ForgeBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeBlueprintVersion" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "stepsHash" TEXT NOT NULL,
    "source" "VersionSource" NOT NULL DEFAULT 'FORGE',
    "beforeFileHash" TEXT,
    "afterFileHash" TEXT,
    "aiModelUsed" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "changeReason" TEXT,
    "changeSummary" JSONB,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ForgeBlueprintVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeBlueprintExecution" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "versionId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "jobId" TEXT,
    "routeRunId" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "inputRowCount" INTEGER,
    "outputRowCount" INTEGER,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "errorStep" INTEGER,

    CONSTRAINT "ForgeBlueprintExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ConnectionType" NOT NULL,
    "config" JSONB NOT NULL,
    "credentials" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastTestedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BifrostRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" TEXT NOT NULL,
    "sourceConfig" JSONB NOT NULL,
    "destId" TEXT NOT NULL,
    "destConfig" JSONB NOT NULL,
    "transformEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blueprintId" TEXT,
    "frequency" TEXT,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dayOfMonth" INTEGER,
    "monthsOfYear" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeHour" INTEGER NOT NULL DEFAULT 7,
    "timeMinute" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "nextRunAt" TIMESTAMP(3),
    "lastCheckpoint" TIMESTAMP(3),
    "cursorConfig" JSONB,
    "needsFullReload" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BifrostRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteLog" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowsExtracted" INTEGER,
    "rowsLoaded" INTEGER,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "bytesTransferred" BIGINT,
    "duration" INTEGER,
    "error" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RouteLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelheimEntry" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorDetails" JSONB,
    "payload" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRetriedAt" TIMESTAMP(3),

    CONSTRAINT "HelheimEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineWatermark" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "watermark" TEXT NOT NULL,
    "watermarkType" TEXT NOT NULL,
    "tenantId" TEXT,
    "rowsSynced" INTEGER,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCatalogConnector" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "logoUrl" TEXT,
    "docsUrl" TEXT,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "authType" "ApiAuthType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authConfig" JSONB NOT NULL,
    "pagination" JSONB NOT NULL,
    "rateLimiting" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ApiCatalogConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCatalogObject" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "responseRoot" TEXT NOT NULL,
    "incrementalKey" TEXT,
    "defaultParams" JSONB,
    "schema" JSONB NOT NULL,

    CONSTRAINT "ApiCatalogObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_domain_key" ON "Tenant"("domain");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_idx" ON "TenantMembership"("tenantId");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_userId_tenantId_key" ON "TenantMembership"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_tenantId_idx" ON "Invitation"("tenantId");

-- CreateIndex
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SftpConnection_sftpUsername_key" ON "SftpConnection"("sftpUsername");

-- CreateIndex
CREATE INDEX "SftpConnection_tenantId_idx" ON "SftpConnection"("tenantId");

-- CreateIndex
CREATE INDEX "EmailConnection_tenantId_idx" ON "EmailConnection"("tenantId");

-- CreateIndex
CREATE INDEX "Report_tenantId_idx" ON "Report"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_reportId_key" ON "Schedule"("reportId");

-- CreateIndex
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "RunLog_reportId_status_idx" ON "RunLog"("reportId", "status");

-- CreateIndex
CREATE INDEX "RunLog_startedAt_idx" ON "RunLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForgeBlueprint_routeId_key" ON "ForgeBlueprint"("routeId");

-- CreateIndex
CREATE INDEX "ForgeBlueprint_tenantId_idx" ON "ForgeBlueprint"("tenantId");

-- CreateIndex
CREATE INDEX "ForgeBlueprintVersion_blueprintId_idx" ON "ForgeBlueprintVersion"("blueprintId");

-- CreateIndex
CREATE UNIQUE INDEX "ForgeBlueprintVersion_blueprintId_version_key" ON "ForgeBlueprintVersion"("blueprintId", "version");

-- CreateIndex
CREATE INDEX "ForgeBlueprintExecution_blueprintId_idx" ON "ForgeBlueprintExecution"("blueprintId");

-- CreateIndex
CREATE INDEX "ForgeBlueprintExecution_versionId_idx" ON "ForgeBlueprintExecution"("versionId");

-- CreateIndex
CREATE INDEX "ForgeBlueprintExecution_startedAt_idx" ON "ForgeBlueprintExecution"("startedAt");

-- CreateIndex
CREATE INDEX "Connection_tenantId_idx" ON "Connection"("tenantId");

-- CreateIndex
CREATE INDEX "BifrostRoute_sourceId_idx" ON "BifrostRoute"("sourceId");

-- CreateIndex
CREATE INDEX "BifrostRoute_destId_idx" ON "BifrostRoute"("destId");

-- CreateIndex
CREATE INDEX "BifrostRoute_enabled_nextRunAt_idx" ON "BifrostRoute"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "BifrostRoute_tenantId_idx" ON "BifrostRoute"("tenantId");

-- CreateIndex
CREATE INDEX "RouteLog_routeId_status_idx" ON "RouteLog"("routeId", "status");

-- CreateIndex
CREATE INDEX "RouteLog_routeId_startedAt_idx" ON "RouteLog"("routeId", "startedAt");

-- CreateIndex
CREATE INDEX "HelheimEntry_status_nextRetryAt_idx" ON "HelheimEntry"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "HelheimEntry_status_lastRetriedAt_idx" ON "HelheimEntry"("status", "lastRetriedAt");

-- CreateIndex
CREATE INDEX "HelheimEntry_tenantId_idx" ON "HelheimEntry"("tenantId");

-- CreateIndex
CREATE INDEX "PipelineWatermark_routeId_idx" ON "PipelineWatermark"("routeId");

-- CreateIndex
CREATE INDEX "PipelineWatermark_tenantId_idx" ON "PipelineWatermark"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineWatermark_routeId_tableName_key" ON "PipelineWatermark"("routeId", "tableName");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCatalogConnector_slug_key" ON "ApiCatalogConnector"("slug");

-- CreateIndex
CREATE INDEX "ApiCatalogConnector_category_idx" ON "ApiCatalogConnector"("category");

-- CreateIndex
CREATE INDEX "ApiCatalogConnector_enabled_idx" ON "ApiCatalogConnector"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCatalogObject_connectorId_slug_key" ON "ApiCatalogObject"("connectorId", "slug");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeTenantId_fkey" FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SftpConnection" ADD CONSTRAINT "SftpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SftpConnection" ADD CONSTRAINT "SftpConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunLog" ADD CONSTRAINT "RunLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeBlueprint" ADD CONSTRAINT "ForgeBlueprint_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "BifrostRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeBlueprint" ADD CONSTRAINT "ForgeBlueprint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeBlueprintVersion" ADD CONSTRAINT "ForgeBlueprintVersion_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ForgeBlueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeBlueprintExecution" ADD CONSTRAINT "ForgeBlueprintExecution_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ForgeBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeBlueprintExecution" ADD CONSTRAINT "ForgeBlueprintExecution_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ForgeBlueprintVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BifrostRoute" ADD CONSTRAINT "BifrostRoute_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BifrostRoute" ADD CONSTRAINT "BifrostRoute_destId_fkey" FOREIGN KEY ("destId") REFERENCES "Connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BifrostRoute" ADD CONSTRAINT "BifrostRoute_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BifrostRoute" ADD CONSTRAINT "BifrostRoute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BifrostRoute" ADD CONSTRAINT "BifrostRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteLog" ADD CONSTRAINT "RouteLog_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "BifrostRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelheimEntry" ADD CONSTRAINT "HelheimEntry_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "BifrostRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineWatermark" ADD CONSTRAINT "PipelineWatermark_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "BifrostRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCatalogObject" ADD CONSTRAINT "ApiCatalogObject_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ApiCatalogConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

