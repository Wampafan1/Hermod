-- Add richer storage target status/access metadata without dropping existing targets.

CREATE TYPE "BackupStorageStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');

CREATE TYPE "BackupStorageAccessMode" AS ENUM (
  'AWS_ASSUME_ROLE',
  'AWS_ACCESS_KEY',
  'AWS_RUNTIME_ROLE',
  'GCP_SERVICE_ACCOUNT_JSON',
  'GCP_WORKLOAD_IDENTITY',
  'GCP_APPLICATION_DEFAULT'
);

ALTER TABLE "BackupStorageTarget"
  ADD COLUMN "accessMode" "BackupStorageAccessMode",
  ADD COLUMN "lastTestedAt" TIMESTAMP(3),
  ADD COLUMN "lastTestResult" JSONB;

UPDATE "BackupStorageTarget"
SET "accessMode" = CASE
  WHEN "provider"::text = 'GCP_GCS' THEN 'GCP_SERVICE_ACCOUNT_JSON'::"BackupStorageAccessMode"
  ELSE 'AWS_ACCESS_KEY'::"BackupStorageAccessMode"
END
WHERE "accessMode" IS NULL;

ALTER TABLE "BackupStorageTarget"
  ALTER COLUMN "accessMode" SET DEFAULT 'AWS_ACCESS_KEY',
  ALTER COLUMN "accessMode" SET NOT NULL;

ALTER TABLE "BackupStorageTarget"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "BackupStorageTarget"
  ALTER COLUMN "status" TYPE "BackupStorageStatus"
  USING CASE
    WHEN "status" = 'ACTIVE' THEN 'ACTIVE'::"BackupStorageStatus"
    WHEN "status" = 'DISABLED' THEN 'DISABLED'::"BackupStorageStatus"
    WHEN "status" = 'ERROR' THEN 'ERROR'::"BackupStorageStatus"
    ELSE 'ERROR'::"BackupStorageStatus"
  END;

ALTER TABLE "BackupStorageTarget"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

CREATE INDEX "BackupStorageTarget_provider_idx" ON "BackupStorageTarget"("provider");
