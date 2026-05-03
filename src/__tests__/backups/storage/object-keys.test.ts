import { describe, expect, it } from "vitest";
import {
  buildBackupObjectKey,
  buildManifestObjectKey,
  normalizeStoragePrefix,
  sanitizeObjectKeySegment,
} from "@/lib/backups/storage/object-keys";

describe("database-centered backup object keys", () => {
  const date = new Date("2026-05-03T02:00:00.000Z");

  it("builds MSSQL full keys with database before backup type", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "backups",
      engine: "mssql",
      serverSlug: "prod-sql-01",
      databaseName: "Accounting",
      backupType: "full",
      timestamp: date,
      runId: "run123",
    })).toBe("backups/mssql/prod-sql-01/Accounting/full/2026/05/03/Accounting_FULL_20260503_020000_run123.bak");
  });

  it("builds MSSQL diff keys", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "backups",
      engine: "mssql",
      serverSlug: "prod-sql-01",
      databaseName: "Accounting",
      backupType: "diff",
      timestamp: new Date("2026-05-03T08:00:00.000Z"),
      runId: "run123",
    })).toBe("backups/mssql/prod-sql-01/Accounting/diff/2026/05/03/Accounting_DIFF_20260503_080000_run123.dif");
  });

  it("builds MSSQL log keys", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "backups",
      engine: "mssql",
      serverSlug: "prod-sql-01",
      databaseName: "Accounting",
      backupType: "log",
      timestamp: new Date("2026-05-03T09:00:00.000Z"),
      runId: "run123",
    })).toBe("backups/mssql/prod-sql-01/Accounting/log/2026/05/03/Accounting_LOG_20260503_090000_run123.trn");
  });

  it("builds Postgres full logical keys under databases", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "backups",
      engine: "postgres",
      serverSlug: "prod-pg-01",
      databaseName: "app_prod",
      backupType: "full-logical",
      timestamp: date,
      runId: "run123",
    })).toBe("backups/postgres/prod-pg-01/databases/app_prod/full-logical/2026/05/03/app_prod_FULL_20260503_020000_run123.dump");
  });

  it("builds Postgres WAL keys under server-level wal", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "backups",
      engine: "postgres",
      serverSlug: "prod-pg-01",
      backupType: "wal",
      timestamp: date,
      runId: "run123",
      walFileName: "000000010000000A000000FE",
    })).toBe("backups/postgres/prod-pg-01/wal/2026/05/03/000000010000000A000000FE");
  });

  it("sanitizes prefixes and path segments", () => {
    expect(normalizeStoragePrefix("/backups//sql/")).toBe("backups/sql");
    expect(sanitizeObjectKeySegment("Accounting/Prod", "database")).toBe("Accounting_Prod");
    expect(buildBackupObjectKey({
      storagePrefix: "/backups//sql/",
      engine: "mssql",
      serverSlug: "prod-sql-01\\instance",
      databaseName: "../Accounting",
      backupType: "full",
      timestamp: date,
      runId: "run123",
    })).toBe("backups/sql/mssql/prod-sql-01_instance/Accounting/full/2026/05/03/Accounting_FULL_20260503_020000_run123.bak");
  });

  it("allows empty prefix", () => {
    expect(buildBackupObjectKey({
      storagePrefix: "",
      engine: "mssql",
      serverSlug: "prod-sql-01",
      databaseName: "Accounting",
      backupType: "full",
      timestamp: date,
      runId: "run123",
    })).toBe("mssql/prod-sql-01/Accounting/full/2026/05/03/Accounting_FULL_20260503_020000_run123.bak");
  });

  it("builds manifest keys", () => {
    expect(buildManifestObjectKey({
      storagePrefix: "backups",
      engine: "mssql",
      serverSlug: "prod-sql-01",
      databaseName: "Accounting",
      backupType: "manifest",
      timestamp: date,
      runId: "run123",
    })).toBe("backups/mssql/prod-sql-01/Accounting/manifests/2026/05/03/run123.json");
  });
});
