import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { updateRouteSchema } from "@/lib/validations/bifrost";
import { calculateNextRun } from "@/lib/schedule-utils";

// GET /api/bifrost/routes/[id]
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/bifrost/routes/")[1]?.split("/")[0]?.split("?")[0];

  const route = await prisma.bifrostRoute.findFirst({
    where: { id, userId: session.user.id },
    include: {
      source: { select: { id: true, name: true, type: true } },
      dest: { select: { id: true, name: true, type: true } },
      blueprint: { select: { id: true, name: true, status: true } },
    },
  });

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  return NextResponse.json(route);
});

// PUT /api/bifrost/routes/[id]
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/bifrost/routes/")[1]?.split("/")[0]?.split("?")[0];

  const existing = await prisma.bifrostRoute.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateRouteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Recalculate nextRunAt if schedule fields changed
  let nextRunAt: Date | null | undefined;
  const frequency = data.frequency !== undefined ? data.frequency : existing.frequency;
  if (frequency && (data.frequency !== undefined || data.timeHour !== undefined || data.timeMinute !== undefined)) {
    nextRunAt = calculateNextRun(
      {
        frequency: frequency as any,
        daysOfWeek: data.daysOfWeek ?? existing.daysOfWeek,
        dayOfMonth: data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
        timeHour: data.timeHour ?? existing.timeHour,
        timeMinute: data.timeMinute ?? existing.timeMinute,
        timezone: data.timezone ?? existing.timezone,
      },
      new Date()
    );
  }

  const route = await prisma.bifrostRoute.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.sourceId !== undefined && { sourceId: data.sourceId }),
      ...(data.ravenSatelliteId !== undefined && { ravenSatelliteId: data.ravenSatelliteId }),
      // Clear the other source when switching between direct and Raven
      ...(data.ravenSatelliteId && { sourceId: null }),
      ...(data.sourceId && { ravenSatelliteId: null }),
      ...(data.sourceConfig !== undefined && { sourceConfig: data.sourceConfig as Prisma.InputJsonValue }),
      ...(data.destId !== undefined && { destId: data.destId }),
      ...(data.destConfig !== undefined && { destConfig: data.destConfig as Prisma.InputJsonValue }),
      ...(data.transformEnabled !== undefined && { transformEnabled: data.transformEnabled }),
      ...(data.blueprintId !== undefined && { blueprintId: data.blueprintId }),
      ...(data.frequency !== undefined && { frequency: data.frequency }),
      ...(data.daysOfWeek !== undefined && { daysOfWeek: data.daysOfWeek }),
      ...(data.dayOfMonth !== undefined && { dayOfMonth: data.dayOfMonth }),
      ...(data.timeHour !== undefined && { timeHour: data.timeHour }),
      ...(data.timeMinute !== undefined && { timeMinute: data.timeMinute }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.cursorConfig !== undefined && { cursorConfig: data.cursorConfig as Prisma.InputJsonValue }),
      ...(data.needsFullReload !== undefined && { needsFullReload: data.needsFullReload }),
      ...(nextRunAt !== undefined && { nextRunAt }),
    },
  });

  return NextResponse.json(route);
});

// DELETE /api/bifrost/routes/[id]
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/bifrost/routes/")[1]?.split("/")[0]?.split("?")[0];

  const existing = await prisma.bifrostRoute.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  await prisma.bifrostRoute.delete({ where: { id } });

  return NextResponse.json({ success: true });
});
