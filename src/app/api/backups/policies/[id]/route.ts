import { NextResponse } from "next/server";
import { BackupPolicyStatus, Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { updateBackupPolicySchema } from "@/lib/validations/backups";
import { calculateNextBackupRun } from "@/lib/backups/schedule";
import { computeBackupCoverage } from "@/lib/backups/coverage";
import {
  extractObjectKeys,
  normalizeBackupDatabaseSelection,
  validateBackupPolicyReferences,
  validateWalConfiguration,
} from "@/lib/backups/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

const policyInclude = {
  sourceConnection: {
    select: { id: true, name: true, type: true, config: true },
  },
  storageTarget: {
    select: { id: true, name: true, provider: true, config: true, status: true },
  },
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
      error: true,
    },
  },
};

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
    include: policyInclude,
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  const latestRun = policy.runs[0] ?? null;
  const [artifactRuns, byteSummary] = await Promise.all([
    prisma.postgresBackupRun.findMany({
      where: { policyId: policy.id, status: { in: ["SUCCESS", "PARTIAL"] } },
      select: { objectKeys: true },
    }),
    prisma.postgresBackupRun.aggregate({
      where: { policyId: policy.id, status: { in: ["SUCCESS", "PARTIAL"] } },
      _sum: { bytesWritten: true },
    }),
  ]);
  const artifactCount = artifactRuns.reduce(
    (total, run) => total + extractObjectKeys(run.objectKeys).length,
    0
  );

  return NextResponse.json({
    ...policy,
    runs: policy.runs.map((run) => ({
      ...run,
      bytesWritten: run.bytesWritten?.toString() ?? null,
    })),
    artifactCount,
    totalBytesStored: byteSummary._sum.bytesWritten?.toString() ?? "0",
    latestChecksum: latestRun?.checksumSha256 ?? null,
    coverage: computeBackupCoverage(policy, latestRun),
  });
});

export const PUT = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const existing = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
  });
  if (!existing) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateBackupPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const merged = {
    sourceConnectionId: data.sourceConnectionId ?? existing.sourceConnectionId,
    storageTargetId: data.storageTargetId ?? existing.storageTargetId,
    walEnabled: data.walEnabled ?? existing.walEnabled,
    replicationSlot: data.replicationSlot !== undefined ? data.replicationSlot : existing.replicationSlot,
    databaseSelectionMode: data.databaseSelectionMode ?? existing.databaseSelectionMode,
    selectedDatabases: data.selectedDatabases ?? existing.selectedDatabases,
    excludedDatabases: data.excludedDatabases ?? existing.excludedDatabases,
    databasePattern: data.databasePattern !== undefined ? data.databasePattern : existing.databasePattern,
  };

  const source = await prisma.connection.findFirst({
    where: { id: merged.sourceConnectionId, userId: session.userId },
    select: { config: true },
  });
  if (!source) {
    return NextResponse.json({ error: "PostgreSQL source connection not found" }, { status: 404 });
  }

  const databaseSelection = normalizeBackupDatabaseSelection(merged, source.config);

  const wal = validateWalConfiguration({ ...merged, sourceConfig: source.config });
  if (!wal.ok) return NextResponse.json({ error: wal.error }, { status: 400 });

  if (
    data.sourceConnectionId !== undefined ||
    data.storageTargetId !== undefined ||
    data.walEnabled !== undefined ||
    data.databaseSelectionMode !== undefined ||
    data.selectedDatabases !== undefined ||
    data.excludedDatabases !== undefined ||
    data.databasePattern !== undefined
  ) {
    const references = await validateBackupPolicyReferences(merged, session);
    if (!references.ok) {
      return NextResponse.json({ error: references.error }, { status: references.status });
    }
  }

  const enabled = data.enabled ?? existing.enabled;
  const fullFrequency = data.fullFrequency ?? existing.fullFrequency;
  const walFrequency = data.walFrequency !== undefined ? data.walFrequency : existing.walFrequency;
  const timeHour = data.timeHour ?? existing.timeHour;
  const timeMinute = data.timeMinute ?? existing.timeMinute;
  const timezone = data.timezone ?? existing.timezone;
  const walEnabled = data.walEnabled ?? existing.walEnabled;
  const shouldRecalculateFull =
    data.enabled !== undefined ||
    data.fullFrequency !== undefined ||
    data.timeHour !== undefined ||
    data.timeMinute !== undefined ||
    data.timezone !== undefined;
  const shouldRecalculateWal =
    shouldRecalculateFull ||
    data.walEnabled !== undefined ||
    data.walFrequency !== undefined;

  const updateData: Prisma.PostgresBackupPolicyUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.sourceConnectionId !== undefined) {
    updateData.sourceConnection = { connect: { id: data.sourceConnectionId } };
  }
  if (data.storageTargetId !== undefined) {
    updateData.storageTarget = { connect: { id: data.storageTargetId } };
  }
  if (data.fullFrequency !== undefined) updateData.fullFrequency = data.fullFrequency;
  if (data.walFrequency !== undefined) updateData.walFrequency = data.walFrequency;
  if (data.timeHour !== undefined) updateData.timeHour = data.timeHour;
  if (data.timeMinute !== undefined) updateData.timeMinute = data.timeMinute;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.retentionDays !== undefined) updateData.retentionDays = data.retentionDays;
  if (data.storagePrefix !== undefined) updateData.storagePrefix = data.storagePrefix ?? null;
  updateData.databaseSelectionMode = databaseSelection.databaseSelectionMode;
  updateData.selectedDatabases = databaseSelection.selectedDatabases;
  updateData.excludedDatabases = databaseSelection.excludedDatabases;
  updateData.databasePattern = databaseSelection.databasePattern;
  if (data.walEnabled !== undefined) updateData.walEnabled = data.walEnabled;
  if (data.replicationSlot !== undefined) updateData.replicationSlot = data.replicationSlot ?? null;
  if (data.status !== undefined) updateData.status = data.status;

  if (shouldRecalculateFull) {
    updateData.nextFullRunAt = enabled
      ? calculateNextBackupRun({ frequency: fullFrequency as any, timeHour, timeMinute, timezone })
      : null;
  }
  if (shouldRecalculateWal) {
    updateData.nextWalRunAt = enabled && walEnabled
      ? calculateNextBackupRun({ frequency: (walFrequency ?? "HOURLY") as any, timeHour, timeMinute, timezone })
      : null;
  }
  if (data.enabled !== undefined && data.status === undefined) {
    updateData.status = data.enabled ? BackupPolicyStatus.ACTIVE : BackupPolicyStatus.DISABLED;
  }

  const policy = await prisma.postgresBackupPolicy.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(policy);
}, { minimumRole: "ADMIN" });

export const DELETE = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const existing = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  const running = await prisma.postgresBackupRun.count({
    where: { policyId: id, status: "RUNNING" },
  });
  if (running > 0) {
    return NextResponse.json(
      { error: "Cannot delete a backup policy while a run is active" },
      { status: 409 }
    );
  }

  await prisma.postgresBackupPolicy.delete({ where: { id } });
  return NextResponse.json({ success: true });
}, { minimumRole: "ADMIN" });
