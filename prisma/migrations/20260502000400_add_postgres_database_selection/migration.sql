ALTER TABLE "PostgresBackupPolicy"
  ADD COLUMN "databaseSelectionMode" TEXT NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "selectedDatabases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "excludedDatabases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "databasePattern" TEXT;
