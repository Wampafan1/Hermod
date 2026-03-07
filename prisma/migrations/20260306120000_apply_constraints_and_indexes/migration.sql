-- ApplyConstraintsAndIndexes: Adds missing indexes and cleans up legacy DataSource model.
-- onDelete: Restrict constraints for Report→Connection and BifrostRoute→source/dest
-- were already applied by `prisma db push`. This migration covers the remaining drift.

-- 1. Add monthsOfYear column to BifrostRoute (for quarterly scheduling)
ALTER TABLE "BifrostRoute" ADD COLUMN IF NOT EXISTS "monthsOfYear" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- 2. Drop legacy DataSource model (replaced by unified Connection model in commit a2e53d9)
ALTER TABLE "DataSource" DROP CONSTRAINT IF EXISTS "DataSource_userId_fkey";
DROP TABLE IF EXISTS "DataSource";
DROP TYPE IF EXISTS "DataSourceType";

-- 3. Add performance indexes
CREATE INDEX IF NOT EXISTS "BifrostRoute_sourceId_idx" ON "BifrostRoute"("sourceId");
CREATE INDEX IF NOT EXISTS "BifrostRoute_destId_idx" ON "BifrostRoute"("destId");
CREATE INDEX IF NOT EXISTS "HelheimEntry_status_nextRetryAt_idx" ON "HelheimEntry"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "HelheimEntry_status_lastRetriedAt_idx" ON "HelheimEntry"("status", "lastRetriedAt");
CREATE INDEX IF NOT EXISTS "RouteLog_routeId_status_idx" ON "RouteLog"("routeId", "status");
CREATE INDEX IF NOT EXISTS "RunLog_reportId_status_idx" ON "RunLog"("reportId", "status");
