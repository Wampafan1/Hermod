import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { decompressPayload } from "@/lib/bifrost/helheim/dead-letter";

// GET /api/bifrost/helheim/[id] — Single entry with payload preview
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/helheim/")[1]?.split("/")[0]?.split("?")[0];

  const entry = await prisma.helheimEntry.findFirst({
    where: {
      id,
      route: { userId: session.user.id },
    },
    include: {
      route: { select: { id: true, name: true } },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let payloadPreview: Record<string, unknown>[] = [];
  let totalRows = 0;
  try {
    const allRows = await decompressPayload(entry.payload);
    totalRows = allRows.length;
    payloadPreview = allRows.slice(0, 10);
  } catch {
    // If decompression fails, return empty preview
  }

  return NextResponse.json({
    id: entry.id,
    routeId: entry.routeId,
    routeName: entry.route.name,
    jobId: entry.jobId,
    chunkIndex: entry.chunkIndex,
    rowCount: entry.rowCount,
    errorType: entry.errorType,
    errorMessage: entry.errorMessage,
    errorDetails: entry.errorDetails,
    retryCount: entry.retryCount,
    maxRetries: entry.maxRetries,
    status: entry.status,
    createdAt: entry.createdAt.toISOString(),
    lastRetriedAt: entry.lastRetriedAt?.toISOString() ?? null,
    nextRetryAt: entry.nextRetryAt?.toISOString() ?? null,
    payloadPreview,
    totalRows,
  });
});

// PATCH /api/bifrost/helheim/[id] — Mark entry as dead (kill)
export const PATCH = withAuth(async (req, session) => {
  const id = req.url.split("/helheim/")[1]?.split("/")[0]?.split("?")[0];
  const body = await req.json();

  if (body.action !== "kill") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const entry = await prisma.helheimEntry.findFirst({
    where: { id, route: { userId: session.user.id } },
  });

  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (entry.status === "recovered") {
    return NextResponse.json(
      { error: "Cannot kill a recovered entry" },
      { status: 400 }
    );
  }

  if (entry.status === "dead") {
    return NextResponse.json({ error: "Already dead" }, { status: 400 });
  }

  await prisma.helheimEntry.update({
    where: { id },
    data: { status: "dead", nextRetryAt: null },
  });

  return NextResponse.json({ status: "dead" });
});
