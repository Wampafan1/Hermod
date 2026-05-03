import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPolicyFindFirst,
  mockRunFindFirst,
  mockConnectionFindFirst,
} = vi.hoisted(() => ({
  mockPolicyFindFirst: vi.fn(),
  mockRunFindFirst: vi.fn(),
  mockConnectionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    postgresBackupPolicy: { findFirst: mockPolicyFindFirst },
    postgresBackupRun: { findFirst: mockRunFindFirst },
    connection: { findFirst: mockConnectionFindFirst },
  },
}));

import { validateRestoreReferences } from "@/lib/backups/api-helpers";

const ctx = { userId: "user_1", tenantId: "tenant_1" } as any;

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    policyId: "policy_1",
    backupRunId: "run_1",
    targetConnectionId: "target_conn",
    mode: "LOGICAL_PG_RESTORE" as const,
    objectKey: "stored/object-key.dump",
    options: {
      clean: true,
      ifExists: true,
      noOwner: true,
      noPrivileges: true,
      confirmation: "RESTORE restoredb",
      allowSameSourceRestore: false,
    },
    ...overrides,
  };
}

describe("PostgreSQL restore validation guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyFindFirst.mockResolvedValue({
      id: "policy_1",
      sourceConnectionId: "source_conn",
      sourceConnection: {
        id: "source_conn",
        name: "Source",
        type: "POSTGRES",
        config: { scope: "DATABASE", database: "sourcedb" },
      },
      storageTarget: {
        id: "storage_1",
        provider: "AWS_S3",
        config: { bucket: "hermod-backups-test" },
      },
    });
    mockRunFindFirst.mockResolvedValue({
      id: "run_1",
      policyId: "policy_1",
      type: "FULL_LOGICAL",
      status: "SUCCESS",
      objectKeys: [
        { key: "stored/object-key.dump", checksumSha256: "checksum-a", database: "sourcedb" },
        { key: "stored/second-object-key.dump", checksumSha256: "checksum-b", database: "otherdb" },
      ],
      checksumSha256: "run-checksum",
    });
    mockConnectionFindFirst.mockResolvedValue({
      id: "target_conn",
      name: "Restore Target",
      type: "POSTGRES",
      config: { scope: "DATABASE", database: "restoredb" },
    });
  });

  it("rejects non-POSTGRES restore targets", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "target_conn",
      name: "Warehouse",
      type: "BIGQUERY",
      config: {},
    });

    await expect(validateRestoreReferences(validInput(), ctx)).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Restore target connection must be POSTGRES",
    });
  });

  it("rejects same-source restores without explicit dangerous confirmation", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "source_conn",
      name: "Source",
      type: "POSTGRES",
      config: { scope: "DATABASE", database: "sourcedb" },
    });

    await expect(validateRestoreReferences(validInput({
      targetConnectionId: "source_conn",
      options: {
        clean: true,
        ifExists: true,
        noOwner: true,
        noPrivileges: true,
        confirmation: "RESTORE SOURCE DATABASE sourcedb",
        allowSameSourceRestore: false,
      },
    }), ctx)).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Restoring into the source connection requires explicit same-source confirmation",
    });
  });

  it("uses the stored objectKey artifact and checksum selected by the request", async () => {
    const result = await validateRestoreReferences(validInput({
      objectKey: "stored/second-object-key.dump",
    }), ctx);

    expect(result).toMatchObject({
      ok: true,
      objectKey: "stored/second-object-key.dump",
      objectChecksumSha256: "checksum-b",
    });
  });

  it("rejects reconstructed or unknown object paths", async () => {
    await expect(validateRestoreReferences(validInput({
      objectKey: "backups/reconstructed/path.dump",
    }), ctx)).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Selected backup artifact was not found on this restore point",
    });
  });

  it("requires target database selection for SERVER-scoped restore targets", async () => {
    mockConnectionFindFirst.mockResolvedValue({
      id: "target_conn",
      name: "Restore Server",
      type: "POSTGRES",
      config: { scope: "SERVER", maintenanceDatabase: "postgres" },
    });

    await expect(validateRestoreReferences(validInput(), ctx)).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Choose a target database when restoring through a SERVER-scoped PostgreSQL connection",
    });
  });
});
