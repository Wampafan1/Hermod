import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createInvitation, INVITABLE_ROLES } from "@/lib/invitations";
import { z } from "zod";
import { UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(INVITABLE_ROLES as [string, ...string[]]) as z.ZodType<UserRole>,
});

// POST /api/tenants/[tenantId]/invitations — Create invitation (ADMIN+)
export const POST = withAuth(
  async (req, ctx) => {
    const tenantId = new URL(req.url).pathname.split("/")[3];
    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      const invitation = await createInvitation({
        tenantId: ctx.tenantId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: ctx.userId,
      });
      return NextResponse.json(invitation, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create invitation";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
  { minimumRole: "ADMIN" }
);

// GET /api/tenants/[tenantId]/invitations — List pending invitations (ADMIN+)
export const GET = withAuth(
  async (req, ctx) => {
    const tenantId = new URL(req.url).pathname.split("/")[3];
    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const invitations = await prisma.invitation.findMany({
      where: { tenantId: ctx.tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(invitations);
  },
  { minimumRole: "ADMIN" }
);
