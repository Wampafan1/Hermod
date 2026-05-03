const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    name: "Test User",
    email: "user@example.test",
    activeTenantId: "tenant_1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: "tenant_1",
    name: "Test Tenant",
    slug: "test-tenant",
    plan: "heimdall",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeTenantMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: "membership_1",
    userId: "user_1",
    tenantId: "tenant_1",
    role: "ADMIN",
    joinedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn_1",
    name: "Warehouse",
    type: "POSTGRES",
    config: {
      host: "db.example.test",
      port: 5432,
      database: "analytics",
      username: "reporter",
      scope: "DATABASE",
      ssl: true,
    },
    credentials: "encrypted-credentials",
    status: "ACTIVE",
    lastTestedAt: null,
    userId: "user_1",
    tenantId: "tenant_1",
    folderId: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeBifrostRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Daily Sync",
    enabled: true,
    sourceId: "conn_1",
    ravenSatelliteId: null,
    sourceConfig: { query: "select 1" },
    destId: "conn_2",
    destConfig: {
      dataset: "public",
      table: "daily_sync",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: true,
    },
    transformEnabled: false,
    blueprintId: null,
    frequency: "DAILY",
    daysOfWeek: [],
    dayOfMonth: null,
    monthsOfYear: [],
    timeHour: 7,
    timeMinute: 0,
    timezone: "America/Chicago",
    nextRunAt: FIXED_DATE,
    lastCheckpoint: null,
    cursorConfig: null,
    needsFullReload: false,
    userId: "user_1",
    tenantId: "tenant_1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeRouteLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_log_1",
    routeId: "route_1",
    status: "completed",
    rowsExtracted: 10,
    rowsLoaded: 10,
    errorCount: 0,
    bytesTransferred: BigInt(2048),
    duration: 1234,
    error: null,
    triggeredBy: "manual",
    startedAt: FIXED_DATE,
    completedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeBackupStorageTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: "storage_1",
    name: "Primary S3",
    provider: "AWS_S3",
    accessMode: "AWS_RUNTIME_ROLE",
    config: {
      bucket: "hermod-backups-test",
      region: "us-east-1",
      prefix: "backups",
      retentionDays: 30,
      encryption: "SSE_S3",
      versioningEnabled: true,
    },
    credentials: null,
    status: "ACTIVE",
    lastTestedAt: null,
    lastTestResult: null,
    userId: "user_1",
    tenantId: "tenant_1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makePostgresBackupPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "pg_policy_1",
    name: "Postgres Policy",
    enabled: true,
    status: "ACTIVE",
    sourceConnectionId: "conn_1",
    storageTargetId: "storage_1",
    fullFrequency: "DAILY",
    walFrequency: "HOURLY",
    timeHour: 2,
    timeMinute: 0,
    timezone: "America/Chicago",
    nextFullRunAt: FIXED_DATE,
    nextWalRunAt: FIXED_DATE,
    retentionDays: 30,
    storagePrefix: "backups",
    storageLayout: "DATABASE_CENTERED",
    databaseSelectionMode: "SINGLE",
    selectedDatabases: ["analytics"],
    excludedDatabases: [],
    databasePattern: null,
    walEnabled: false,
    replicationSlot: null,
    lastSuccessfulFullAt: null,
    lastSuccessfulWalAt: null,
    userId: "user_1",
    tenantId: "tenant_1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeMssqlBackupPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "mssql_policy_1",
    name: "MSSQL Policy",
    enabled: true,
    status: "ACTIVE",
    sourceConnectionId: "conn_mssql",
    storageTargetId: "storage_1",
    destinationMode: "BACKUP_TO_URL",
    databaseSelectionMode: "SINGLE",
    selectedDatabases: ["app"],
    excludedDatabases: [],
    databasePattern: null,
    fullFrequency: "DAILY",
    differentialFrequency: "EVERY_6_HOURS",
    logFrequency: "HOURLY",
    fullTimeHour: 2,
    fullTimeMinute: 0,
    timezone: "America/Chicago",
    nextFullRunAt: FIXED_DATE,
    nextDifferentialRunAt: FIXED_DATE,
    nextLogRunAt: FIXED_DATE,
    urlCredentialName: "hermod_backup_credential",
    urlBase: "https://storage.example.test/backups",
    compressionEnabled: true,
    checksumEnabled: true,
    copyOnly: false,
    verifyAfterBackup: true,
    retentionDays: 30,
    storageLayout: "DATABASE_CENTERED",
    userId: "user_1",
    tenantId: "tenant_1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeBackupRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "backup_run_1",
    policyId: "pg_policy_1",
    type: "FULL_LOGICAL",
    status: "SUCCESS",
    triggeredBy: "manual",
    objectKeys: [{ key: "backups/postgres/server/databases/analytics/full-logical/dump.sql" }],
    bytesWritten: BigInt(4096),
    checksumSha256: "checksum",
    durationMs: 1000,
    error: null,
    startedAt: FIXED_DATE,
    completedAt: FIXED_DATE,
    tenantId: "tenant_1",
    userId: "user_1",
    ...overrides,
  };
}

export function makeRestoreJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "restore_1",
    policyId: "pg_policy_1",
    backupRunId: "backup_run_1",
    targetConnectionId: "conn_restore",
    mode: "LOGICAL_PG_RESTORE",
    status: "RUNNING",
    options: {
      clean: true,
      ifExists: true,
      noOwner: true,
      noPrivileges: true,
      confirmation: "RESTORE restoredb",
    },
    objectKey: "backups/postgres/server/databases/analytics/full-logical/dump.sql",
    checksumSha256: "checksum",
    bytesDownloaded: BigInt(4096),
    error: null,
    triggeredByUserId: "user_1",
    tenantId: "tenant_1",
    startedAt: FIXED_DATE,
    completedAt: null,
    ...overrides,
  };
}

export { FIXED_DATE };
