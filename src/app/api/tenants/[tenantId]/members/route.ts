import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/tenants/[tenantId]/members — List members (ADMIN+)
export const GET = withAuth(
  async (req, ctx) => {
    const tenantId = new URL(req.url).pathname.split("/")[3];
    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const members = await prisma.tenantMembership.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json(
      members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      }))
    );
  },
  { minimumRole: "ADMIN" }
);
