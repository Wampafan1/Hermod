import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { computeMssqlBackupCoverage } from "@/lib/backups/mssql/mssql-coverage";

export const GET = withAuth(async (_req, session) => {
  const policies = await prisma.mssqlBackupPolicy.findMany({
    where: { userId: session.userId, tenantId: session.tenantId },
    include: {
      runs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { status: true, triggeredBy: true, startedAt: true, type: true },
      },
    },
  });

  const coverage = policies.map((policy) => computeMssqlBackupCoverage(policy, policy.runs[0] ?? null));
  const byStatus = coverage.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  const [artifactCount, byteSummary] = await Promise.all([
    prisma.mssqlBackupRun.count({
      where: { userId: session.userId, tenantId: session.tenantId, status: "SUCCESS" },
    }),
    prisma.mssqlBackupRun.aggregate({
      where: { userId: session.userId, tenantId: session.tenantId, status: "SUCCESS" },
      _sum: { bytesWritten: true },
    }),
  ]);

  return NextResponse.json({
    policyCount: policies.length,
    artifactCount,
    totalBytesStored: byteSummary._sum.bytesWritten?.toString() ?? "0",
    byStatus,
  });
});
