import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

// GET /api/history — list run history for user's reports
export const GET = withAuth(async (_req, session) => {
  const runs = await prisma.runLog.findMany({
    where: { report: { userId: session.user.id } },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: {
      report: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(runs);
});
