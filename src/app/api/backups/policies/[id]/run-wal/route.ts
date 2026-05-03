import { NextResponse } from "next/server";
import { BackupRunStatus, BackupRunType } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureBossStarted } from "@/lib/pg-boss";
import { postgresConnectionScope } from "@/lib/backups/postgres/database-selection";

function extractId(url: string): string | null {
  return url.split("/backups/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      enabled: true,
      walEnabled: true,
      replicationSlot: true,
      tenantId: true,
      userId: true,
      sourceConnection: { select: { config: true } },
    },
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });
  if (!policy.enabled) {
    return NextResponse.json({ error: "Backup policy is disabled" }, { status: 409 });
  }
  if (!policy.walEnabled) {
    return NextResponse.json({ error: "WAL/PITR coverage is disabled for this policy" }, { status: 400 });
  }
  if (!policy.replicationSlot) {
    return NextResponse.json({ error: "Replication slot is required before WAL archival can run" }, { status: 400 });
  }
  if (postgresConnectionScope(policy.sourceConnection.config) !== "SERVER") {
    return NextResponse.json(
      { error: "WAL/PITR coverage requires a SERVER-scoped PostgreSQL connection because WAL is cluster-level" },
      { status: 400 }
    );
  }

  const run = await prisma.$transaction(async (tx) => {
    const active = await tx.postgresBackupRun.findFirst({
      where: { policyId: id, type: BackupRunType.WAL_ARCHIVE, status: BackupRunStatus.RUNNING },
      select: { id: true },
    });
    if (active) return null;

    return tx.postgresBackupRun.create({
      data: {
        policyId: id,
        type: BackupRunType.WAL_ARCHIVE,
        status: BackupRunStatus.RUNNING,
        triggeredBy: "manual",
        tenantId: policy.tenantId,
        userId: policy.userId,
      },
      select: { id: true },
    });
  }, { isolationLevel: "Serializable" });

  if (!run) {
    return NextResponse.json({ error: "A WAL archive is already running" }, { status: 409 });
  }

  try {
    const boss = await ensureBossStarted();
    await boss.send(
      "postgres-backup-wal",
      { policyId: id, triggeredBy: "manual", runId: run.id },
      { singletonKey: `backup-wal-${id}` }
    );
    return NextResponse.json({ queued: true, runId: run.id });
  } catch {
    await prisma.postgresBackupRun.update({
      where: { id: run.id },
      data: {
        status: BackupRunStatus.FAILED,
        error: "Failed to enqueue WAL archive job",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Failed to enqueue WAL archive job" }, { status: 500 });
  }
}, { minimumRole: "ADMIN" });
