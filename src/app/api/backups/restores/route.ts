import { NextResponse } from "next/server";
import { PostgresRestoreStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureBossStarted } from "@/lib/pg-boss";
import { restoreCreateSchema } from "@/lib/validations/backups";
import { serializeRestoreJob, validateRestoreReferences } from "@/lib/backups/api-helpers";
import { buildJobSingletonKey } from "@/lib/worker-guardrails";

const restoreInclude = {
  policy: {
    select: {
      id: true,
      name: true,
      sourceConnection: { select: { id: true, name: true, config: true } },
      storageTarget: { select: { id: true, name: true, provider: true, config: true } },
    },
  },
  backupRun: {
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      completedAt: true,
      checksumSha256: true,
      bytesWritten: true,
    },
  },
  targetConnection: {
    select: { id: true, name: true, type: true, config: true },
  },
  triggeredByUser: {
    select: { id: true, name: true, email: true },
  },
};

export const GET = withAuth(async (_req, session) => {
  const jobs = await prisma.postgresRestoreJob.findMany({
    where: { tenantId: session.tenantId },
    include: restoreInclude,
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return NextResponse.json(jobs.map(serializeRestoreJob));
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = restoreCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const references = await validateRestoreReferences(parsed.data, session);
  if (!references.ok) {
    return NextResponse.json({ error: references.error }, { status: references.status });
  }

  const runningOnTarget = await prisma.postgresRestoreJob.findFirst({
    where: {
      targetConnectionId: parsed.data.targetConnectionId,
      tenantId: session.tenantId,
      status: PostgresRestoreStatus.RUNNING,
    },
    select: { id: true },
  });
  if (runningOnTarget) {
    return NextResponse.json(
      { error: "A restore is already running for this target connection" },
      { status: 409 }
    );
  }

  const restoreJob = await prisma.postgresRestoreJob.create({
    data: {
      policyId: parsed.data.policyId,
      backupRunId: parsed.data.backupRunId,
      targetConnectionId: parsed.data.targetConnectionId,
      mode: parsed.data.mode,
      status: PostgresRestoreStatus.RUNNING,
      options: parsed.data.options as Prisma.InputJsonValue,
      objectKey: references.objectKey,
      checksumSha256: references.objectChecksumSha256 ?? references.backupRun.checksumSha256,
      triggeredByUserId: session.userId,
      tenantId: session.tenantId,
    },
    include: restoreInclude,
  });

  try {
    const boss = await ensureBossStarted();
    await boss.send(
      "postgres-restore",
      { restoreJobId: restoreJob.id },
      { singletonKey: buildJobSingletonKey("postgres-restore", restoreJob.id) }
    );
  } catch {
    await prisma.postgresRestoreJob.update({
      where: { id: restoreJob.id },
      data: {
        status: PostgresRestoreStatus.FAILED,
        error: "Failed to enqueue restore job",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: "Failed to enqueue restore job" }, { status: 500 });
  }

  return NextResponse.json(serializeRestoreJob(restoreJob), { status: 201 });
}, { minimumRole: "ADMIN" });
