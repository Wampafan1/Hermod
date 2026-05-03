import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializeMssqlRun } from "@/lib/backups/mssql/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/mssql/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing SQL Server backup policy ID" }, { status: 400 });

  const policy = await prisma.mssqlBackupPolicy.findFirst({ where: { id, userId: session.userId }, select: { id: true } });
  if (!policy) return NextResponse.json({ error: "SQL Server backup policy not found" }, { status: 404 });

  await prisma.mssqlBackupRun.updateMany({
    where: {
      policyId: id,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 125 * 60_000) },
    },
    data: {
      status: "FAILED",
      error: "Timed out - worker crashed or hung before completion",
      completedAt: new Date(),
    },
  });

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const PAGE_SIZE = 50;
  const runs = await prisma.mssqlBackupRun.findMany({
    where: { policyId: id },
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = runs.length > PAGE_SIZE;
  const items = hasMore ? runs.slice(0, PAGE_SIZE) : runs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({
    items: items.map(serializeMssqlRun),
    nextCursor,
  });
});
