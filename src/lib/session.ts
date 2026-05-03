import { cache } from "react";
import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

const getSessionCached = cache(() => getServerSession(authOptions));

export type AuthenticatedSession = Session & {
  user: Session["user"] & {
    id: string;
    tenantId: string;
    role: UserRole;
  };
};

export async function requireAuth(): Promise<AuthenticatedSession> {
  const session = await getSessionCached();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (!session.user.tenantId || !session.user.role) {
    redirect("/onboarding");
  }
  return session as AuthenticatedSession;
}

export async function getSession() {
  return await getSessionCached();
}
