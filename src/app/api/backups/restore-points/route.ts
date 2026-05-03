import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { databaseNameFromConnectionConfig, serializeBackupRun } from "@/lib/backups/api-helpers";

export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const policyId = url.searchParams.get("policyId");
  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id: policyId, userId: session.userId },
    select: {
      id: true,
      name: true,
      sourceConnection: {
        select: { id: true, name: true, config: true },
      },
      storageTarget: {
        select: { id: true, name: true, provider: true, config: true },
      },
    },
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  const runs = await prisma.postgresBackupRun.findMany({
    where: {
      policyId,
      status: { in: ["SUCCESS", "PARTIAL"] },
      type: "FULL_LOGICAL",
    },
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      status: true,
      objectKeys: true,
      bytesWritten: true,
      checksumSha256: true,
      durationMs: true,
      startedAt: true,
      completedAt: true,
      triggeredBy: true,
    },
  });

  return NextResponse.json({
    policy: {
      id: policy.id,
      name: policy.name,
      sourceConnection: {
        ...policy.sourceConnection,
        database: databaseNameFromConnectionConfig(policy.sourceConnection.config),
      },
      storageTarget: policy.storageTarget,
    },
    items: runs.map(serializeBackupRun),
  });
});
