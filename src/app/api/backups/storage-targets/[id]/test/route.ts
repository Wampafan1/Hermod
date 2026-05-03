import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { testSavedStorageTarget } from "@/lib/backups/storage/test-storage-target";

function extractId(url: string): string | null {
  return url.split("/backups/storage-targets/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const POST = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing storage target ID" }, { status: 400 });

  const target = await prisma.backupStorageTarget.findFirst({
    where: {
      id,
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: { id: true, provider: true, accessMode: true, config: true, credentials: true },
  });
  if (!target) return NextResponse.json({ error: "Storage target not found" }, { status: 404 });

  const result = await testSavedStorageTarget(target);
  await prisma.backupStorageTarget.update({
    where: { id: target.id },
    data: {
      lastTestedAt: new Date(),
      lastTestResult: result as unknown as Prisma.InputJsonValue,
      status: result.ok ? "ACTIVE" : "ERROR",
    },
  });

  return NextResponse.json(result);
}, { minimumRole: "ADMIN" });
