import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { z } from "zod";

const querySchema = z.object({
  status: z.enum(["completed", "failed", "running", "partial"]).optional(),
  routeId: z.string().cuid().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams);
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { status, routeId, limit, offset } = parsed.data;

  const where = {
    route: { userId: session.user.id },
    ...(status && { status }),
    ...(routeId && { routeId }),
  };

  const [runs, total] = await Promise.all([
    prisma.routeLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        route: { select: { name: true } },
      },
    }),
    prisma.routeLog.count({ where }),
  ]);

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      routeId: r.routeId,
      routeName: r.route.name,
      status: r.status,
      rowsExtracted: r.rowsExtracted,
      rowsLoaded: r.rowsLoaded,
      errorCount: r.errorCount,
      bytesTransferred: r.bytesTransferred?.toString() ?? null,
      duration: r.duration,
      error: r.error,
      triggeredBy: r.triggeredBy,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    total,
  });
});
