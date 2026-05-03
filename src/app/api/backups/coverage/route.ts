import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { computeBackupCoverage } from "@/lib/backups/coverage";

export const GET = withAuth(async (_req, session) => {
  const policies = await prisma.postgresBackupPolicy.findMany({
    where: { userId: session.userId, tenantId: session.tenantId },
    include: {
      runs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: {
          status: true,
          triggeredBy: true,
          startedAt: true,
        },
      },
    },
  });

  const coverage = policies.map((policy) => computeBackupCoverage(policy, policy.runs[0] ?? null));
  const byStatus = coverage.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  const [artifactCount, byteSummary] = await Promise.all([
    prisma.postgresBackupRun.count({
      where: {
        userId: session.userId,
        tenantId: session.tenantId,
        status: { in: ["SUCCESS", "PARTIAL"] },
      },
    }),
    prisma.postgresBackupRun.aggregate({
      where: {
        userId: session.userId,
        tenantId: session.tenantId,
        status: { in: ["SUCCESS", "PARTIAL"] },
      },
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
