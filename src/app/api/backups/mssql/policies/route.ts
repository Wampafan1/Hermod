import { NextResponse } from "next/server";
import { MssqlBackupPolicyStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createMssqlBackupPolicySchema } from "@/lib/validations/mssql-backups";
import { calculateNextBackupRun } from "@/lib/backups/schedule";
import { computeMssqlBackupCoverage } from "@/lib/backups/mssql/mssql-coverage";
import {
  normalizeMssqlDatabaseSelection,
  serializeMssqlRun,
  validateMssqlBackupPolicyReferences,
} from "@/lib/backups/mssql/api-helpers";

export const GET = withAuth(async (_req, session) => {
  const policies = await prisma.mssqlBackupPolicy.findMany({
    where: { userId: session.userId },
    include: {
      sourceConnection: { select: { id: true, name: true, type: true, config: true } },
      storageTarget: { select: { id: true, name: true, provider: true, config: true, status: true } },
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
          databaseName: true,
          error: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const enriched = await Promise.all(policies.map(async (policy) => {
    const [artifactCount, byteSummary] = await Promise.all([
      prisma.mssqlBackupRun.count({
        where: { policyId: policy.id, status: "SUCCESS" },
      }),
      prisma.mssqlBackupRun.aggregate({
        where: { policyId: policy.id, status: "SUCCESS" },
        _sum: { bytesWritten: true },
      }),
    ]);
    const latestRun = policy.runs[0] ?? null;
    return {
      ...policy,
      runs: policy.runs.map(serializeMssqlRun),
      artifactCount,
      totalBytesStored: byteSummary._sum.bytesWritten?.toString() ?? "0",
      latestChecksum: latestRun?.checksumSha256 ?? null,
      coverage: computeMssqlBackupCoverage(policy, latestRun),
    };
  }));

  return NextResponse.json(enriched);
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createMssqlBackupPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const references = await validateMssqlBackupPolicyReferences(data, session);
  if (!references.ok) return NextResponse.json({ error: references.error }, { status: references.status });
  const databaseSelection = normalizeMssqlDatabaseSelection(data, references.sourceConfig);
  const now = new Date();

  const policy = await prisma.mssqlBackupPolicy.create({
    data: {
      name: data.name,
      enabled: data.enabled,
      status: data.enabled ? MssqlBackupPolicyStatus.ACTIVE : MssqlBackupPolicyStatus.DISABLED,
      sourceConnectionId: data.sourceConnectionId,
      storageTargetId: data.storageTargetId ?? null,
      destinationMode: data.destinationMode,
      databaseSelectionMode: databaseSelection.databaseSelectionMode,
      selectedDatabases: databaseSelection.selectedDatabases,
      excludedDatabases: databaseSelection.excludedDatabases,
      databasePattern: databaseSelection.databasePattern,
      fullFrequency: data.fullFrequency,
      differentialFrequency: data.differentialFrequency ?? null,
      logFrequency: data.logFrequency ?? null,
      fullTimeHour: data.fullTimeHour,
      fullTimeMinute: data.fullTimeMinute,
      timezone: data.timezone,
      nextFullRunAt: data.enabled ? calculateNextBackupRun({
        frequency: data.fullFrequency,
        timeHour: data.fullTimeHour,
        timeMinute: data.fullTimeMinute,
        timezone: data.timezone,
      }, now) : null,
      nextDifferentialRunAt: data.enabled && data.differentialFrequency ? calculateNextBackupRun({
        frequency: data.differentialFrequency,
        timeHour: data.fullTimeHour,
        timeMinute: data.fullTimeMinute,
        timezone: data.timezone,
      }, now) : null,
      nextLogRunAt: data.enabled && data.logFrequency ? calculateNextBackupRun({
        frequency: data.logFrequency,
        timeHour: data.fullTimeHour,
        timeMinute: data.fullTimeMinute,
        timezone: data.timezone,
      }, now) : null,
      backupPath: data.backupPath ?? null,
      hermodReadablePath: data.hermodReadablePath ?? null,
      urlCredentialName: data.urlCredentialName ?? null,
      urlBase: data.urlBase ?? null,
      compressionEnabled: data.compressionEnabled,
      checksumEnabled: data.checksumEnabled,
      copyOnly: data.copyOnly,
      verifyAfterBackup: data.verifyAfterBackup,
      retentionDays: data.retentionDays,
      userId: session.userId,
      tenantId: session.tenantId,
    },
  });

  return NextResponse.json(policy, { status: 201 });
}, { minimumRole: "ADMIN" });
