-- AddCursorConfig: Additive-only migration for incremental sync support.
-- Adds cursorConfig column to BifrostRoute and creates PipelineWatermark table.
-- No DROP, no ALTER that removes columns, no modifications to existing data.

-- 1. Add cursorConfig JSON column to BifrostRoute (nullable, no default needed)
ALTER TABLE "BifrostRoute" ADD COLUMN IF NOT EXISTS "cursorConfig" JSONB;

-- 2. Create PipelineWatermark table
CREATE TABLE IF NOT EXISTS "PipelineWatermark" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "watermark" TEXT NOT NULL,
    "watermarkType" TEXT NOT NULL,
    "rowsSynced" INTEGER,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineWatermark_pkey" PRIMARY KEY ("id")
);

-- 3. Create unique constraint on (routeId, tableName)
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineWatermark_routeId_tableName_key"
    ON "PipelineWatermark"("routeId", "tableName");

-- 4. Create index on routeId for fast lookups
CREATE INDEX IF NOT EXISTS "PipelineWatermark_routeId_idx"
    ON "PipelineWatermark"("routeId");

-- 5. Add foreign key to BifrostRoute with CASCADE delete
ALTER TABLE "PipelineWatermark"
    ADD CONSTRAINT "PipelineWatermark_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "BifrostRoute"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
