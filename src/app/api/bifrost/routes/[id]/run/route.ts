import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { BifrostEngine } from "@/lib/bifrost/engine";
import type { LoadedRoute } from "@/lib/bifrost/engine";
import type { SourceConfig, DestConfig } from "@/lib/bifrost/types";
import { prisma } from "@/lib/db";

// POST /api/bifrost/routes/[id]/run — Manual trigger
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/bifrost/routes/")[1]?.split("/")[0]?.split("?")[0];

  const route = await prisma.bifrostRoute.findFirst({
    where: { id, userId: session.user.id },
    include: {
      source: { select: { id: true, type: true, config: true, credentials: true } },
      dest: { select: { id: true, type: true, config: true, credentials: true } },
    },
  });
  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const loaded: LoadedRoute = {
    ...route,
    sourceConfig: route.sourceConfig as unknown as SourceConfig,
    destConfig: route.destConfig as unknown as DestConfig,
  };

  const engine = new BifrostEngine();
  const result = await engine.execute(loaded, "manual");

  return NextResponse.json(result);
});
