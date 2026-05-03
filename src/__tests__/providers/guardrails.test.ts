import { describe, expect, it, vi } from "vitest";
import { buildMssqlBackupSql, quoteMssqlIdentifier, quoteMssqlString } from "@/lib/backups/mssql/mssql-backup-sql";
import { configuredMssqlDatabase, maintenanceMssqlDatabase, selectMssqlDatabases } from "@/lib/backups/mssql/mssql-database-discovery";
import { toConnectionLike } from "@/lib/providers/helpers";
import { effectiveDatabase, PostgresProvider } from "@/lib/providers/postgres.provider";
import { effectiveMssqlDatabase, MssqlProvider } from "@/lib/providers/mssql.provider";
import { PoolManager } from "@/lib/providers/pool-manager";

describe("provider safety guardrails", () => {
  it("uses the configured database for PostgreSQL DATABASE scope and maintenance database for SERVER scope", () => {
    expect(effectiveDatabase({
      host: "db.example.test",
      username: "reporter",
      scope: "DATABASE",
      database: "app",
    })).toBe("app");

    expect(effectiveDatabase({
      host: "db.example.test",
      username: "reporter",
      scope: "SERVER",
      maintenanceDatabase: "postgres_admin",
    })).toBe("postgres_admin");
  });

  it("uses master or maintenanceDatabase for MSSQL SERVER scope", () => {
    expect(effectiveMssqlDatabase({
      host: "sql.example.test",
      port: 1433,
      username: "reporter",
      scope: "DATABASE",
      database: "app",
    })).toBe("app");

    expect(effectiveMssqlDatabase({
      host: "sql.example.test",
      port: 1433,
      username: "reporter",
      scope: "SERVER",
    })).toBe("master");

    expect(maintenanceMssqlDatabase({ scope: "SERVER", maintenanceDatabase: "ops" })).toBe("ops");
    expect(configuredMssqlDatabase({ scope: "DATABASE", database: "app" })).toBe("app");
  });

  it("filters templates and system databases in provider discovery SQL", async () => {
    const pgQuery = vi.fn().mockResolvedValue({ rows: [] });
    class FakePostgresProvider extends PostgresProvider {
      async connect() {
        return { client: { query: pgQuery }, close: vi.fn() } as any;
      }
    }

    await new FakePostgresProvider().listDatabases({
      type: "POSTGRES",
      config: { host: "db.example.test", username: "reporter", scope: "SERVER" },
      credentials: { password: "test-password" },
    });
    expect(pgQuery.mock.calls[0][0]).toContain("datistemplate = false");

    const mssqlQuery = vi.fn().mockResolvedValue({ recordset: [] });
    class FakeMssqlProvider extends MssqlProvider {
      async connect() {
        return { pool: { request: () => ({ query: mssqlQuery }) }, close: vi.fn() } as any;
      }
    }

    await new FakeMssqlProvider().listDatabases({
      type: "MSSQL",
      config: { host: "sql.example.test", port: 1433, username: "reporter", scope: "SERVER" },
      credentials: { password: "test-password" },
    });
    expect(mssqlQuery.mock.calls[0][0]).toContain("d.database_id > 4");
    expect(mssqlQuery.mock.calls[0][0]).toContain("d.state_desc = 'ONLINE'");
  });

  it("quotes SQL Server identifiers and strings for backup SQL", () => {
    expect(quoteMssqlIdentifier("db]name")).toBe("[db]]name]");
    expect(quoteMssqlString("backup's")).toBe("N'backup''s'");

    const sql = buildMssqlBackupSql({
      database: "prod]db",
      type: "FULL",
      destinationMode: "BACKUP_TO_URL",
      target: "https://storage.example.test/prod's.bak",
      credentialName: "cred'name",
    });

    expect(sql).toContain("BACKUP DATABASE [prod]]db]");
    expect(sql).toContain("TO URL = N'https://storage.example.test/prod''s.bak'");
    expect(sql).toContain("CREDENTIAL = N'cred''name'");
  });

  it("selects MSSQL databases without allowing undiscovered names", () => {
    expect(selectMssqlDatabases({
      mode: "ALL_USER_DATABASES",
      discoveredDatabases: ["app", "warehouse"],
      excludedDatabases: ["warehouse"],
    })).toEqual(["app"]);

    expect(() => selectMssqlDatabases({
      mode: "SINGLE",
      discoveredDatabases: ["app"],
      selectedDatabases: ["missing"],
    })).toThrow("Selected database was not discovered");
  });

  it("keeps provider pool keys sensitive to connection identity fields", () => {
    const base = PoolManager.buildKey({
      host: "db.example.test",
      port: 5432,
      database: "app",
      user: "reporter",
      password: "pw1",
    });
    const differentDatabase = PoolManager.buildKey({
      host: "db.example.test",
      port: 5432,
      database: "other",
      user: "reporter",
      password: "pw1",
    });
    const differentUser = PoolManager.buildKey({
      host: "db.example.test",
      port: 5432,
      database: "app",
      user: "other",
      password: "pw1",
    });

    expect(base).not.toBe(differentDatabase);
    expect(base).not.toBe(differentUser);
  });

  it("does not require optional credentials until an operation needs a provider client", () => {
    expect(toConnectionLike({
      type: "CSV_FILE",
      config: { originalFilename: "sample.csv" },
      credentials: null,
    })).toEqual({
      type: "CSV_FILE",
      config: { originalFilename: "sample.csv" },
      credentials: {},
    });
  });
});
