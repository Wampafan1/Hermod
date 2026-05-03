import { NextResponse } from "next/server";
import { BackupPolicyStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createBackupPolicySchema } from "@/lib/validations/backups";
import { calculateNextBackupRun } from "@/lib/backups/schedule";
import { computeBackupCoverage } from "@/lib/backups/coverage";
import {
  extractObjectKeys,
  normalizeBackupDatabaseSelection,
  validateBackupPolicyReferences,
} from "@/lib/backups/api-helpers";

export const GET = withAuth(async (_req, session) => {
  const policies = await prisma.postgresBackupPolicy.findMany({
    where: { userId: session.userId, tenantId: session.tenantId },
    include: {
      sourceConnection: {
        select: { id: true, name: true, type: true, config: true },
      },
      storageTarget: {
        select: { id: true, name: true, provider: true, config: true, status: true },
      },
      runs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          triggeredBy: true,
          startedAt: true,
          completedAt: true,
          bytesWritten: true,
          checksumSha256: true,
          error: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const enriched = await Promise.all(
    policies.map(async (policy) => {
      const [artifactRuns, byteSummary] = await Promise.all([
        prisma.postgresBackupRun.findMany({
          where: {
            policyId: policy.id,
            status: { in: ["SUCCESS", "PARTIAL"] },
          },
          select: { objectKeys: true },
        }),
        prisma.postgresBackupRun.aggregate({
          where: {
            policyId: policy.id,
            status: { in: ["SUCCESS", "PARTIAL"] },
          },
          _sum: { bytesWritten: true },
        }),
      ]);
      const latestRun = policy.runs[0] ?? null;
      const artifactCount = artifactRuns.reduce(
        (total, run) => total + extractObjectKeys(run.objectKeys).length,
        0
      );
      return {
        ...policy,
        runs: policy.runs.map((run) => ({
          ...run,
          bytesWritten: run.bytesWritten?.toString() ?? null,
        })),
        artifactCount,
        totalBytesStored: byteSummary._sum.bytesWritten?.toString() ?? "0",
        latestChecksum: latestRun?.checksumSha256 ?? null,
        coverage: computeBackupCoverage(policy, latestRun),
      };
    })
  );

  return NextResponse.json(enriched);
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createBackupPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const references = await validateBackupPolicyReferences(data, session);
  if (!references.ok) {
    return NextResponse.json({ error: references.error }, { status: references.status });
  }
  const source = await prisma.connection.findFirst({
    where: { id: data.sourceConnectionId, userId: session.userId, tenantId: session.tenantId },
    select: { config: true },
  });
  if (!source) {
    return NextResponse.json({ error: "PostgreSQL source connection not found" }, { status: 404 });
  }
  const databaseSelection = normalizeBackupDatabaseSelection(data, source.config);

  const now = new Date();
  const nextFullRunAt = data.enabled
    ? calculateNextBackupRun({
        frequency: data.fullFrequency,
        timeHour: data.timeHour,
        timeMinute: data.timeMinute,
        timezone: data.timezone,
      }, now)
    : null;
  const nextWalRunAt = data.enabled && data.walEnabled
    ? calculateNextBackupRun({
        frequency: data.walFrequency,
        timeHour: data.timeHour,
        timeMinute: data.timeMinute,
        timezone: data.timezone,
      }, now)
    : null;

  const policy = await prisma.postgresBackupPolicy.create({
    data: {
      name: data.name,
      enabled: data.enabled,
      sourceConnectionId: data.sourceConnectionId,
      storageTargetId: data.storageTargetId,
      fullFrequency: data.fullFrequency,
      walFrequency: data.walFrequency,
      timeHour: data.timeHour,
      timeMinute: data.timeMinute,
      timezone: data.timezone,
      nextFullRunAt,
      nextWalRunAt,
      retentionDays: data.retentionDays,
      storagePrefix: data.storagePrefix ?? null,
      storageLayout: data.storageLayout,
      databaseSelectionMode: databaseSelection.databaseSelectionMode,
      selectedDatabases: databaseSelection.selectedDatabases,
      excludedDatabases: databaseSelection.excludedDatabases,
      databasePattern: databaseSelection.databasePattern,
      walEnabled: data.walEnabled,
      replicationSlot: data.replicationSlot ?? null,
      status: data.enabled ? BackupPolicyStatus.ACTIVE : BackupPolicyStatus.DISABLED,
      userId: session.userId,
      tenantId: session.tenantId,
    },
  });

  return NextResponse.json(policy, { status: 201 });
}, { minimumRole: "ADMIN" });
