import type { UserRole } from "@prisma/client";

const ROLE_RANK: Record<UserRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  BILLING: 60,
  USER: 40,
  ANALYTICS: 20,
  API_SERVICE: 10,
};

export function makeAuthContext(overrides: Record<string, unknown> = {}) {
  const user = {
    id: "user_1",
    tenantId: "tenant_1",
    tenantName: "Test Tenant",
    tenantSlug: "test-tenant",
    role: "ADMIN" as UserRole,
  };

  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    user,
    session: { user },
    ...overrides,
  };
}

export function makeSession(overrides: Record<string, unknown> = {}) {
  const { user: userOverrides, ...sessionOverrides } = overrides;
  const user = {
    id: "user_1",
    name: "Test User",
    email: "user@example.test",
    tenantId: "tenant_1",
    tenantName: "Test Tenant",
    tenantSlug: "test-tenant",
    role: "ADMIN" as UserRole,
    ...((userOverrides as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    user,
    expires: "2099-01-01T00:00:00.000Z",
    ...sessionOverrides,
  };
}

export function hasMockRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}
