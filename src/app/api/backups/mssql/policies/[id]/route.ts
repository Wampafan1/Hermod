import { NextResponse } from "next/server";
import { MssqlBackupPolicyStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { updateMssqlBackupPolicySchema } from "@/lib/validations/mssql-backups";
import { calculateNextBackupRun } from "@/lib/backups/schedule";
import { computeMssqlBackupCoverage } from "@/lib/backups/mssql/mssql-coverage";
import {
  normalizeMssqlDatabaseSelection,
  serializeMssqlRun,
  validateMssqlBackupPolicyReferences,
} from "@/lib/backups/mssql/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/mssql/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

const includePolicy = {
  sourceConnection: { select: { id: true, name: true, type: true, config: true } },
  storageTarget: { select: { id: true, name: true, provider: true, config: true, status: true } },
  runs: {
    take: 1,
    orderBy: { startedAt: "desc" as const },
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
};

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });

  const policy = await prisma.mssqlBackupPolicy.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
    include: includePolicy,
  });
  if (!policy) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });

  const [artifactCount, byteSummary] = await Promise.all([
    prisma.mssqlBackupRun.count({ where: { policyId: policy.id, status: "SUCCESS" } }),
    prisma.mssqlBackupRun.aggregate({ where: { policyId: policy.id, status: "SUCCESS" }, _sum: { bytesWritten: true } }),
  ]);
  const latestRun = policy.runs[0] ?? null;
  return NextResponse.json({
    ...policy,
    runs: policy.runs.map(serializeMssqlRun),
    artifactCount,
    totalBytesStored: byteSummary._sum.bytesWritten?.toString() ?? "0",
    latestChecksum: latestRun?.checksumSha256 ?? null,
    coverage: computeMssqlBackupCoverage(policy, latestRun),
  });
});

export const PUT = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });

  const existing = await prisma.mssqlBackupPolicy.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
  });
  if (!existing) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateMssqlBackupPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const merged = {
    sourceConnectionId: data.sourceConnectionId ?? existing.sourceConnectionId,
    storageTargetId: data.storageTargetId !== undefined ? data.storageTargetId : existing.storageTargetId,
    databaseSelectionMode: data.databaseSelectionMode ?? existing.databaseSelectionMode,
    selectedDatabases: data.selectedDatabases ?? existing.selectedDatabases,
    excludedDatabases: data.excludedDatabases ?? existing.excludedDatabases,
    databasePattern: data.databasePattern !== undefined ? data.databasePattern : existing.databasePattern,
  };
  const references = await validateMssqlBackupPolicyReferences(merged as any, session);
  if (!references.ok) return NextResponse.json({ error: references.error }, { status: references.status });
  const databaseSelection = normalizeMssqlDatabaseSelection(merged as any, references.sourceConfig);

  const enabled = data.enabled ?? existing.enabled;
  const fullFrequency = data.fullFrequency ?? existing.fullFrequency;
  const differentialFrequency = data.differentialFrequency !== undefined ? data.differentialFrequency : existing.differentialFrequency;
  const logFrequency = data.logFrequency !== undefined ? data.logFrequency : existing.logFrequency;
  const fullTimeHour = data.fullTimeHour ?? existing.fullTimeHour;
  const fullTimeMinute = data.fullTimeMinute ?? existing.fullTimeMinute;
  const timezone = data.timezone ?? existing.timezone;
  const shouldRecalculate =
    data.enabled !== undefined ||
    data.fullFrequency !== undefined ||
    data.differentialFrequency !== undefined ||
    data.logFrequency !== undefined ||
    data.fullTimeHour !== undefined ||
    data.fullTimeMinute !== undefined ||
    data.timezone !== undefined;

  const updateData: Prisma.MssqlBackupPolicyUpdateInput = {
    databaseSelectionMode: databaseSelection.databaseSelectionMode,
    selectedDatabases: databaseSelection.selectedDatabases,
    excludedDatabases: databaseSelection.excludedDatabases,
    databasePattern: databaseSelection.databasePattern,
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.sourceConnectionId !== undefined) updateData.sourceConnection = { connect: { id: data.sourceConnectionId } };
  if (data.storageTargetId !== undefined) {
    updateData.storageTarget = data.storageTargetId ? { connect: { id: data.storageTargetId } } : { disconnect: true };
  }
  if (data.destinationMode !== undefined) updateData.destinationMode = data.destinationMode;
  if (data.fullFrequency !== undefined) updateData.fullFrequency = data.fullFrequency;
  if (data.differentialFrequency !== undefined) updateData.differentialFrequency = data.differentialFrequency ?? null;
  if (data.logFrequency !== undefined) updateData.logFrequency = data.logFrequency ?? null;
  if (data.fullTimeHour !== undefined) updateData.fullTimeHour = data.fullTimeHour;
  if (data.fullTimeMinute !== undefined) updateData.fullTimeMinute = data.fullTimeMinute;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.backupPath !== undefined) updateData.backupPath = data.backupPath ?? null;
  if (data.hermodReadablePath !== undefined) updateData.hermodReadablePath = data.hermodReadablePath ?? null;
  if (data.urlCredentialName !== undefined) updateData.urlCredentialName = data.urlCredentialName ?? null;
  if (data.urlBase !== undefined) updateData.urlBase = data.urlBase ?? null;
  if (data.compressionEnabled !== undefined) updateData.compressionEnabled = data.compressionEnabled;
  if (data.checksumEnabled !== undefined) updateData.checksumEnabled = data.checksumEnabled;
  if (data.copyOnly !== undefined) updateData.copyOnly = data.copyOnly;
  if (data.verifyAfterBackup !== undefined) updateData.verifyAfterBackup = data.verifyAfterBackup;
  if (data.retentionDays !== undefined) updateData.retentionDays = data.retentionDays;
  if (data.storageLayout !== undefined) updateData.storageLayout = data.storageLayout;
  if (data.enabled !== undefined && data.status === undefined) {
    updateData.status = data.enabled ? MssqlBackupPolicyStatus.ACTIVE : MssqlBackupPolicyStatus.DISABLED;
  }

  if (shouldRecalculate) {
    updateData.nextFullRunAt = enabled ? calculateNextBackupRun({ frequency: fullFrequency as any, timeHour: fullTimeHour, timeMinute: fullTimeMinute, timezone }) : null;
    updateData.nextDifferentialRunAt = enabled && differentialFrequency ? calculateNextBackupRun({ frequency: differentialFrequency as any, timeHour: fullTimeHour, timeMinute: fullTimeMinute, timezone }) : null;
    updateData.nextLogRunAt = enabled && logFrequency ? calculateNextBackupRun({ frequency: logFrequency as any, timeHour: fullTimeHour, timeMinute: fullTimeMinute, timezone }) : null;
  }

  const policy = await prisma.mssqlBackupPolicy.update({ where: { id }, data: updateData });
  return NextResponse.json(policy);
}, { minimumRole: "ADMIN" });

export const DELETE = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });

  const existing = await prisma.mssqlBackupPolicy.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });

  const running = await prisma.mssqlBackupRun.count({ where: { policyId: id, status: "RUNNING" } });
  if (running > 0) {
    return NextResponse.json({ error: "Cannot delete a SQL Server backup policy while a run is active" }, { status: 409 });
  }
  await prisma.mssqlBackupPolicy.delete({ where: { id } });
  return NextResponse.json({ success: true });
}, { minimumRole: "ADMIN" });
