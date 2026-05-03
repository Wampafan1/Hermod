import { NextResponse } from "next/server";
import { BackupRunStatus, BackupRunType } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureBossStarted } from "@/lib/pg-boss";

function extractId(url: string): string | null {
  return url.split("/backups/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
    select: { id: true, enabled: true, tenantId: true, userId: true },
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });
  if (!policy.enabled) {
    return NextResponse.json({ error: "Backup policy is disabled" }, { status: 409 });
  }

  const run = await prisma.$transaction(async (tx) => {
    const active = await tx.postgresBackupRun.findFirst({
      where: { policyId: id, type: BackupRunType.FULL_LOGICAL, status: BackupRunStatus.RUNNING },
      select: { id: true },
    });
    if (active) return null;

    return tx.postgresBackupRun.create({
      data: {
        policyId: id,
        type: BackupRunType.FULL_LOGICAL,
        status: BackupRunStatus.RUNNING,
        triggeredBy: "manual",
        tenantId: policy.tenantId,
        userId: policy.userId,
      },
      select: { id: true },
    });
  }, { isolationLevel: "Serializable" });

  if (!run) {
    return NextResponse.json({ error: "A full backup is already running" }, { status: 409 });
  }

  try {
    const boss = await ensureBossStarted();
    await boss.send(
      "postgres-backup-full",
      { policyId: id, triggeredBy: "manual", runId: run.id },
      { singletonKey: `backup-full-${id}` }
    );
    return NextResponse.json({ queued: true, runId: run.id });
  } catch {
    await prisma.postgresBackupRun.update({
      where: { id: run.id },
      data: {
        status: BackupRunStatus.FAILED,
        error: "Failed to enqueue backup job",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Failed to enqueue backup job" }, { status: 500 });
  }
}, { minimumRole: "ADMIN" });
