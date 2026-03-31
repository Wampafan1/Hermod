import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/bifrost/routes/[id]/logs — Run history
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/bifrost/routes/")[1]?.split("/")[0]?.split("?")[0];

  // Verify ownership
  const route = await prisma.bifrostRoute.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  // Read-repair: clean up stale "running" logs (>15 min old) from crashed runs
  await prisma.routeLog.updateMany({
    where: {
      routeId: id,
      status: "running",
      startedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: {
      status: "failed",
      error: "Timed out — process crashed or hung before completion",
      completedAt: new Date(),
    },
  });

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const PAGE_SIZE = 50;

  const logs = await prisma.routeLog.findMany({
    where: { routeId: id },
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = logs.length > PAGE_SIZE;
  const items = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor });
});
