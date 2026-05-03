import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoSensitiveKeys, jsonRequest } from "@/__tests__/helpers/api-test";
import {
  makeBackupStorageTarget,
  makeConnection,
} from "@/__tests__/helpers/factories";

const {
  mockConnectionFindMany,
  mockConnectionFindFirst,
  mockConnectionCreate,
  mockConnectionUpdate,
  mockStorageTargetFindMany,
  mockTestUnsavedStorageTarget,
  mockEncrypt,
  mockDecrypt,
} = vi.hoisted(() => ({
  mockConnectionFindMany: vi.fn(),
  mockConnectionFindFirst: vi.fn(),
  mockConnectionCreate: vi.fn(),
  mockConnectionUpdate: vi.fn(),
  mockStorageTargetFindMany: vi.fn(),
  mockTestUnsavedStorageTarget: vi.fn(),
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
  mockDecrypt: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request, routeContext?: unknown) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      role: "ADMIN",
      user: { id: "user_1", tenantId: "tenant_1", role: "ADMIN" },
      session: { user: { id: "user_1", tenantId: "tenant_1", role: "ADMIN" } },
    }, routeContext),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findMany: mockConnectionFindMany,
      findFirst: mockConnectionFindFirst,
      create: mockConnectionCreate,
      update: mockConnectionUpdate,
    },
    backupStorageTarget: {
      findMany: mockStorageTargetFindMany,
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

vi.mock("@/lib/backups/storage/test-storage-target", () => ({
  testUnsavedStorageTarget: mockTestUnsavedStorageTarget,
}));

describe("credential safety guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncrypt.mockImplementation((value: string) => `encrypted:${value}`);
    mockDecrypt.mockReturnValue(JSON.stringify({ password: "test-password" }));
  });

  it("encrypts connection credentials before storage", async () => {
    mockConnectionCreate.mockResolvedValue(makeConnection({ credentials: "encrypted-at-rest" }));

    const { POST } = await import("@/app/api/connections/route");
    const response = await POST(jsonRequest("http://localhost/api/connections", {
      name: "Warehouse",
      type: "POSTGRES",
      config: {
        host: "db.example.test",
        port: 5432,
        database: "analytics",
        username: "reporter",
        ssl: true,
      },
      credentials: { password: "test-password" },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify({ password: "test-password" }));
    expect(mockConnectionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        credentials: 'encrypted:{"password":"test-password"}',
        userId: "user_1",
        tenantId: "tenant_1",
      }),
    }));
    expectNoSensitiveKeys(body);
  });

  it("does not include credentials in connection list responses", async () => {
    mockConnectionFindMany.mockResolvedValue([
      makeConnection({ credentials: "encrypted-at-rest" }),
    ]);

    const { GET } = await import("@/app/api/connections/route");
    const response = await GET(new Request("http://localhost/api/connections"));
    const body = await response.json();

    expect(mockConnectionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user_1", tenantId: "tenant_1" },
      select: expect.not.objectContaining({ credentials: true }),
    }));
    expectNoSensitiveKeys(body);
  });

  it("does not include credentials in connection detail responses", async () => {
    mockConnectionFindFirst.mockResolvedValue(makeConnection({ credentials: "encrypted-at-rest" }));

    const { GET } = await import("@/app/api/connections/[id]/route");
    const response = await GET(new Request("http://localhost/api/connections/conn_1"));
    const body = await response.json();

    expect(mockConnectionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conn_1", userId: "user_1", tenantId: "tenant_1" },
      select: expect.not.objectContaining({ credentials: true }),
    }));
    expectNoSensitiveKeys(body);
  });

  it("preserves existing encrypted connection credentials when update omits credentials", async () => {
    mockConnectionFindFirst.mockResolvedValue(makeConnection({ credentials: "encrypted-at-rest" }));
    mockConnectionUpdate.mockResolvedValue(makeConnection({ name: "Renamed", credentials: "encrypted-at-rest" }));

    const { PUT } = await import("@/app/api/connections/[id]/route");
    const response = await PUT(new Request("http://localhost/api/connections/conn_1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockConnectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ credentials: expect.anything() }),
    }));
    expectNoSensitiveKeys(body);
  });

  it("does not include credentials in backup storage target list responses", async () => {
    mockStorageTargetFindMany.mockResolvedValue([
      makeBackupStorageTarget({
        credentials: "encrypted-storage-credentials",
      }),
    ]);

    const { GET } = await import("@/app/api/backups/storage-targets/route");
    const response = await GET(new Request("http://localhost/api/backups/storage-targets"));
    const body = await response.json();

    expect(mockStorageTargetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user_1", tenantId: "tenant_1" },
      select: expect.not.objectContaining({ credentials: true }),
    }));
    expectNoSensitiveKeys(body);
  });

  it("tests unsaved storage target credentials without persistence", async () => {
    mockTestUnsavedStorageTarget.mockResolvedValue({
      ok: true,
      checks: [{ name: "Write test object", status: "passed" }],
    });

    const { POST } = await import("@/app/api/backups/storage-targets/test-unsaved/route");
    const response = await POST(jsonRequest("http://localhost/api/backups/storage-targets/test-unsaved", {
      name: "S3",
      provider: "AWS_S3",
      accessMode: "AWS_ACCESS_KEY",
      config: {
        bucket: "hermod-backups-test",
        region: "us-east-1",
        prefix: "backups",
      },
      credentials: {
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "test-secret-key",
      },
    }));

    expect(response.status).toBe(200);
    expect(mockTestUnsavedStorageTarget).toHaveBeenCalledWith(expect.objectContaining({
      credentials: {
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "test-secret-key",
      },
    }));
    expect(mockConnectionCreate).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  it("decrypts provider credentials only when converting server-side connection rows", async () => {
    const { toConnectionLike } = await import("@/lib/providers/helpers");

    const connection = toConnectionLike({
      type: "POSTGRES",
      config: { host: "db.example.test" },
      credentials: "encrypted-at-rest",
    });

    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-at-rest");
    expect(connection.credentials).toEqual({ password: "test-password" });
  });

  it("redacts obvious secret fields from safe error messages", async () => {
    const { safeErrorMessage } = await import("@/lib/async-utils");

    const message = safeErrorMessage(new Error(
      "failed password=hunter2 secretAccessKey=abc accessKeyId=def serviceAccountKey=ghi private_key=jkl client_email=x tokenSecret=y consumerSecret=z refresh_token=r PGPASSWORD=p Bearer bearer-token"
    ));

    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("abc");
    expect(message).not.toContain("bearer-token");
    expect(message).toContain("password=[redacted]");
    expect(message).toContain("secretAccessKey=[redacted]");
    expect(message).toContain("Bearer [redacted]");
  });
});
