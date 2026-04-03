import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/bifrost/helheim/stats — Aggregate DLQ stats
export const GET = withAuth(async (_req, session) => {
  const [statusCounts, errorTypeCounts, recentActivity] = await Promise.all([
    prisma.helheimEntry.groupBy({
      by: ["status"],
      where: { route: { userId: session.user.id } },
      _count: true,
    }),

    prisma.helheimEntry.groupBy({
      by: ["errorType"],
      where: {
        route: { userId: session.user.id },
        status: { in: ["pending", "retrying"] },
      },
      _count: true,
    }),

    prisma.helheimEntry.count({
      where: {
        route: { userId: session.user.id },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const byStatus = Object.fromEntries(
    statusCounts.map((g) => [g.status, g._count])
  );
  const pending = (byStatus["pending"] ?? 0) + (byStatus["retrying"] ?? 0);
  const dead = byStatus["dead"] ?? 0;
  const recovered = byStatus["recovered"] ?? 0;
  const total = pending + dead + recovered;
  const recoveryRate =
    recovered + dead > 0
      ? Math.round((recovered / (recovered + dead)) * 100)
      : null;

  return NextResponse.json({
    pending,
    dead,
    recovered,
    total,
    recoveryRate,
    newLast24h: recentActivity,
    byErrorType: Object.fromEntries(
      errorTypeCounts.map((g) => [g.errorType, g._count])
    ),
  });
});
