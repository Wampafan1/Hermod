import { describe, expect, it, vi } from "vitest";
import { createConnectionSchema } from "@/lib/validations/unified-connections";
import { createMssqlBackupPolicySchema } from "@/lib/validations/mssql-backups";
import { MssqlProvider } from "@/lib/providers/mssql.provider";
import {
  buildMssqlArtifactKey,
  buildMssqlBackupSql,
  buildMssqlVerifySql,
  quoteMssqlIdentifier,
} from "@/lib/backups/mssql/mssql-backup-sql";
import { computeMssqlBackupCoverage } from "@/lib/backups/mssql/mssql-coverage";
import { selectMssqlDatabases } from "@/lib/backups/mssql/mssql-database-discovery";

describe("MSSQL connection validation", () => {
  it("keeps existing database-scoped SQL Server connections valid", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "Prod SQL",
      type: "MSSQL",
      config: {
        host: "sql.example.com",
        port: 1433,
        database: "app",
        username: "reporter",
        encrypt: true,
      },
      credentials: { password: "secret" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "DATABASE",
        database: "app",
        maintenanceDatabase: undefined,
      });
    }
  });

  it("validates server-scoped SQL Server connections and defaults master", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "SQL Cluster",
      type: "MSSQL",
      config: {
        host: "sql.example.com",
        port: 1433,
        scope: "SERVER",
        username: "backup",
        trustServerCertificate: true,
      },
      credentials: { password: "secret" },
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
});

describe("MSSQL database discovery and selection", () => {
  it("listDatabases queries only online user databases", async () => {
    const query = vi.fn().mockResolvedValue({
      recordset: [{
        name: "app",
        databaseId: 5,
        state: "ONLINE",
        recoveryModel: "FULL",
        sizeBytes: "8192",
      }],
    });
    class FakeMssqlProvider extends MssqlProvider {
      async connect() {
        return {
          pool: { request: () => ({ query }) },
          close: vi.fn(),
        } as any;
      }
    }

    const provider = new FakeMssqlProvider();
    const databases = await provider.listDatabases({
      type: "MSSQL",
      config: {
        host: "sql.example.com",
        port: 1433,
        scope: "SERVER",
        maintenanceDatabase: "master",
        username: "backup",
      },
      credentials: { password: "secret" },
    });

    expect(databases).toEqual([{
      name: "app",
      databaseId: 5,
      state: "ONLINE",
      recoveryModel: "FULL",
      createDate: undefined,
      sizeBytes: "8192",
      canConnect: true,
    }]);
    expect(query.mock.calls[0][0]).toContain("d.database_id > 4");
    expect(query.mock.calls[0][0]).toContain("d.state_desc = 'ONLINE'");
  });

  it("resolves selected SQL Server database modes", () => {
    const discoveredDatabases = ["analytics", "app", "billing", "warehouse"];

    expect(selectMssqlDatabases({
      mode: "SINGLE",
      discoveredDatabases,
      selectedDatabases: ["app"],
    })).toEqual(["app"]);
    expect(selectMssqlDatabases({
      mode: "MULTIPLE",
      discoveredDatabases,
      selectedDatabases: ["warehouse", "analytics"],
    })).toEqual(["analytics", "warehouse"]);
    expect(selectMssqlDatabases({
      mode: "ALL_USER_DATABASES",
      discoveredDatabases,
      excludedDatabases: ["billing"],
    })).toEqual(["analytics", "app", "warehouse"]);
    expect(selectMssqlDatabases({
      mode: "PATTERN",
      discoveredDatabases,
      databasePattern: "^a",
    })).toEqual(["analytics", "app"]);
  });
});

describe("MSSQL backup SQL and validation", () => {
  it("quotes SQL Server identifiers and strings safely", () => {
    expect(quoteMssqlIdentifier("weird]db")).toBe("[weird]]db]");
    expect(buildMssqlBackupSql({
      database: "weird]db",
      type: "FULL",
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      target: "C:\\Backups\\weird.bak",
      compressionEnabled: true,
      checksumEnabled: true,
      copyOnly: true,
    })).toContain("BACKUP DATABASE [weird]]db]");
  });

  it("generates full, differential, and log backup SQL", () => {
    const full = buildMssqlBackupSql({
      database: "app",
      type: "FULL",
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      target: "\\\\share\\app.bak",
      compressionEnabled: true,
      checksumEnabled: true,
    });
    const diff = buildMssqlBackupSql({
      database: "app",
      type: "DIFFERENTIAL",
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      target: "\\\\share\\app.dif",
    });
    const log = buildMssqlBackupSql({
      database: "app",
      type: "LOG",
      destinationMode: "BACKUP_TO_URL",
      target: "https://account.blob.core.windows.net/backups/app.trn",
      credentialName: "HermodCredential",
    });

    expect(full).toContain("COMPRESSION");
    expect(full).toContain("CHECKSUM");
    expect(diff).toContain("DIFFERENTIAL");
    expect(log).toContain("BACKUP LOG [app]");
    expect(log).toContain("TO URL");
    expect(log).toContain("CREDENTIAL = N'HermodCredential'");
    expect(buildMssqlVerifySql({
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      target: "\\\\share\\app.bak",
      checksumEnabled: true,
    })).toContain("RESTORE VERIFYONLY FROM DISK");
  });

  it("builds SQL Server artifact keys by database and backup type", () => {
    expect(buildMssqlArtifactKey({
      prefix: "niflheim/sql",
      policyId: "policy_1",
      database: "Sales DB",
      type: "DIFFERENTIAL",
      at: new Date("2026-05-03T01:25:32.000Z"),
    })).toBe("niflheim/sql/policy_1/mssql/Sales DB/differential/2026/05/03/Sales DB-differential-20260503T012532Z.dif");
  });

  it("requires disk path or URL settings based on destination mode", () => {
    expect(createMssqlBackupPolicySchema.safeParse({
      name: "SQL",
      sourceConnectionId: "conn_1",
      destinationMode: "BACKUP_TO_DISK_SHARED_PATH",
      selectedDatabases: ["app"],
    }).success).toBe(false);

    expect(createMssqlBackupPolicySchema.safeParse({
      name: "SQL",
      sourceConnectionId: "conn_1",
      destinationMode: "BACKUP_TO_URL",
      selectedDatabases: ["app"],
      urlBase: "https://account.blob.core.windows.net/container",
      urlCredentialName: "HermodCredential",
    }).success).toBe(true);
  });
});

describe("MSSQL backup coverage", () => {
  it("returns NEVER_RUN, HEALTHY, DEGRADED, FAILED, and UNSUPPORTED states", () => {
    const now = new Date("2026-05-03T12:00:00.000Z");
    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: null,
      logFrequency: null,
      lastSuccessfulFullAt: null,
      lastSuccessfulDiffAt: null,
      lastSuccessfulLogAt: null,
    }, null, {}, now).status).toBe("NEVER_RUN");

    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: "EVERY_6_HOURS",
      logFrequency: "HOURLY",
      lastSuccessfulFullAt: new Date("2026-05-03T08:00:00.000Z"),
      lastSuccessfulDiffAt: new Date("2026-05-03T10:00:00.000Z"),
      lastSuccessfulLogAt: new Date("2026-05-03T11:30:00.000Z"),
    }, null, {}, now).status).toBe("HEALTHY");

    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: null,
      logFrequency: "HOURLY",
      lastSuccessfulFullAt: new Date("2026-05-03T08:00:00.000Z"),
      lastSuccessfulDiffAt: null,
      lastSuccessfulLogAt: null,
    }, null, {}, now).status).toBe("DEGRADED");

    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: null,
      logFrequency: null,
      lastSuccessfulFullAt: new Date("2026-05-03T08:00:00.000Z"),
      lastSuccessfulDiffAt: null,
      lastSuccessfulLogAt: null,
    }, { status: "FAILED", triggeredBy: "schedule", startedAt: now }).status).toBe("FAILED");

    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: null,
      logFrequency: "HOURLY",
      lastSuccessfulFullAt: new Date("2026-05-03T08:00:00.000Z"),
      lastSuccessfulDiffAt: null,
      lastSuccessfulLogAt: null,
    }, null, { logUnsupported: true }, now).status).toBe("UNSUPPORTED");
  });
});
