import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rollbackToVersion } from "@/lib/mjolnir/blueprint-versioning";

// POST /api/blueprints/[routeId]/rollback
export const POST = withAuth(async (req, session) => {
  const routeId = req.url.split("/blueprints/")[1]?.split("/")[0];
  const body = await req.json();
  const { targetVersion, reason } = body;

  if (!routeId || typeof targetVersion !== "number") {
    return NextResponse.json({ error: "routeId and targetVersion are required" }, { status: 400 });
  }

  const blueprint = await prisma.forgeBlueprint.findFirst({
    where: { routeId, route: { userId: session.user.id } },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const newVersion = await rollbackToVersion(
    blueprint.id,
    targetVersion,
    session.user.id,
    reason
  );

  return NextResponse.json({
    version: newVersion.version,
    id: newVersion.id,
    changeReason: newVersion.changeReason,
  });
});
