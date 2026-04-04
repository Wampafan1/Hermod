import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().default("#d4af37"),
  icon: z.string().max(10).optional(),
});

/** GET — List all folders for the tenant with connection counts */
export const GET = withAuth(async (_req, ctx) => {
  const folders = await prisma.connectionFolder.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { connections: true } } },
  });

  return NextResponse.json(
    folders.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      icon: f.icon,
      sortOrder: f.sortOrder,
      connectionCount: f._count.connections,
    }))
  );
});

/** POST — Create a new folder */
export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const maxOrder = await prisma.connectionFolder.aggregate({
    where: { tenantId: ctx.tenantId },
    _max: { sortOrder: true },
  });

  const folder = await prisma.connectionFolder.create({
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      icon: parsed.data.icon,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      tenantId: ctx.tenantId,
    },
  });

  return NextResponse.json(folder, { status: 201 });
}, { minimumRole: "USER" });
