import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializeRestoreJob } from "@/lib/backups/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/restores/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

const restoreInclude = {
  policy: {
    select: {
      id: true,
      name: true,
      sourceConnection: { select: { id: true, name: true, config: true } },
      storageTarget: { select: { id: true, name: true, provider: true, config: true } },
    },
  },
  backupRun: {
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      completedAt: true,
      checksumSha256: true,
      bytesWritten: true,
      objectKeys: true,
    },
  },
  targetConnection: {
    select: { id: true, name: true, type: true, config: true },
  },
  triggeredByUser: {
    select: { id: true, name: true, email: true },
  },
};

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing restore job ID" }, { status: 400 });

  const job = await prisma.postgresRestoreJob.findFirst({
    where: { id, tenantId: session.tenantId },
    include: restoreInclude,
  });
  if (!job) return NextResponse.json({ error: "Restore job not found" }, { status: 404 });

  return NextResponse.json(serializeRestoreJob(job));
});
