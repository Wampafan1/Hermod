import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindFirst,
  mockFindMany,
  mockUpdate,
  mockCreate,
  mockTargetDelete,
  mockTransaction,
  mockPostgresPolicyCount,
  mockPostgresPolicyDeleteMany,
  mockMssqlPolicyCount,
  mockMssqlPolicyDeleteMany,
  mockTestUnsaved,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockTargetDelete: vi.fn(),
  mockTransaction: vi.fn(),
  mockPostgresPolicyCount: vi.fn(),
  mockPostgresPolicyDeleteMany: vi.fn(),
  mockMssqlPolicyCount: vi.fn(),
  mockMssqlPolicyDeleteMany: vi.fn(),
  mockTestUnsaved: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => handler(req, {
    userId: "user_1",
    tenantId: "tenant_1",
    role: "ADMIN",
    user: { id: "user_1" },
    session: { user: { id: "user_1", tenantId: "tenant_1", role: "ADMIN" } },
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    backupStorageTarget: {
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      update: mockUpdate,
      create: mockCreate,
      delete: mockTargetDelete,
    },
    postgresBackupPolicy: {
      count: mockPostgresPolicyCount,
      deleteMany: mockPostgresPolicyDeleteMany,
    },
    mssqlBackupPolicy: {
      count: mockMssqlPolicyCount,
      deleteMany: mockMssqlPolicyDeleteMany,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
}));

vi.mock("@/lib/backups/storage/test-storage-target", () => ({
  testUnsavedStorageTarget: mockTestUnsaved,
}));

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("backup storage target API safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostgresPolicyCount.mockResolvedValue(0);
    mockMssqlPolicyCount.mockResolvedValue(0);
    mockPostgresPolicyDeleteMany.mockResolvedValue({ count: 0 });
    mockMssqlPolicyDeleteMany.mockResolvedValue({ count: 0 });
    mockTargetDelete.mockResolvedValue({});
    mockTransaction.mockResolvedValue([]);
  });

  it("GET does not return credentials even if a selected record includes them", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "target_1",
        name: "Prod",
        provider: "AWS_S3",
        accessMode: "AWS_ACCESS_KEY",
        config: { bucket: "hermod-backups-prod" },
        credentials: "encrypted-secret",
      },
    ]);

    const { GET } = await import("@/app/api/backups/storage-targets/route");
    const res = await GET(new Request("http://localhost/api/backups/storage-targets"));
    const data = await res.json();

    expect(data[0]).not.toHaveProperty("credentials");
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user_1", tenantId: "tenant_1" },
    }));
  });

  it("PUT does not erase credentials unless new credentials are provided", async () => {
    mockFindFirst.mockResolvedValue({ id: "target_1" });
    mockUpdate.mockResolvedValue({
      id: "target_1",
      name: "Renamed",
      provider: "AWS_S3",
      accessMode: "AWS_ACCESS_KEY",
      config: { bucket: "hermod-backups-prod" },
    });

    const { PUT } = await import("@/app/api/backups/storage-targets/[id]/route");
    const res = await PUT(new Request("http://localhost/api/backups/storage-targets/target_1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    }));

    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "target_1", userId: "user_1", tenantId: "tenant_1" },
    }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ credentials: expect.anything() }),
    }));
  });

  it("test-unsaved runs validation and storage checks without creating or updating a target", async () => {
    mockTestUnsaved.mockResolvedValue({
      ok: true,
      checks: [
        { name: "Write test object", status: "passed" },
        { name: "Read test object", status: "passed" },
        { name: "Delete test object", status: "passed" },
      ],
    });

    const { POST } = await import("@/app/api/backups/storage-targets/test-unsaved/route");
    const res = await POST(jsonRequest("http://localhost/api/backups/storage-targets/test-unsaved", {
      name: "Runtime Role",
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "hermod-backups-prod",
        region: "us-east-1",
        prefix: "postgres",
        retentionDays: 30,
        encryption: "SSE_S3",
        versioningEnabled: true,
      },
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.checks.map((check: { name: string }) => check.name)).toEqual([
      "Write test object",
      "Read test object",
      "Delete test object",
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("blocks deleting a storage target used by active MSSQL backup policies", async () => {
    mockFindFirst.mockResolvedValue({ id: "target_1" });
    mockPostgresPolicyCount.mockResolvedValue(0);
    mockMssqlPolicyCount.mockResolvedValue(1);

    const { DELETE } = await import("@/app/api/backups/storage-targets/[id]/route");
    const res = await DELETE(new Request("http://localhost/api/backups/storage-targets/target_1", {
      method: "DELETE",
    }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("active backup policy");
    expect(mockTargetDelete).not.toHaveBeenCalled();
  });

  it("force-deletes disabled Postgres and MSSQL policies before deleting a target", async () => {
    mockFindFirst.mockResolvedValue({ id: "target_1" });
    mockPostgresPolicyCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    mockMssqlPolicyCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2);

    const { DELETE } = await import("@/app/api/backups/storage-targets/[id]/route");
    const res = await DELETE(new Request("http://localhost/api/backups/storage-targets/target_1?force=true", {
      method: "DELETE",
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, deletedPolicies: 3 });
    expect(mockPostgresPolicyDeleteMany).toHaveBeenCalledWith({
      where: { storageTargetId: "target_1", enabled: false, userId: "user_1", tenantId: "tenant_1" },
    });
    expect(mockMssqlPolicyDeleteMany).toHaveBeenCalledWith({
      where: { storageTargetId: "target_1", status: "DISABLED", userId: "user_1", tenantId: "tenant_1" },
    });
    expect(mockTargetDelete).toHaveBeenCalledWith({ where: { id: "target_1" } });
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});
