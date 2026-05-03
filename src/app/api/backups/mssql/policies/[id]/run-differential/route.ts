import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureBossStarted } from "@/lib/pg-boss";

function extractId(url: string): string | null {
  return url.split("/backups/mssql/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });
  const policy = await prisma.mssqlBackupPolicy.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
    select: { id: true, enabled: true },
  });
  if (!policy) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });
  if (!policy.enabled) return NextResponse.json({ error: "SQL Server backup policy is disabled" }, { status: 409 });
  const running = await prisma.mssqlBackupRun.count({ where: { policyId: id, type: "DIFFERENTIAL", status: "RUNNING" } });
  if (running > 0) return NextResponse.json({ error: "A SQL Server differential backup is already running" }, { status: 409 });
  const boss = await ensureBossStarted();
  await boss.send("mssql-backup-differential", { policyId: id, triggeredBy: "manual" }, { singletonKey: `mssql-diff-${id}` });
  return NextResponse.json({ queued: true });
}, { minimumRole: "ADMIN" });
