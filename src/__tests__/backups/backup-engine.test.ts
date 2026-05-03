import { describe, expect, it, vi, beforeEach } from "vitest";
import { stat, writeFile } from "fs/promises";
import path from "path";

const {
  mockPolicyFindUnique,
  mockPolicyUpdate,
  mockRunCreate,
  mockRunUpdate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPolicyFindUnique: vi.fn(),
  mockPolicyUpdate: vi.fn(),
  mockRunCreate: vi.fn(),
  mockRunUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    postgresBackupPolicy: {
      findUnique: mockPolicyFindUnique,
      update: mockPolicyUpdate,
    },
    postgresBackupRun: {
      create: mockRunCreate,
      update: mockRunUpdate,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/providers", () => ({
  toConnectionLike: (connection: any) => ({
    type: connection.type,
    config: connection.config,
    credentials: { password: "super-secret" },
  }),
}));

vi.mock("@/lib/backups/postgres/preflight", () => ({
  verifyBackupBinary: vi.fn().mockResolvedValue({ name: "pg_dump", ok: true, message: "pg_dump 16" }),
  runPostgresBackupPreflight: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
}));

import { PostgresBackupEngine } from "@/lib/backups/postgres/postgres-backup-engine";
import { PostgresProvider } from "@/lib/providers/postgres.provider";

function makePolicy() {
  return {
    id: "policy_1",
    sourceConnectionId: "conn_1",
    storagePrefix: "tenant/prod",
    databaseSelectionMode: "SINGLE",
    selectedDatabases: ["erp"],
    excludedDatabases: [],
    databasePattern: null,
    tenantId: "tenant_1",
    userId: "user_1",
    lastSuccessfulWalAt: null,
    lastSuccessfulFullAt: null,
    walEnabled: false,
    replicationSlot: null,
    sourceConnection: {
      id: "conn_1",
      name: "Prod PG",
      type: "POSTGRES",
      config: {
        host: "db.example.com",
        port: 5432,
        database: "erp",
        username: "backup",
        ssl: false,
      },
      credentials: "encrypted",
    },
    storageTarget: {
      id: "target_1",
      provider: "AWS_S3",
      config: { bucket: "backups", region: "us-east-1" },
      credentials: "encrypted",
    },
  };
}

describe("PostgresBackupEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyFindUnique.mockResolvedValue(makePolicy());
    mockRunCreate.mockResolvedValue({ id: "run_1" });
    mockRunUpdate.mockResolvedValue({});
    mockPolicyUpdate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it("runs a full backup, uploads the dump, and records success", async () => {
    const uploadFile = vi.fn().mockResolvedValue({
      key: "tenant/prod/policy_1/full-logical/2026/05/02/erp.dump",
      bytes: 9,
      etag: "etag",
    });
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const fileArg = args[args.indexOf("--file") + 1];
      await writeFile(fileArg, "dump-data");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runFullBackup({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("SUCCESS");
    expect(processRunner).toHaveBeenCalledWith(
      "pg_dump",
      expect.arrayContaining(["--format=custom", "--no-owner", "--dbname", "erp"]),
      expect.objectContaining({ PGPASSWORD: "super-secret" }),
      expect.objectContaining({ timeoutMs: 1000 })
    );
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(mockRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1" },
      data: expect.objectContaining({ status: "SUCCESS" }),
    }));
  });

  it("keeps the uploaded full backup artifact when manifest upload fails", async () => {
    const uploadFile = vi.fn(async (_filePath: string, objectKey: string, metadata?: { type?: string }) => {
      if (metadata?.type === "MANIFEST") {
        throw new Error("manifest upload failed");
      }
      return {
        key: objectKey,
        bytes: 9,
        etag: "etag",
      };
    });
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const fileArg = args[args.indexOf("--file") + 1];
      await writeFile(fileArg, "dump-data");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runFullBackup({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.objectKeys).toHaveLength(1);
    expect(result.objectKeys[0].key).toContain("/databases/erp/full-logical/");
    expect(mockRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1" },
      data: expect.objectContaining({
        status: "PARTIAL",
        objectKeys: expect.arrayContaining([
          expect.objectContaining({ key: expect.stringContaining("/databases/erp/full-logical/") }),
        ]),
        error: expect.stringContaining("manifest upload failed"),
      }),
    }));
  });

  it("marks a run failed and cleans temp files when pg_dump fails", async () => {
    let tempDir: string | null = null;
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const fileArg = args[args.indexOf("--file") + 1];
      tempDir = path.dirname(fileArg);
      await writeFile(fileArg, "partial");
      throw new Error("pg_dump failed without leaking super-secret");
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile: vi.fn(),
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runFullBackup({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("FAILED");
    expect(mockRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "All selected databases failed to back up: erp: pg_dump failed without leaking [redacted]",
      }),
    }));
    expect(tempDir).toBeTruthy();
    await expect(stat(tempDir!)).rejects.toThrow();
  });

  it("creates one full backup artifact per selected server database", async () => {
    const listSpy = vi.spyOn(PostgresProvider.prototype, "listDatabases").mockResolvedValue([
      { name: "analytics" },
      { name: "erp" },
    ]);
    mockPolicyFindUnique.mockResolvedValue({
      ...makePolicy(),
      databaseSelectionMode: "MULTIPLE",
      selectedDatabases: ["erp", "analytics"],
      sourceConnection: {
        id: "conn_1",
        type: "POSTGRES",
        config: {
          host: "db.example.com",
          port: 5432,
          scope: "SERVER",
          maintenanceDatabase: "postgres",
          username: "backup",
          ssl: false,
        },
        credentials: "encrypted",
      },
    });
    const uploadFile = vi.fn(async (_filePath: string, objectKey: string) => ({
      key: objectKey,
      bytes: 9,
      etag: "etag",
    }));
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const fileArg = args[args.indexOf("--file") + 1];
      await writeFile(fileArg, "dump-data");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runFullBackup({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("SUCCESS");
    expect(processRunner).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledTimes(4);
    expect(result.objectKeys.map((artifact) => artifact.database)).toEqual(["analytics", "erp"]);
    expect(result.objectKeys.map((artifact) => artifact.key)).toEqual([
      expect.stringContaining("/databases/analytics/full-logical/"),
      expect.stringContaining("/databases/erp/full-logical/"),
    ]);
    listSpy.mockRestore();
  });

  it("marks a full backup PARTIAL when one selected server database fails", async () => {
    const listSpy = vi.spyOn(PostgresProvider.prototype, "listDatabases").mockResolvedValue([
      { name: "erp" },
      { name: "broken" },
    ]);
    mockPolicyFindUnique.mockResolvedValue({
      ...makePolicy(),
      databaseSelectionMode: "MULTIPLE",
      selectedDatabases: ["erp", "broken"],
      sourceConnection: {
        id: "conn_1",
        type: "POSTGRES",
        config: {
          host: "db.example.com",
          port: 5432,
          scope: "SERVER",
          maintenanceDatabase: "postgres",
          username: "backup",
          ssl: false,
        },
        credentials: "encrypted",
      },
    });
    const uploadFile = vi.fn(async (_filePath: string, objectKey: string) => ({
      key: objectKey,
      bytes: 9,
      etag: "etag",
    }));
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const database = args[args.indexOf("--dbname") + 1];
      if (database === "broken") throw new Error("pg_dump failed for broken without super-secret");
      const fileArg = args[args.indexOf("--file") + 1];
      await writeFile(fileArg, "dump-data");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runFullBackup({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("PARTIAL");
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(mockRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1" },
      data: expect.objectContaining({
        status: "PARTIAL",
        error: expect.stringContaining("broken: pg_dump failed for broken without [redacted]"),
      }),
    }));
    listSpy.mockRestore();
  });

  it("keeps uploaded WAL artifacts when WAL manifest upload fails", async () => {
    mockPolicyFindUnique.mockResolvedValue({
      ...makePolicy(),
      walEnabled: true,
      replicationSlot: "hermod_slot",
      sourceConnection: {
        id: "conn_1",
        name: "Prod PG",
        type: "POSTGRES",
        config: {
          host: "db.example.com",
          port: 5432,
          scope: "SERVER",
          maintenanceDatabase: "postgres",
          username: "backup",
          ssl: false,
        },
        credentials: "encrypted",
      },
    });
    const uploadFile = vi.fn(async (_filePath: string, objectKey: string, metadata?: { type?: string }) => {
      if (metadata?.type === "WAL_MANIFEST") {
        throw new Error("wal manifest upload failed");
      }
      return {
        key: objectKey,
        bytes: 16,
        etag: "etag",
      };
    });
    const processRunner = vi.fn(async (_binary, args: string[]) => {
      const walDir = args[args.indexOf("--directory") + 1];
      await writeFile(path.join(walDir, "000000010000000000000001"), "wal-data");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const engine = new PostgresBackupEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runWalArchive({
      policyId: "policy_1",
      triggeredBy: "manual",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("PARTIAL");
    const walArgs = processRunner.mock.calls[0][1];
    expect(walArgs).toEqual(expect.arrayContaining([
      "--host",
      "db.example.com",
      "--port",
      "5432",
      "--username",
      "backup",
    ]));
    expect(walArgs).not.toContain("--dbname");
    expect(result.objectKeys).toHaveLength(1);
    expect(result.objectKeys[0].key).toContain("/wal/");
    expect(mockRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1" },
      data: expect.objectContaining({
        status: "PARTIAL",
        objectKeys: expect.arrayContaining([
          expect.objectContaining({ key: expect.stringContaining("/wal/") }),
        ]),
        error: expect.stringContaining("wal manifest upload failed"),
      }),
    }));
  });
});
