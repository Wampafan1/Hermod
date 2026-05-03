import { createHash } from "crypto";
import { stat, writeFile } from "fs/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockRestoreFindUnique,
  mockRestoreUpdate,
} = vi.hoisted(() => ({
  mockRestoreFindUnique: vi.fn(),
  mockRestoreUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    postgresRestoreJob: {
      findUnique: mockRestoreFindUnique,
      update: mockRestoreUpdate,
    },
  },
}));

vi.mock("@/lib/providers", () => ({
  toConnectionLike: (connection: any) => ({
    type: connection.type,
    config: connection.config,
    credentials: { password: "restore-secret" },
  }),
}));

vi.mock("@/lib/backups/postgres/preflight", () => ({
  verifyBackupBinary: vi.fn().mockResolvedValue({ name: "pg_restore", ok: true, message: "pg_restore 17" }),
}));

import { PostgresRestoreEngine } from "@/lib/backups/postgres/postgres-restore-engine";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeRestoreJob(overrides: Record<string, unknown> = {}) {
  const checksum = sha256("dump-data");
  return {
    id: "restore_1",
    policyId: "policy_1",
    backupRunId: "run_1",
    targetConnectionId: "target_conn",
    mode: "LOGICAL_PG_RESTORE",
    status: "RUNNING",
    options: {
      clean: true,
      ifExists: true,
      noOwner: true,
      noPrivileges: true,
      confirmation: "RESTORE restoredb",
    },
    objectKey: "niflheim/policy_1/full-logical/2026/05/02/restoredb.dump",
    checksumSha256: checksum,
    checksumVerified: false,
    bytesDownloaded: null,
    durationMs: null,
    error: null,
    policy: {
      id: "policy_1",
      sourceConnectionId: "source_conn",
      storagePrefix: "niflheim",
      sourceConnection: {
        id: "source_conn",
        name: "Source",
        type: "POSTGRES",
        config: { database: "source" },
      },
      storageTarget: {
        id: "target_1",
        provider: "AWS_S3",
        accessMode: "AWS_ACCESS_KEY",
        config: { bucket: "backups", region: "us-east-1" },
        credentials: "encrypted",
      },
    },
    backupRun: {
      id: "run_1",
      type: "FULL_LOGICAL",
      status: "SUCCESS",
      objectKeys: [{ key: "niflheim/policy_1/full-logical/2026/05/02/restoredb.dump" }],
      checksumSha256: checksum,
    },
    targetConnection: {
      id: "target_conn",
      name: "Restore Target",
      type: "POSTGRES",
      config: {
        host: "db.example.com",
        port: 5432,
        database: "restoredb",
        username: "restore",
        ssl: false,
      },
      credentials: "encrypted",
    },
    ...overrides,
  };
}

describe("PostgresRestoreEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestoreUpdate.mockResolvedValue({});
  });

  it("downloads, verifies checksum, and runs pg_restore without password args", async () => {
    mockRestoreFindUnique.mockResolvedValue(makeRestoreJob());
    const downloadFile = vi.fn(async (_key: string, localPath: string) => {
      await writeFile(localPath, "dump-data");
      return { bytes: 9 };
    });
    const processRunner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, timedOut: false });
    const engine = new PostgresRestoreEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile: vi.fn(),
        downloadFile,
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runRestore({ restoreJobId: "restore_1", timeoutMs: 1000 });

    expect(result.status).toBe("SUCCESS");
    expect(downloadFile).toHaveBeenCalledOnce();
    expect(processRunner).toHaveBeenCalledWith(
      "pg_restore",
      expect.arrayContaining(["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", "restoredb"]),
      expect.objectContaining({ PGPASSWORD: "restore-secret" }),
      expect.objectContaining({ timeoutMs: 1000 })
    );
    const args = processRunner.mock.calls[0][1] as string[];
    expect(args.join(" ")).not.toContain("restore-secret");
    expect(mockRestoreUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "restore_1" },
      data: expect.objectContaining({ status: "SUCCESS", checksumVerified: true }),
    }));
  });

  it("fails before pg_restore on checksum mismatch and cleans temp files", async () => {
    mockRestoreFindUnique.mockResolvedValue(makeRestoreJob());
    let downloadedPath: string | null = null;
    const downloadFile = vi.fn(async (_key: string, localPath: string) => {
      downloadedPath = localPath;
      await writeFile(localPath, "tampered-data");
      return { bytes: 13 };
    });
    const processRunner = vi.fn();
    const engine = new PostgresRestoreEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile: vi.fn(),
        downloadFile,
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runRestore({ restoreJobId: "restore_1", timeoutMs: 1000 });

    expect(result.status).toBe("FAILED");
    expect(processRunner).not.toHaveBeenCalled();
    expect(mockRestoreUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "restore_1" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "Downloaded backup checksum did not match the recorded SHA-256 checksum",
      }),
    }));
    expect(downloadedPath).toBeTruthy();
    await expect(stat(downloadedPath!)).rejects.toThrow();
  });

  it("restores to the selected database for server-scoped target connections", async () => {
    mockRestoreFindUnique.mockResolvedValue(makeRestoreJob({
      options: {
        clean: true,
        ifExists: true,
        noOwner: true,
        noPrivileges: true,
        confirmation: "RESTORE tenant_restore",
        targetDatabase: "tenant_restore",
      },
      targetConnection: {
        id: "target_conn",
        name: "Restore Server",
        type: "POSTGRES",
        config: {
          host: "db.example.com",
          port: 5432,
          scope: "SERVER",
          maintenanceDatabase: "postgres",
          username: "restore",
          ssl: false,
        },
        credentials: "encrypted",
      },
    }));
    const downloadFile = vi.fn(async (_key: string, localPath: string) => {
      await writeFile(localPath, "dump-data");
      return { bytes: 9 };
    });
    const processRunner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, timedOut: false });
    const engine = new PostgresRestoreEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile: vi.fn(),
        downloadFile,
        list: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    await engine.runRestore({ restoreJobId: "restore_1", timeoutMs: 1000 });

    expect(processRunner).toHaveBeenCalledWith(
      "pg_restore",
      expect.arrayContaining(["--dbname", "tenant_restore"]),
      expect.objectContaining({ PGDATABASE: "tenant_restore" }),
      expect.any(Object)
    );
  });

  it("creates a PITR manifest without running pg_restore", async () => {
    const uploadFile = vi.fn().mockResolvedValue({ key: "niflheim/policy_1/restore-manifests/restore_1.json", bytes: 100 });
    mockRestoreFindUnique.mockResolvedValue(makeRestoreJob({
      mode: "PHYSICAL_PITR_PREPARE",
      objectKey: "niflheim/policy_1/full-physical/base.tar",
      backupRun: {
        id: "run_1",
        type: "FULL_PHYSICAL_BASE",
        status: "SUCCESS",
        objectKeys: [{ key: "niflheim/policy_1/full-physical/base.tar" }],
        checksumSha256: null,
      },
      options: {
        confirmation: "PREPARE PITR restoredb",
        pointInTime: "2026-05-02T20:00:00.000Z",
      },
    }));
    const processRunner = vi.fn();
    const engine = new PostgresRestoreEngine({
      processRunner,
      storageResolver: () => ({
        uploadFile,
        downloadFile: vi.fn(),
        list: vi.fn().mockResolvedValue([{ key: "niflheim/policy_1/wal/000000010000000000000001" }]),
        delete: vi.fn(),
        test: vi.fn(),
      }),
    });

    const result = await engine.runRestore({ restoreJobId: "restore_1", timeoutMs: 1000 });

    expect(result.status).toBe("SUCCESS");
    expect(processRunner).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      "niflheim/policy_1/restore-manifests/restore_1.json",
      expect.objectContaining({ type: "PHYSICAL_PITR_PREPARE" })
    );
  });
});
