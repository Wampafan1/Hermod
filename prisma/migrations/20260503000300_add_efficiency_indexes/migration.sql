-- Targeted indexes for the efficiency audit patch.
-- These support bounded worker polling, Raven polling, SFTP watcher lookups,
-- schedule recipient suggestions, and recent run/log guards.

CREATE INDEX IF NOT EXISTS "idx_sftp_connection_status"
  ON "SftpConnection"("status");

CREATE INDEX IF NOT EXISTS "idx_sftp_connection_user_created"
  ON "SftpConnection"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_email_connection_user_created"
  ON "EmailConnection"("userId", "createdAt" ASC);

CREATE INDEX IF NOT EXISTS "idx_report_user_updated"
  ON "Report"("userId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_recipient_schedule"
  ON "Recipient"("scheduleId");

DROP INDEX IF EXISTS "RunLog_reportId_status_idx";
CREATE INDEX IF NOT EXISTS "idx_run_log_report_status_started"
  ON "RunLog"("reportId", "status", "startedAt" DESC);

DROP INDEX IF EXISTS "RouteLog_routeId_status_idx";
CREATE INDEX IF NOT EXISTS "idx_route_log_route_status_started"
  ON "RouteLog"("routeId", "status", "startedAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_helheim_entry_tenant_status_created"
  ON "HelheimEntry"("tenantId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_helheim_entry_job"
  ON "HelheimEntry"("jobId");

DROP INDEX IF EXISTS "RavenJob_ravenId_status_idx";
CREATE INDEX IF NOT EXISTS "idx_raven_job_polling"
  ON "RavenJob"("ravenId", "status", "priority", "createdAt", "id");

