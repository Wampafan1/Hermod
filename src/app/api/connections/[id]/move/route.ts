import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

// POST /api/connections/[id]/move — Move connection to a folder (or unfiled)
export const POST = withAuth(async (req, ctx) => {
  const id = req.url.split("/connections/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const body = await req.json();
  const { folderId } = body as { folderId: string | null };

  // Verify connection belongs to user OR tenant (handles pre-multi-tenant connections with null tenantId)
  const connection = await prisma.connection.findFirst({
    where: {
      id,
      OR: [
        { tenantId: ctx.tenantId },
        { userId: ctx.userId },
      ],
    },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // If moving to a folder, verify folder belongs to same tenant
  if (folderId) {
    const folder = await prisma.connectionFolder.findFirst({
      where: { id: folderId, tenantId: ctx.tenantId },
    });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  // Update folderId, and backfill tenantId if it was null
  const updated = await prisma.connection.update({
    where: { id },
    data: {
      folderId: folderId ?? null,
      tenantId: connection.tenantId ?? ctx.tenantId,
    },
  });

  return NextResponse.json(updated);
});
