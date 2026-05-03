import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runPostgresBackupPreflight } from "@/lib/backups/postgres/preflight";
import { postgresConnectionScope } from "@/lib/backups/postgres/database-selection";

function extractId(url: string): string | null {
  return url.split("/backups/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId },
    select: {
      id: true,
      walEnabled: true,
      replicationSlot: true,
      sourceConnection: { select: { config: true } },
    },
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  const result = await runPostgresBackupPreflight({
    walEnabled: policy.walEnabled,
    replicationSlot: policy.replicationSlot,
  });

  if (policy.walEnabled && postgresConnectionScope(policy.sourceConnection.config) !== "SERVER") {
    result.checks.push({
      name: "server-scoped-connection",
      ok: false,
      message: "WAL/PITR coverage is cluster-level and requires a SERVER-scoped PostgreSQL connection",
    });
    result.ok = false;
  }

  return NextResponse.json(result);
});
