import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

// Get session with tenant context -- use in Server Components
export async function getAuthSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session;
}

// Require auth + tenant -- redirects if missing
// IMPORTANT: Do NOT use on /onboarding page (infinite redirect loop)
export async function requireAuth() {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (!session.user.tenantId) redirect("/onboarding");
  return session;
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  BILLING: 60,
  USER: 40,
  ANALYTICS: 20,
  API_SERVICE: 10,
};

// Role check helper
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// Require minimum role -- for use in API routes and Server Components
export async function requireRole(minimumRole: UserRole) {
  const session = await requireAuth();
  if (!session.user.role || !hasRole(session.user.role, minimumRole)) {
    throw new Error("Insufficient permissions");
  }
  return session;
}
