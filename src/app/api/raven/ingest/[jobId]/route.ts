import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";

const ChunkSchema = z.object({
  ravenId: z.string().uuid(),
  chunk: z.number().int().min(0),
  totalChunks: z.number().int().min(1),
  rows: z.array(z.record(z.unknown())).min(1),
});

// POST /api/raven/ingest/[jobId] — Receive a data chunk from a Raven
export const POST = withRavenAuth(async (req, ctx) => {
  const jobId = req.url.split("/ingest/")[1]?.split("/")[0]?.split("?")[0];
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = ChunkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId, chunk, totalChunks, rows } = parsed.data;

  // Verify ownership chain: job → raven → tenant
  const job = await prisma.ravenJob.findFirst({
    where: {
      id: jobId,
      ravenId,
      raven: { tenantId: ctx.tenantId },
    },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "claimed" && job.status !== "running") {
    return NextResponse.json(
      { error: `Job is in '${job.status}' state and cannot accept chunks` },
      { status: 409 }
    );
  }

  // Transition to "running" on first chunk
  if (job.status === "claimed") {
    await prisma.ravenJob.update({
      where: { id: jobId },
      data: { status: "running", startedAt: new Date() },
    });
  }

  // Insert chunk — handle duplicate idempotently (P2002 = unique constraint violation)
  try {
    await prisma.ravenIngestChunk.create({
      data: {
        jobId,
        chunkIndex: chunk,
        totalChunks,
        data: rows as unknown as Record<string, unknown>[],
      },
    });
  } catch (err: unknown) {
    const isPrismaUniqueViolation =
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002";
    if (isPrismaUniqueViolation) {
      // Duplicate chunk — return success idempotently
      const receivedCount = await prisma.ravenIngestChunk.count({
        where: { jobId },
      });
      return NextResponse.json({
        received: chunk,
        totalChunks,
        remaining: totalChunks - receivedCount,
        duplicate: true,
      });
    }
    throw err;
  }

  const receivedCount = await prisma.ravenIngestChunk.count({
    where: { jobId },
  });

  return NextResponse.json({
    received: chunk,
    totalChunks,
    remaining: totalChunks - receivedCount,
  });
});
