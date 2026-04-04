import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — List file entries for a connection with stats */
export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const connectionId = url.searchParams.get("connectionId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  // Verify connection belongs to tenant
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, tenantId: ctx.tenantId },
    select: { id: true, name: true, config: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const [entries, total, stats] = await Promise.all([
    prisma.fileEntry.findMany({
      where: { connectionId, tenantId: ctx.tenantId },
      orderBy: { uploadedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.fileEntry.count({
      where: { connectionId, tenantId: ctx.tenantId },
    }),
    prisma.fileEntry.aggregate({
      where: { connectionId, tenantId: ctx.tenantId, status: "LOADED" },
      _count: true,
      _sum: { rowCount: true },
      _max: { uploadedAt: true },
      _avg: { rowCount: true },
    }),
  ]);

  const config = connection.config as Record<string, unknown>;

  return NextResponse.json({
    entries: entries.map((e) => ({
      ...e,
      uploadedAt: e.uploadedAt.toISOString(),
      processedAt: e.processedAt?.toISOString() ?? null,
    })),
    total,
    connectionName: connection.name,
    baselineSchema: (config?.baselineSchema as Record<string, unknown>) ?? null,
    stats: {
      totalFiles: total,
      totalRows: stats._sum.rowCount ?? 0,
      lastUpload: stats._max.uploadedAt?.toISOString() ?? null,
      avgRowsPerFile: Math.round(stats._avg.rowCount ?? 0),
    },
  });
});
