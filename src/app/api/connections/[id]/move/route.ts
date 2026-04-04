import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

const moveSchema = z.object({
  folderId: z.string().nullable(),
});

/** PATCH — Move a connection to a folder (or unfiled) */
export const PATCH = withAuth(async (req, ctx) => {
  // Extract connection ID from URL: /api/connections/[id]/move
  const segments = new URL(req.url).pathname.split("/");
  const moveIdx = segments.indexOf("move");
  const connectionId = segments[moveIdx - 1];

  if (!connectionId) {
    return NextResponse.json({ error: "Connection ID required" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  // Verify connection belongs to tenant
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, tenantId: ctx.tenantId },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // If moving to a folder, verify the folder belongs to the same tenant
  if (parsed.data.folderId) {
    const folder = await prisma.connectionFolder.findFirst({
      where: { id: parsed.data.folderId, tenantId: ctx.tenantId },
    });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  await prisma.connection.update({
    where: { id: connectionId },
    data: { folderId: parsed.data.folderId },
  });

  return NextResponse.json({ success: true });
});
