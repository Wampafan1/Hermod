import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/blueprints/[routeId]/versions/[version] — Full version detail
export const GET = withAuth(async (req, session) => {
  const parts = req.url.split("/blueprints/")[1]?.split("/");
  const routeId = parts?.[0];
  const versionNum = parseInt(parts?.[2] ?? "", 10);

  if (!routeId || isNaN(versionNum)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const blueprint = await prisma.forgeBlueprint.findFirst({
    where: { routeId, route: { userId: session.user.id } },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const version = await prisma.forgeBlueprintVersion.findUnique({
    where: { blueprintId_version: { blueprintId: blueprint.id, version: versionNum } },
    include: {
      executions: {
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          inputRowCount: true,
          outputRowCount: true,
          startedAt: true,
          durationMs: true,
          errorMessage: true,
          errorStep: true,
        },
      },
    },
  });

  if (!version) {
    return NextResponse.json({ error: `Version ${versionNum} not found` }, { status: 404 });
  }

  return NextResponse.json({
    id: version.id,
    version: version.version,
    steps: version.steps,
    source: version.source,
    changeReason: version.changeReason,
    changeSummary: version.changeSummary,
    aiModelUsed: version.aiModelUsed,
    aiConfidence: version.aiConfidence,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    isLocked: version.isLocked,
    stepsHash: version.stepsHash,
    executions: version.executions.map((e) => ({
      ...e,
      startedAt: e.startedAt.toISOString(),
    })),
  });
});

// POST /api/blueprints/[routeId]/versions/[version]/lock — Lock a version
export const POST = withAuth(async (req, session) => {
  const parts = req.url.split("/blueprints/")[1]?.split("/");
  const routeId = parts?.[0];
  const versionNum = parseInt(parts?.[2] ?? "", 10);

  if (!routeId || isNaN(versionNum)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const blueprint = await prisma.forgeBlueprint.findFirst({
    where: { routeId, route: { userId: session.user.id } },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const version = await prisma.forgeBlueprintVersion.findUnique({
    where: { blueprintId_version: { blueprintId: blueprint.id, version: versionNum } },
  });

  if (!version) {
    return NextResponse.json({ error: `Version ${versionNum} not found` }, { status: 404 });
  }

  if (version.isLocked) {
    return NextResponse.json({ error: "Version is already locked" }, { status: 400 });
  }

  await prisma.forgeBlueprintVersion.update({
    where: { id: version.id },
    data: { isLocked: true, lockedAt: new Date(), lockedBy: session.user.id },
  });

  return NextResponse.json({ status: "locked" });
});
