import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";

// GET /api/raven/ingest/[jobId]/status — Check which chunks have been received (resume after crash)
export const GET = withRavenAuth(async (req, ctx) => {
  const jobId = req.url.split("/ingest/")[1]?.split("/")[0]?.split("?")[0];
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  // Verify ownership chain: job → raven → tenant
  const job = await prisma.ravenJob.findFirst({
    where: {
      id: jobId,
      raven: { tenantId: ctx.tenantId },
    },
    select: { id: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const chunks = await prisma.ravenIngestChunk.findMany({
    where: { jobId },
    select: { chunkIndex: true, totalChunks: true },
    orderBy: { chunkIndex: "asc" },
  });

  if (chunks.length === 0) {
    return NextResponse.json({
      receivedChunks: [],
      totalChunks: 0,
      missing: [],
    });
  }

  const totalChunks = chunks[0].totalChunks;
  const receivedChunks = chunks.map((c) => c.chunkIndex);
  const receivedSet = new Set(receivedChunks);
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!receivedSet.has(i)) missing.push(i);
  }

  return NextResponse.json({
    receivedChunks,
    totalChunks,
    missing,
  });
});
