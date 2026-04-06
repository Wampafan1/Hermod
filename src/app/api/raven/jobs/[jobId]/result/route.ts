import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";

const ResultSchema = z.object({
  ravenId: z.string().uuid(),
  status: z.enum(["success", "error", "partial"]),
  rowCount: z.number().int().min(0),
  byteSize: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  error: z.string().optional(),
  chunks: z.number().int().min(0),
  completedAt: z.string().optional(), // Logged for diagnostics only — never written as canonical timestamp
});

// POST /api/raven/jobs/[jobId]/result — Raven reports job completion
export const POST = withRavenAuth(async (req, ctx) => {
  const jobId = req.url.split("/jobs/")[1]?.split("/")[0]?.split("?")[0];
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = ResultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId, status, rowCount, byteSize, durationMs, error, chunks } =
    parsed.data;

  // Verify ownership chain: job → raven → tenant
  const job = await prisma.ravenJob.findFirst({
    where: {
      id: jobId,
      ravenId,
      raven: { tenantId: ctx.tenantId },
    },
    select: { id: true, status: true, destination: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "claimed" && job.status !== "running") {
    return NextResponse.json(
      { error: `Job is in '${job.status}' state and cannot accept results` },
      { status: 409 }
    );
  }

  // Server time only — Raven's completedAt is ignored for the canonical timestamp
  await prisma.ravenJob.update({
    where: { id: jobId },
    data: {
      status,
      completedAt: new Date(),
      result: { rowCount, byteSize, durationMs, error, chunks },
    },
  });

  // TODO: if status === "success" and destination.type === "hermod_cloud",
  // trigger downstream route processing (enqueue via pg-boss).
  // Data routing integration comes in a later phase.

  return NextResponse.json({ status: "accepted" });
});
