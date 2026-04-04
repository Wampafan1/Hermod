import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const moveSchema = z.object({
  folderId: z.string().nullable(),
});

/** Extract the connection ID from the request URL. */
function extractId(url: string): string | null {
  return url.split("/connections/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

/** PATCH — Move a connection to a folder (or unfiled) */
export const PATCH = withAuth(async (req, ctx) => {
  const connectionId = extractId(req.url);
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

  const updated = await prisma.connection.update({
    where: { id: connectionId },
    data: { folderId: parsed.data.folderId },
    select: { id: true, name: true, type: true, folderId: true },
  });

  return NextResponse.json(updated);
});
