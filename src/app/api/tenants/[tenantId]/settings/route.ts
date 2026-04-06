import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/tenants/[tenantId]/settings — Get tenant details (any member)
export const GET = withAuth(async (req, ctx) => {
  const tenantId = new URL(req.url).pathname.split("/")[3];
  if (tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      logoUrl: true,
      plan: true,
      planExpiresAt: true,
      createdAt: true,
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json(tenant);
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logoUrl: z.string().url().nullable().optional(),
});

// PATCH /api/tenants/[tenantId]/settings — Update tenant (ADMIN+)
export const PATCH = withAuth(
  async (req, ctx) => {
    const tenantId = new URL(req.url).pathname.split("/")[3];
    if (tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: parsed.data,
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logoUrl: updated.logoUrl,
    });
  },
  { minimumRole: "ADMIN" }
);
