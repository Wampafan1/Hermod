import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getBoss } from "@/lib/pg-boss";
import { withRavenAuth } from "@/lib/raven/auth";

const CompleteSchema = z.object({
  ravenId: z.string().uuid(),
});

// POST /api/raven/ingest/[jobId]/complete — Mark ingest as complete
export const POST = withRavenAuth(async (req, ctx) => {
  const jobId = req.url.split("/ingest/")[1]?.split("/")[0]?.split("?")[0];
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId } = parsed.data;

  // Verify ownership chain: job → raven → tenant
  const job = await prisma.ravenJob.findFirst({
    where: {
      id: jobId,
      ravenId,
      raven: { tenantId: ctx.tenantId },
    },
    select: { id: true, status: true, routeId: true, routeLogId: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "running" && job.status !== "claimed") {
    return NextResponse.json(
      { error: `Job is in '${job.status}' state and cannot be completed` },
      { status: 409 }
    );
  }

  // Check chunk completeness
  const chunks = await prisma.ravenIngestChunk.findMany({
    where: { jobId },
    select: { chunkIndex: true, totalChunks: true },
    orderBy: { chunkIndex: "asc" },
  });

  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "No chunks received for this job" },
      { status: 400 }
    );
  }

  const totalChunks = chunks[0].totalChunks;
  const receivedIndices = new Set(chunks.map((c) => c.chunkIndex));
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!receivedIndices.has(i)) missing.push(i);
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "Missing chunks",
        missing,
        received: chunks.length,
        totalChunks,
      },
      { status: 400 }
    );
  }

  // All chunks present — mark job complete.
  // If this job is linked to a Bifrost route, chunks are preserved for the
  // resume handler to read; otherwise they are deleted immediately.
  const hasRoute = !!(job.routeId && job.routeLogId);

  const txOps = [
    prisma.ravenJob.update({
      where: { id: jobId },
      data: {
        status: "success",
        completedAt: new Date(),
        result: {
          rowCount: null,
          byteSize: null,
          durationMs: null,
          chunks: totalChunks,
        },
      },
    }),
  ];

  // Only delete chunks immediately if no downstream pipeline needs them
  if (!hasRoute) {
    txOps.push(prisma.ravenIngestChunk.deleteMany({ where: { jobId } }) as any);
  }

  await prisma.$transaction(txOps);

  // If this job was created by a Bifrost Route, enqueue pipeline resumption
  if (job.routeId && job.routeLogId) {
    try {
      const boss = getBoss();
      await boss.send("resume-raven-route", {
        routeId: job.routeId,
        routeLogId: job.routeLogId,
        ravenJobId: jobId,
      });
    } catch (err) {
      console.error(
        "[Raven] Failed to enqueue resume-raven-route:",
        err instanceof Error ? err.message : err
      );
      // Non-fatal — the job is still marked complete
    }
  }

  return NextResponse.json({
    status: "complete",
    chunksReceived: totalChunks,
  });
});
