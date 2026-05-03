import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { jsonRequest } from "@/__tests__/helpers/api-test";
import { makeBackupStorageTarget, makeConnection } from "@/__tests__/helpers/factories";
import { createMockPrisma, type MockPrisma } from "@/__tests__/helpers/mock-prisma";
import { makeSession } from "@/__tests__/helpers/mock-auth";

const ROLE_RANK: Record<UserRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  BILLING: 60,
  USER: 40,
  ANALYTICS: 20,
  API_SERVICE: 10,
};

function installRealWithAuthMocks(session: unknown) {
  vi.doMock("next-auth", () => ({
    getServerSession: vi.fn().mockResolvedValue(session),
  }));
  vi.doMock("@/lib/auth", () => ({
    authOptions: {},
  }));
}

function forbidden(message: string, status = 403) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installRouteMocks(prisma: MockPrisma, role: UserRole = "ADMIN") {
  vi.doMock("@/lib/api", () => ({
    withAuth: (handler: any, options?: { minimumRole?: UserRole }) => async (req: Request, routeContext?: unknown) => {
      if (options?.minimumRole && ROLE_RANK[role] < ROLE_RANK[options.minimumRole]) {
        return forbidden("Insufficient permissions");
      }

      return handler(req, {
        userId: "user_1",
        tenantId: "tenant_1",
        role,
        user: { id: "user_1", tenantId: "tenant_1", role },
        session: { user: { id: "user_1", tenantId: "tenant_1", role } },
      }, routeContext);
    },
  }));

  vi.doMock("@/lib/db", () => ({ prisma }));
  vi.doMock("@/lib/crypto", () => ({
    encrypt: (value: string) => `encrypted:${value}`,
  }));
}

describe("withAuth guardrails", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    installRealWithAuthMocks(null);
    const { withAuth } = await import("@/lib/api");

    const response = await withAuth(async () => Response.json({ ok: true }) as any)(
      new Request("http://localhost/api/connections")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when an authenticated user has no active tenant", async () => {
    installRealWithAuthMocks(makeSession({ user: { id: "user_1", tenantId: undefined, role: "ADMIN" } }));
    const { withAuth } = await import("@/lib/api");

    const response = await withAuth(async () => Response.json({ ok: true }) as any)(
      new Request("http://localhost/api/connections")
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "No active tenant" });
  });

  it("rejects USER, ANALYTICS, and API_SERVICE roles for ADMIN-only handlers", async () => {
    for (const role of ["USER", "ANALYTICS", "API_SERVICE"] as UserRole[]) {
      vi.resetModules();
      installRealWithAuthMocks(makeSession({ user: { id: "user_1", tenantId: "tenant_1", role } }));
      const { withAuth } = await import("@/lib/api");

      const response = await withAuth(
        async () => Response.json({ ok: true }) as any,
        { minimumRole: "ADMIN" }
      )(new Request("http://localhost/api/backups/storage-targets"));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Insufficient permissions" });
    }
  });

  it("allows ADMIN and OWNER roles for ADMIN-only handlers", async () => {
    for (const role of ["ADMIN", "OWNER"] as UserRole[]) {
      vi.resetModules();
      installRealWithAuthMocks(makeSession({ user: { id: "user_1", tenantId: "tenant_1", role } }));
      const { withAuth } = await import("@/lib/api");

      const response = await withAuth(
        async () => Response.json({ ok: true }) as any,
        { minimumRole: "ADMIN" }
      )(new Request("http://localhost/api/backups/storage-targets"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    }
  });
});

describe("tenant-scoped API route guardrails", () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prisma = createMockPrisma();
    installRouteMocks(prisma);
  });

  it("cannot read another user's connection", async () => {
    prisma.connection.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/connections/[id]/route");
    const response = await GET(new Request("http://localhost/api/connections/conn_other"));

    expect(response.status).toBe(404);
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conn_other", userId: "user_1", tenantId: "tenant_1" },
    }));
  });

  it("cannot delete another user's connection", async () => {
    prisma.connection.findFirst.mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/connections/[id]/route");
    const response = await DELETE(new Request("http://localhost/api/connections/conn_other", {
      method: "DELETE",
    }));

    expect(response.status).toBe(404);
    expect(prisma.connection.delete).not.toHaveBeenCalled();
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conn_other", userId: "user_1", tenantId: "tenant_1" },
    }));
  });

  it("cannot update another user's Bifrost route", async () => {
    prisma.bifrostRoute.findFirst.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/bifrost/routes/[id]/route");
    const response = await PUT(new Request("http://localhost/api/bifrost/routes/route_other", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    }));

    expect(response.status).toBe(404);
    expect(prisma.bifrostRoute.update).not.toHaveBeenCalled();
    expect(prisma.bifrostRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_other", userId: "user_1", tenantId: "tenant_1" },
    }));
  });

  it("scopes manual Bifrost route runs before loading credentials", async () => {
    prisma.bifrostRoute.findFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/bifrost/routes/[id]/run/route");
    const response = await POST(new Request("http://localhost/api/bifrost/routes/route_other/run", {
      method: "POST",
    }));

    expect(response.status).toBe(404);
    expect(prisma.bifrostRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route_other", userId: "user_1", tenantId: "tenant_1" },
      include: expect.objectContaining({
        source: expect.objectContaining({ select: expect.objectContaining({ credentials: true }) }),
        dest: expect.objectContaining({ select: expect.objectContaining({ credentials: true }) }),
      }),
    }));
  });

  it("rejects USER role for admin-only storage mutations", async () => {
    vi.resetModules();
    prisma = createMockPrisma();
    installRouteMocks(prisma, "USER");

    const { DELETE } = await import("@/app/api/backups/storage-targets/[id]/route");
    const response = await DELETE(new Request("http://localhost/api/backups/storage-targets/storage_1", {
      method: "DELETE",
    }));

    expect(response.status).toBe(403);
    expect(prisma.backupStorageTarget.findFirst).not.toHaveBeenCalled();
  });

  it("rejects API_SERVICE role for destructive storage mutations", async () => {
    vi.resetModules();
    prisma = createMockPrisma();
    installRouteMocks(prisma, "API_SERVICE");

    const { DELETE } = await import("@/app/api/backups/storage-targets/[id]/route");
    const response = await DELETE(new Request("http://localhost/api/backups/storage-targets/storage_1", {
      method: "DELETE",
    }));

    expect(response.status).toBe(403);
    expect(prisma.backupStorageTarget.delete).not.toHaveBeenCalled();
  });

  it("allows ADMIN to create protected storage targets", async () => {
    prisma.backupStorageTarget.create.mockResolvedValue(makeBackupStorageTarget());

    const { POST } = await import("@/app/api/backups/storage-targets/route");
    const response = await POST(jsonRequest("http://localhost/api/backups/storage-targets", {
      name: "S3",
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "hermod-backups-test",
        region: "us-east-1",
        prefix: "backups",
      },
    }));

    expect(response.status).toBe(201);
    expect(prisma.backupStorageTarget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user_1",
        tenantId: "tenant_1",
      }),
    }));
  });

  it("scopes storage target delete checks to the active tenant", async () => {
    prisma.backupStorageTarget.findFirst.mockResolvedValue(makeBackupStorageTarget());
    prisma.postgresBackupPolicy.count.mockResolvedValue(0);
    prisma.mssqlBackupPolicy.count.mockResolvedValue(0);
    prisma.backupStorageTarget.delete.mockResolvedValue(makeBackupStorageTarget());

    const { DELETE } = await import("@/app/api/backups/storage-targets/[id]/route");
    const response = await DELETE(new Request("http://localhost/api/backups/storage-targets/storage_1", {
      method: "DELETE",
    }));

    expect(response.status).toBe(200);
    expect(prisma.backupStorageTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "storage_1", userId: "user_1", tenantId: "tenant_1" },
    }));
    expect(prisma.postgresBackupPolicy.count).toHaveBeenCalledWith({
      where: { storageTargetId: "storage_1", enabled: true, userId: "user_1", tenantId: "tenant_1" },
    });
    expect(prisma.mssqlBackupPolicy.count).toHaveBeenCalledWith({
      where: { storageTargetId: "storage_1", status: { not: "DISABLED" }, userId: "user_1", tenantId: "tenant_1" },
    });
  });

  it("scopes connection create payloads to the authenticated user and tenant", async () => {
    prisma.connection.create.mockResolvedValue(makeConnection({ credentials: "encrypted" }));

    const { POST } = await import("@/app/api/connections/route");
    const response = await POST(jsonRequest("http://localhost/api/connections", {
      name: "Warehouse",
      type: "POSTGRES",
      config: {
        host: "db.example.test",
        database: "analytics",
        username: "reporter",
      },
      credentials: { password: "test-password" },
    }));

    expect(response.status).toBe(201);
    expect(prisma.connection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user_1",
        tenantId: "tenant_1",
      }),
    }));
  });
});
