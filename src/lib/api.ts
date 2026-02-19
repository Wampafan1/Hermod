import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

type AuthHandler = (
  req: Request,
  session: Session & { user: { id: string } }
) => Promise<NextResponse>;

export function withAuth(handler: AuthHandler) {
  return async (req: Request, context?: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      return await handler(req, session as Session & { user: { id: string } });
    } catch (error) {
      console.error("API error:", error);
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
