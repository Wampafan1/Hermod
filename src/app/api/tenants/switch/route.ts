import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const switchSchema = z.object({
  tenantId: z.string().cuid(),
});

// POST /api/tenants/switch — Switch active tenant
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Verify user is a member of the target tenant
  const membership = await prisma.tenantMembership.findUnique({
    where: {
      userId_tenantId: {
        userId: session.user.id,
        tenantId: parsed.data.tenantId,
      },
    },
  });

  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of this tenant" },
      { status: 403 }
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeTenantId: parsed.data.tenantId },
  });

  return NextResponse.json({ success: true, tenantId: parsed.data.tenantId });
}
