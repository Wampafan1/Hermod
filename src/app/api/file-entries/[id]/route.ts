import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — Get a single FileEntry with full details */
export const GET = withAuth(async (req, ctx) => {
  const id = new URL(req.url).pathname.split("/").pop()!;

  const entry = await prisma.fileEntry.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      connection: { select: { id: true, name: true, type: true } },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "File entry not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...entry,
    uploadedAt: entry.uploadedAt.toISOString(),
    processedAt: entry.processedAt?.toISOString() ?? null,
  });
});
