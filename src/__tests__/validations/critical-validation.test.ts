import { describe, expect, it } from "vitest";
import {
  createConnectionSchema,
  updateConnectionSchema,
} from "@/lib/validations/unified-connections";
import {
  createStorageTargetSchema,
  storagePrefixSchema,
  updateStorageTargetSchema,
} from "@/lib/validations/backup-storage";
import {
  createBackupPolicySchema,
  restoreCreateSchema,
  updateBackupPolicySchema,
} from "@/lib/validations/backups";
import {
  createMssqlBackupPolicySchema,
  updateMssqlBackupPolicySchema,
} from "@/lib/validations/mssql-backups";

describe("critical connection validation", () => {
  it("keeps existing PostgreSQL database-scoped configs backward compatible", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "Postgres DB",
      type: "POSTGRES",
      config: {
        host: "db.example.test",
        port: 5432,
        database: "app",
        username: "reporter",
        ssl: true,
      },
      credentials: { password: "test-password" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "DATABASE",
        database: "app",
      });
    }
  });

  it("allows PostgreSQL server-scoped configs without a specific database", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "Postgres Server",
      type: "POSTGRES",
      config: {
        host: "db.example.test",
        port: 5432,
        scope: "SERVER",
        username: "reporter",
        ssl: true,
      },
      credentials: { password: "test-password" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "SERVER",
        maintenanceDatabase: "postgres",
      });
      expect("database" in parsed.data.config).toBe(false);
    }
  });

  it("keeps existing MSSQL database-scoped configs backward compatible", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "SQL Server DB",
      type: "MSSQL",
      config: {
        host: "sql.example.test",
        port: 1433,
        database: "app",
        username: "reporter",
        encrypt: true,
      },
      credentials: { password: "test-password" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "DATABASE",
        database: "app",
      });
    }
  });

  it("allows MSSQL server-scoped configs without a specific database", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "SQL Server",
      type: "MSSQL",
      config: {
        host: "sql.example.test",
        port: 1433,
        scope: "SERVER",
        username: "reporter",
        encrypt: true,
      },
      credentials: { password: "test-password" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "SERVER",
        maintenanceDatabase: "master",
      });
      expect("database" in parsed.data.config).toBe(false);
    }
  });

  it("rejects missing required connection credentials", () => {
    expect(createConnectionSchema.safeParse({
      name: "Postgres DB",
      type: "POSTGRES",
      config: {
        host: "db.example.test",
        database: "app",
        username: "reporter",
      },
      credentials: {},
    }).success).toBe(false);
  });

  it("does not require optional fields on connection updates", () => {
    const parsed = updateConnectionSchema.safeParse({ name: "Renamed" });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ name: "Renamed" });
      expect("credentials" in parsed.data).toBe(false);
    }
  });
});

describe("critical backup validation", () => {
  it("rejects unsafe bucket names and traversal prefixes", () => {
    expect(createStorageTargetSchema.safeParse({
      name: "Bad S3",
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "bad..bucket",
        region: "us-east-1",
        prefix: "backups",
      },
    }).success).toBe(false);

    expect(storagePrefixSchema.safeParse("../tenant").success).toBe(false);
    expect(storagePrefixSchema.safeParse("/absolute").success).toBe(false);
    expect(storagePrefixSchema.safeParse("tenant;rm").success).toBe(false);
  });

  it("rejects missing storage credentials for credential-backed modes", () => {
    expect(createStorageTargetSchema.safeParse({
      name: "S3 Key",
      provider: "AWS_S3",
      accessMode: "AWS_ACCESS_KEY",
      config: {
        bucket: "hermod-backups-test",
        region: "us-east-1",
        prefix: "backups",
      },
      credentials: { accessKeyId: "AKIA_TEST" },
    }).success).toBe(false);

    expect(createStorageTargetSchema.safeParse({
      name: "GCS SA",
      provider: "GCP_GCS",
      accessMode: "GCP_SERVICE_ACCOUNT_JSON",
      config: {
        bucket: "hermod-backups-test",
        projectId: "project-test",
        prefix: "backups",
      },
      credentials: {},
    }).success).toBe(false);
  });

  it("does not erase storage credentials when update payload omits them", () => {
    const parsed = updateStorageTargetSchema.safeParse({ name: "Renamed" });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ name: "Renamed" });
      expect("credentials" in parsed.data).toBe(false);
    }
  });

  it("validates PostgreSQL backup policy edge cases", () => {
    expect(createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "storage_1",
      walEnabled: true,
    }).success).toBe(false);

    expect(createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "storage_1",
      databaseSelectionMode: "MULTIPLE",
      selectedDatabases: [],
    }).success).toBe(false);

    expect(createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "storage_1",
      databaseSelectionMode: "PATTERN",
      databasePattern: "^app",
    }).success).toBe(true);
  });

  it("does not require unrelated fields on PostgreSQL backup policy updates", () => {
    const parsed = updateBackupPolicySchema.safeParse({
      enabled: false,
      storagePrefix: "backups/postgres",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        enabled: false,
        storagePrefix: "backups/postgres",
      });
    }
  });

  it("validates MSSQL backup policy destination and selection rules", () => {
    expect(createMssqlBackupPolicySchema.safeParse({
      name: "SQL",
      sourceConnectionId: "conn_mssql",
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      databaseSelectionMode: "SINGLE",
      selectedDatabases: ["app"],
    }).success).toBe(false);

    expect(createMssqlBackupPolicySchema.safeParse({
      name: "SQL",
      sourceConnectionId: "conn_mssql",
      destinationMode: "BACKUP_TO_URL",
      databaseSelectionMode: "SINGLE",
      selectedDatabases: ["app"],
      urlBase: "https://storage.example.test/backups",
      urlCredentialName: "hermod_credential",
    }).success).toBe(true);
  });

  it("does not require unrelated fields on MSSQL backup policy updates", () => {
    const parsed = updateMssqlBackupPolicySchema.safeParse({
      enabled: false,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ enabled: false });
    }
  });

  it("requires explicit restore confirmation options", () => {
    expect(restoreCreateSchema.safeParse({
      policyId: "policy_1",
      backupRunId: "run_1",
      targetConnectionId: "conn_restore",
      mode: "LOGICAL_PG_RESTORE",
      options: {
        clean: true,
        ifExists: true,
        noOwner: true,
        noPrivileges: true,
      },
    }).success).toBe(false);

    expect(restoreCreateSchema.safeParse({
      policyId: "policy_1",
      backupRunId: "run_1",
      targetConnectionId: "conn_restore",
      mode: "LOGICAL_PG_RESTORE",
      objectKey: "backups/postgres/server/databases/app/full-logical/dump.sql",
      options: {
        clean: true,
        ifExists: true,
        noOwner: true,
        noPrivileges: true,
        confirmation: "RESTORE restoredb",
      },
    }).success).toBe(true);
  });
});
