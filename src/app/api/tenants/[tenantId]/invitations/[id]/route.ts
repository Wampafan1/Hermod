import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { revokeInvitation } from "@/lib/invitations";

// DELETE /api/tenants/[tenantId]/invitations/[id] — Revoke invitation (ADMIN+)
export const DELETE = withAuth(
  async (req, ctx) => {
    const segments = new URL(req.url).pathname.split("/");
    const tenantId = segments[3];
    const invitationId = segments[5];

    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      await revokeInvitation(invitationId, ctx.userId);
      return NextResponse.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke invitation";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { minimumRole: "ADMIN" }
);
