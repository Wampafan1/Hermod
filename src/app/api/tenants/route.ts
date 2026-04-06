import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/tenants — List all tenants the user belongs to (with role)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: session.user.id },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          domain: true,
          logoUrl: true,
          plan: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json(
    memberships.map((m) => ({
      ...m.tenant,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      isActive: m.tenantId === session.user.tenantId,
    }))
  );
}
