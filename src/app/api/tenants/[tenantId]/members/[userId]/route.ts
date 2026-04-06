import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { INVITABLE_ROLES } from "@/lib/invitations";
import { UserRole } from "@prisma/client";

const updateRoleSchema = z.object({
  role: z.enum(INVITABLE_ROLES as [string, ...string[]]) as z.ZodType<UserRole>,
});

// PATCH /api/tenants/[tenantId]/members/[userId] — Update member role (OWNER only)
export const PATCH = withAuth(
  async (req, ctx) => {
    const segments = new URL(req.url).pathname.split("/");
    const tenantId = segments[3];
    const targetUserId = segments[5];

    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cannot change own role
    if (targetUserId === ctx.userId) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const membership = await prisma.tenantMembership.findUnique({
      where: {
        userId_tenantId: { userId: targetUserId, tenantId: ctx.tenantId },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Cannot change another OWNER's role
    if (membership.role === "OWNER") {
      return NextResponse.json(
        { error: "Cannot change an owner's role" },
        { status: 400 }
      );
    }

    const updated = await prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { role: parsed.data.role },
    });

    return NextResponse.json({ success: true, role: updated.role });
  },
  { minimumRole: "OWNER" }
);

// DELETE /api/tenants/[tenantId]/members/[userId] — Remove member
export const DELETE = withAuth(
  async (req, ctx) => {
    const segments = new URL(req.url).pathname.split("/");
    const tenantId = segments[3];
    const targetUserId = segments[5];

    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cannot remove yourself
    if (targetUserId === ctx.userId) {
      return NextResponse.json(
        { error: "Cannot remove yourself. Transfer ownership first." },
        { status: 400 }
      );
    }

    const targetMembership = await prisma.tenantMembership.findUnique({
      where: {
        userId_tenantId: { userId: targetUserId, tenantId: ctx.tenantId },
      },
    });

    if (!targetMembership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Cannot remove an OWNER
    if (targetMembership.role === "OWNER") {
      return NextResponse.json(
        { error: "Cannot remove an owner" },
        { status: 400 }
      );
    }

    // ADMIN can remove USER/ANALYTICS; only OWNER can remove ADMIN
    if (targetMembership.role === "ADMIN" && ctx.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only the owner can remove admins" },
        { status: 403 }
      );
    }

    await prisma.tenantMembership.delete({
      where: { id: targetMembership.id },
    });

    // If the removed user had this as active tenant, null it out
    await prisma.user.updateMany({
      where: { id: targetUserId, activeTenantId: ctx.tenantId },
      data: { activeTenantId: null },
    });

    return NextResponse.json({ success: true });
  },
  { minimumRole: "ADMIN" }
);
