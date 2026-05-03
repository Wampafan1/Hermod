import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

function extractId(url: string): string | null {
  return url.split("/backups/policies/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing backup policy ID" }, { status: 400 });

  const policy = await prisma.postgresBackupPolicy.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!policy) return NextResponse.json({ error: "Backup policy not found" }, { status: 404 });

  await prisma.postgresBackupRun.updateMany({
    where: {
      policyId: id,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 75 * 60_000) },
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

  const runs = await prisma.postgresBackupRun.findMany({
    where: { policyId: id },
    orderBy: { startedAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = runs.length > PAGE_SIZE;
  const items = hasMore ? runs.slice(0, PAGE_SIZE) : runs;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({
    items: items.map((run) => ({
      ...run,
      bytesWritten: run.bytesWritten?.toString() ?? null,
    })),
    nextCursor,
  });
});
