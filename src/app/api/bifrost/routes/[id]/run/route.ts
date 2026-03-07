import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { BifrostEngine } from "@/lib/bifrost/engine";
import type { LoadedRoute } from "@/lib/bifrost/engine";
import type { SourceConfig, DestConfig } from "@/lib/bifrost/types";
import { prisma } from "@/lib/db";

const ROUTE_TIMEOUT_MS = 10 * 60_000; // 10 minutes max for manual trigger

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

  // Atomically check for concurrent runs and create a lock log in one transaction
  // to eliminate the TOCTOU race between findFirst and routeLog.create
  const lockResult = await prisma.$transaction(async (tx) => {
    const activeRun = await tx.routeLog.findFirst({
      where: { routeId: id, status: "running" },
      select: { id: true },
    });
    if (activeRun) return null;

    return tx.routeLog.create({
      data: { routeId: id!, status: "running", triggeredBy: "manual" },
      select: { id: true },
    });
  }, { isolationLevel: "Serializable" });

  if (!lockResult) {
    return NextResponse.json(
      { error: "Route is already running" },
      { status: 409 }
    );
  }

  const loaded: LoadedRoute = {
    ...route,
    sourceConfig: route.sourceConfig as unknown as SourceConfig,
    destConfig: route.destConfig as unknown as DestConfig,
    cursorConfig: route.cursorConfig as LoadedRoute["cursorConfig"],
  };

  const engine = new BifrostEngine();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Route execution timed out after 10 minutes")),
      ROUTE_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([engine.execute(loaded, "manual", lockResult.id), timeout]);
    clearTimeout(timer!);
    return NextResponse.json(result);
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
});
