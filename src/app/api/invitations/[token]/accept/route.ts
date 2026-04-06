import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { acceptInvitation } from "@/lib/invitations";

// POST /api/invitations/[token]/accept — Accept invitation (any authenticated user)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = new URL(req.url).pathname.split("/")[3];

  try {
    const membership = await acceptInvitation(token, session.user.id);
    return NextResponse.json({
      success: true,
      tenantId: membership.tenantId,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept invitation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
