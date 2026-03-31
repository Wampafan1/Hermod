import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

const PAGE_SIZE = 50;

// GET /api/history?cursor=X&status=SUCCESS&reportId=Y
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const reportId = url.searchParams.get("reportId");

  const where: Record<string, unknown> = {
    report: { userId: session.user.id },
  };
  if (status && status !== "all") where.status = status;
  if (reportId) where.reportId = reportId;

  const runs = await prisma.runLog.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      report: {
        select: {
          id: true,
          name: true,
          schedule: { select: { id: true } },
        },
      },
    },
  });

  const hasMore = runs.length > PAGE_SIZE;
  const items = hasMore ? runs.slice(0, PAGE_SIZE) : runs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor });
});
