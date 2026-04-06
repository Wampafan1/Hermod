import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";

// POST /api/raven/jobs/[jobId]/claim — Raven claims a pending job (optimistic lock)
export const POST = withRavenAuth(async (req, ctx) => {
  const jobId = req.url.split("/jobs/")[1]?.split("/")[0]?.split("?")[0];
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  // Atomic claim — the WHERE clause acts as an optimistic lock.
  // If two processes try to claim simultaneously, only one succeeds.
  const result = await prisma.ravenJob.updateMany({
    where: {
      id: jobId,
      status: "pending",
      raven: { tenantId: ctx.tenantId },
    },
    data: {
      status: "claimed",
      claimedAt: new Date(), // Server time, not Raven time
    },
  });

  if (result.count === 0) {
    return NextResponse.json(
      { error: "Job no longer available" },
      { status: 409 }
    );
  }

  // Claim succeeded — return full job details so the Raven has everything it needs
  const job = await prisma.ravenJob.findUnique({ where: { id: jobId } });
  return NextResponse.json(job);
});
