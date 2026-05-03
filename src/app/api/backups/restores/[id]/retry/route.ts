import { NextResponse } from "next/server";
import { PostgresRestoreStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureBossStarted } from "@/lib/pg-boss";
import { serializeRestoreJob } from "@/lib/backups/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/restores/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing restore job ID" }, { status: 400 });

  const existing = await prisma.postgresRestoreJob.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, status: true, targetConnectionId: true },
  });
  if (!existing) return NextResponse.json({ error: "Restore job not found" }, { status: 404 });
  if (existing.status !== PostgresRestoreStatus.FAILED) {
    return NextResponse.json({ error: "Only failed restore jobs can be retried" }, { status: 409 });
  }

  const runningOnTarget = await prisma.postgresRestoreJob.findFirst({
    where: {
      targetConnectionId: existing.targetConnectionId,
      status: PostgresRestoreStatus.RUNNING,
      NOT: { id },
    },
    select: { id: true },
  });
  if (runningOnTarget) {
    return NextResponse.json(
      { error: "A restore is already running for this target connection" },
      { status: 409 }
    );
  }

  const job = await prisma.postgresRestoreJob.update({
    where: { id },
    data: {
      status: PostgresRestoreStatus.RUNNING,
      error: null,
      checksumVerified: false,
      bytesDownloaded: null,
      durationMs: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });

  try {
    const boss = await ensureBossStarted();
    await boss.send(
      "postgres-restore",
      { restoreJobId: id },
      { singletonKey: `restore-${id}` }
    );
  } catch {
    await prisma.postgresRestoreJob.update({
      where: { id },
      data: {
        status: PostgresRestoreStatus.FAILED,
        error: "Failed to enqueue restore job",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Failed to enqueue restore job" }, { status: 500 });
  }

  return NextResponse.json(serializeRestoreJob(job));
}, { minimumRole: "ADMIN" });
