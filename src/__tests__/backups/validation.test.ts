import { describe, expect, it, vi, beforeEach } from "vitest";
import { createBackupPolicySchema } from "@/lib/validations/backups";
import { createConnectionSchema } from "@/lib/validations/unified-connections";

const {
  mockConnectionFindFirst,
  mockTargetFindFirst,
  mockPolicyFindFirst,
  mockRunFindFirst,
} = vi.hoisted(() => ({
  mockConnectionFindFirst: vi.fn(),
  mockTargetFindFirst: vi.fn(),
  mockPolicyFindFirst: vi.fn(),
  mockRunFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: { findFirst: mockConnectionFindFirst },
    backupStorageTarget: { findFirst: mockTargetFindFirst },
    postgresBackupPolicy: { findFirst: mockPolicyFindFirst },
    postgresBackupRun: { findFirst: mockRunFindFirst },
  },
}));

import { validateBackupPolicyReferences, validateRestoreReferences } from "@/lib/backups/api-helpers";
import { selectDatabases } from "@/lib/backups/postgres/database-selection";
import { PostgresProvider } from "@/lib/providers/postgres.provider";

describe("backup API validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects WAL coverage without a replication slot", () => {
    const parsed = createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "target_1",
      walEnabled: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("validates and preserves PostgreSQL backup storage layout", () => {
    const parsed = createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "target_1",
      storageLayout: "TYPE_CENTERED",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.storageLayout).toBe("TYPE_CENTERED");
    }

    expect(createBackupPolicySchema.safeParse({
      name: "Prod",
      sourceConnectionId: "conn_1",
      storageTargetId: "target_1",
      storageLayout: "BAD_LAYOUT",
    }).success).toBe(false);
  });

  it("keeps existing POSTGRES database connections valid and defaults scope", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "Prod",
      type: "POSTGRES",
      config: {
        host: "db.example.com",
        port: 5432,
        database: "prod",
        username: "backup",
        ssl: true,
      },
      credentials: { password: "secret" },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config).toMatchObject({
        scope: "DATABASE",
        database: "prod",
      });
    }
  });

  it("validates SERVER-scoped POSTGRES without a database and defaults maintenanceDatabase", () => {
    const parsed = createConnectionSchema.safeParse({
      name: "Cluster",
      type: "POSTGRES",
      config: {
        host: "db.example.com",
        port: 5432,
        scope: "SERVER",
        username: "backup",
        ssl: true,
      },
      credentials: { password: "secret" },
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

  it("resolves selected databases for server backup modes", () => {
    const discoveredDatabases = ["analytics", "app", "postgres", "sample"];

    expect(selectDatabases({
      mode: "SINGLE",
      discoveredDatabases,
      selectedDatabases: ["app"],
    })).toEqual(["app"]);
    expect(selectDatabases({
      mode: "MULTIPLE",
      discoveredDatabases,
      selectedDatabases: ["sample", "analytics"],
    })).toEqual(["analytics", "sample"]);
    expect(selectDatabases({
      mode: "ALL_NON_TEMPLATE",
      discoveredDatabases,
      excludedDatabases: ["postgres"],
    })).toEqual(["analytics", "app", "sample"]);
    expect(selectDatabases({
      mode: "PATTERN",
      discoveredDatabases,
      databasePattern: "^a",
    })).toEqual(["analytics", "app"]);
  });

  it("listDatabases filters out template databases", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name: "prod", canConnect: true }] });
    class FakePostgresProvider extends PostgresProvider {
      async connect() {
        return {
          client: { query },
          close: vi.fn(),
        } as any;
      }
    }

    const provider = new FakePostgresProvider();
    const databases = await provider.listDatabases({
      type: "POSTGRES",
      config: {
        host: "db.example.com",
        scope: "SERVER",
        maintenanceDatabase: "postgres",
        username: "backup",
      },
      credentials: { password: "secret" },
    });

    expect(databases).toEqual([{ name: "prod", canConnect: true }]);
    expect(query.mock.calls[0][0]).toContain("datistemplate = false");
  });

  it("rejects non-POSTGRES source connections", async () => {
    mockConnectionFindFirst.mockResolvedValue({ id: "conn_1", type: "MYSQL", config: {} });
    mockTargetFindFirst.mockResolvedValue({ id: "target_1" });

    const result = await validateBackupPolicyReferences(
      { sourceConnectionId: "conn_1", storageTargetId: "target_1" },
      { userId: "user_1", tenantId: "tenant_1" } as any
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Backup source connection must be POSTGRES",
    });
  });

  it("scopes PostgreSQL backup source and storage target references to the active tenant", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_1",
      type: "POSTGRES",
      config: { scope: "DATABASE", database: "prod" },
    });
    mockTargetFindFirst.mockResolvedValue({ id: "target_1" });

    const result = await validateBackupPolicyReferences(
      { sourceConnectionId: "conn_1", storageTargetId: "target_1" },
      { userId: "user_1", tenantId: "tenant_1" } as any
    );

    expect(result).toEqual({ ok: true });
    expect(mockConnectionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conn_1", userId: "user_1", tenantId: "tenant_1" },
    }));
    expect(mockTargetFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "target_1", userId: "user_1", tenantId: "tenant_1" },
    }));
  });

  it("rejects WAL coverage on database-scoped PostgreSQL source connections", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "conn_1",
      type: "POSTGRES",
      config: { scope: "DATABASE", database: "prod" },
    });
    mockTargetFindFirst.mockResolvedValue({ id: "target_1" });

    const result = await validateBackupPolicyReferences(
      {
        sourceConnectionId: "conn_1",
        storageTargetId: "target_1",
        walEnabled: true,
      },
      { userId: "user_1", tenantId: "tenant_1" } as any
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "WAL/PITR coverage requires a SERVER-scoped PostgreSQL connection because WAL is cluster-level",
    });
  });

  it("rejects non-POSTGRES restore target connections", async () => {
    mockPolicyFindFirst.mockResolvedValue({
      id: "policy_1",
      sourceConnectionId: "source_conn",
      sourceConnection: { id: "source_conn", name: "Source", type: "POSTGRES", config: { database: "prod" } },
      storageTarget: { id: "target_1", provider: "AWS_S3", config: { bucket: "backups" } },
    });
    mockRunFindFirst.mockResolvedValue({
      id: "run_1",
      policyId: "policy_1",
      type: "FULL_LOGICAL",
      status: "SUCCESS",
      objectKeys: [{ key: "dump" }],
      checksumSha256: "abc",
    });
    mockConnectionFindFirst.mockResolvedValue({
      id: "target_conn",
      name: "Warehouse",
      type: "BIGQUERY",
      config: { database: "restoredb" },
    });

    const result = await validateRestoreReferences(
      {
        policyId: "policy_1",
        backupRunId: "run_1",
        targetConnectionId: "target_conn",
        mode: "LOGICAL_PG_RESTORE",
        options: {
          clean: true,
          ifExists: true,
          noOwner: true,
          noPrivileges: true,
          confirmation: "RESTORE restoredb",
          allowSameSourceRestore: false,
        },
      },
      { userId: "user_1", tenantId: "tenant_1" } as any
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Restore target connection must be POSTGRES",
    });
  });

  it("rejects same-source logical restores without explicit override", async () => {
    mockPolicyFindFirst.mockResolvedValue({
      id: "policy_1",
      sourceConnectionId: "source_conn",
      sourceConnection: { id: "source_conn", name: "Source", type: "POSTGRES", config: { database: "prod" } },
      storageTarget: { id: "target_1", provider: "AWS_S3", config: { bucket: "backups" } },
    });
    mockRunFindFirst.mockResolvedValue({
      id: "run_1",
      policyId: "policy_1",
      type: "FULL_LOGICAL",
      status: "SUCCESS",
      objectKeys: [{ key: "dump" }],
      checksumSha256: "abc",
    });
    mockConnectionFindFirst.mockResolvedValue({
      id: "source_conn",
      name: "Source",
      type: "POSTGRES",
      config: { database: "prod" },
    });

    const result = await validateRestoreReferences(
      {
        policyId: "policy_1",
        backupRunId: "run_1",
        targetConnectionId: "source_conn",
        mode: "LOGICAL_PG_RESTORE",
        options: {
          clean: true,
          ifExists: true,
          noOwner: true,
          noPrivileges: true,
          confirmation: "RESTORE SOURCE DATABASE prod",
          allowSameSourceRestore: false,
        },
      },
      { userId: "user_1", tenantId: "tenant_1" } as any
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Restoring into the source connection requires explicit same-source confirmation",
    });
  });
});
