import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/bifrost/helheim — List DLQ entries
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const routeId = url.searchParams.get("routeId");
  const status = url.searchParams.get("status");
  const jobId = url.searchParams.get("jobId");

  const statusFilter = status === "pending"
    ? { status: { in: ["pending", "retrying"] } }
    : status
      ? { status }
      : {};

  const entries = await prisma.helheimEntry.findMany({
    where: {
      route: { userId: session.user.id },
      ...(routeId && { routeId }),
      ...statusFilter,
      ...(jobId && { jobId }),
    },
    select: {
      id: true,
      routeId: true,
      jobId: true,
      chunkIndex: true,
      rowCount: true,
      errorType: true,
      errorMessage: true,
      errorDetails: true,
      retryCount: true,
      maxRetries: true,
      status: true,
      createdAt: true,
      lastRetriedAt: true,
      nextRetryAt: true,
      route: { select: { name: true } },
      // payload intentionally excluded — too large for list view
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    entries.map((e) => ({
      ...e,
      routeName: e.route.name,
      route: undefined,
    }))
  );
});
