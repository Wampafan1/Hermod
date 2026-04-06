import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Session } from "next-auth";
import { UserRole } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { hasRole } from "@/lib/auth-helpers";

export interface AuthContext {
  /** Shorthand for session.user.id */
  userId: string;
  /** Active tenant ID — guaranteed non-null by withAuth */
  tenantId: string;
  /** User's role in the active tenant */
  role: UserRole;
  /** Full session object */
  session: Session;
  /** Backward-compat: existing routes access ctx.user.id */
  user: Session["user"];
}

type AuthHandler = (
  req: Request,
  ctx: AuthContext
) => Promise<NextResponse>;

export function withAuth(
  handler: AuthHandler,
  options?: { minimumRole?: UserRole }
) {
  return async (req: Request, routeContext?: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.tenantId || !session.user.role) {
      return NextResponse.json({ error: "No active tenant" }, { status: 403 });
    }
    if (options?.minimumRole && !hasRole(session.user.role, options.minimumRole)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const ctx: AuthContext = {
      userId: session.user.id,
      tenantId: session.user.tenantId,
      role: session.user.role,
      session,
      user: session.user,
    };

    try {
      return await handler(req, ctx);
    } catch (error) {
      console.error("API error:", error instanceof Error ? error.message : error);
      return NextResponse.json(
        { error: "An internal error occurred. Please try again or contact support." },
        { status: 500 }
      );
    }
  };
}
