import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/blueprints/[routeId] — Blueprint with version history
export const GET = withAuth(async (req, session) => {
  const routeId = req.url.split("/blueprints/")[1]?.split("/")[0]?.split("?")[0];

  const blueprint = await prisma.forgeBlueprint.findFirst({
    where: { routeId, route: { userId: session.user.id } },
    include: {
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          source: true,
          changeReason: true,
          changeSummary: true,
          aiConfidence: true,
          createdAt: true,
          createdBy: true,
          isLocked: true,
          steps: true,
          _count: { select: { executions: true } },
        },
      },
    },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "No blueprint found for this route" }, { status: 404 });
  }

  // Get last execution date per version
  const lastExecs = await prisma.forgeBlueprintExecution.groupBy({
    by: ["versionId"],
    where: { blueprintId: blueprint.id },
    _max: { startedAt: true },
  });
  const lastExecMap = new Map(
    lastExecs.map((e) => [e.versionId, e._max.startedAt])
  );

  return NextResponse.json({
    id: blueprint.id,
    routeId: blueprint.routeId,
    name: blueprint.name,
    description: blueprint.description,
    currentVersion: blueprint.currentVersion,
    status: blueprint.status,
    versions: blueprint.versions.map((v) => ({
      id: v.id,
      version: v.version,
      source: v.source,
      changeReason: v.changeReason,
      changeSummary: v.changeSummary,
      aiConfidence: v.aiConfidence,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
      stepsCount: Array.isArray(v.steps) ? (v.steps as unknown[]).length : 0,
      executionCount: v._count.executions,
      lastExecutedAt: lastExecMap.get(v.id)?.toISOString() ?? null,
      isLocked: v.isLocked,
    })),
  });
});
