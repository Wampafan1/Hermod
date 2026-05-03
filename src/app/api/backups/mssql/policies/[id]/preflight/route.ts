import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

function extractId(url: string): string | null {
  return url.split("/backups/mssql/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });

  const policy = await prisma.mssqlBackupPolicy.findFirst({
    where: { id, userId: session.userId },
  });
  if (!policy) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });

  const origin = new URL(req.url).origin;
  const response = await fetch(`${origin}/api/backups/mssql/policies/preflight`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({
      sourceConnectionId: policy.sourceConnectionId,
      storageTargetId: policy.storageTargetId,
      destinationMode: policy.destinationMode,
      databaseSelectionMode: policy.databaseSelectionMode,
      selectedDatabases: policy.selectedDatabases,
      excludedDatabases: policy.excludedDatabases,
      databasePattern: policy.databasePattern,
      fullFrequency: policy.fullFrequency,
      differentialFrequency: policy.differentialFrequency,
      logFrequency: policy.logFrequency,
      fullTimeHour: policy.fullTimeHour,
      fullTimeMinute: policy.fullTimeMinute,
      timezone: policy.timezone,
      backupPath: policy.backupPath,
      hermodReadablePath: policy.hermodReadablePath,
      urlCredentialName: policy.urlCredentialName,
      urlBase: policy.urlBase,
      compressionEnabled: policy.compressionEnabled,
      checksumEnabled: policy.checksumEnabled,
      copyOnly: policy.copyOnly,
      verifyAfterBackup: policy.verifyAfterBackup,
      retentionDays: policy.retentionDays,
      enabled: policy.enabled,
    }),
  });
  const result = await response.json().catch(() => ({ ok: false, error: "Preflight failed" }));
  return NextResponse.json(result, { status: response.status });
}, { minimumRole: "ADMIN" });
