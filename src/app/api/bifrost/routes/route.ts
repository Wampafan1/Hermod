import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createRouteSchema } from "@/lib/validations/bifrost";
import { calculateNextRun } from "@/lib/schedule-utils";
import { validateBifrostBlueprintAttachment } from "@/lib/mjolnir/bifrost-blueprint-attach";

// GET /api/bifrost/routes — List all routes for current user
export const GET = withAuth(async (req, session) => {
  const routes = await prisma.bifrostRoute.findMany({
    where: { userId: session.user.id, tenantId: session.tenantId },
    include: {
      source: { select: { id: true, name: true, type: true } },
      dest: { select: { id: true, name: true, type: true } },
      ravenSatellite: { select: { id: true, name: true, status: true, lastHeartbeatAt: true, connections: true } },
      routeLogs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { status: true, startedAt: true, rowsLoaded: true, errorCount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(routes);
});

// POST /api/bifrost/routes — Create a new route
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createRouteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Validate source — either direct connection or Raven satellite
  if (data.ravenSatelliteId) {
    // Raven source — verify satellite belongs to current tenant
    const satellite = await prisma.ravenSatellite.findFirst({
      where: { id: data.ravenSatelliteId, tenantId: session.tenantId },
    });
    if (!satellite) {
      return NextResponse.json({ error: "Data Agent connection not found" }, { status: 404 });
    }
  } else if (data.sourceId) {
    // Direct connection source
    const source = await prisma.connection.findFirst({
      where: { id: data.sourceId, userId: session.user.id, tenantId: session.tenantId },
    });
    if (!source) {
      return NextResponse.json({ error: "Source connection not found" }, { status: 404 });
    }
  }

  const dest = await prisma.connection.findFirst({
    where: { id: data.destId, userId: session.user.id, tenantId: session.tenantId },
  });
  if (!dest) {
    return NextResponse.json({ error: "Destination connection not found" }, { status: 404 });
  }

  const blueprintValidation = await validateBifrostBlueprintAttachment({
    blueprintVersionId: data.blueprintVersionId,
    legacyBlueprintId: data.blueprintId,
    userId: session.user.id,
    tenantId: session.tenantId,
    transformEnabled: data.transformEnabled,
  });
  if (!blueprintValidation.ok) {
    return NextResponse.json(
      {
        error: blueprintValidation.error,
        statefulSteps: blueprintValidation.statefulSteps,
        suggestion: blueprintValidation.suggestion,
      },
      { status: blueprintValidation.status }
    );
  }

  // Calculate initial nextRunAt
  let nextRunAt: Date | null = null;
  if (data.frequency) {
    nextRunAt = calculateNextRun(
      {
        frequency: data.frequency as any,
        daysOfWeek: data.daysOfWeek,
        dayOfMonth: data.dayOfMonth ?? null,
        timeHour: data.timeHour,
        timeMinute: data.timeMinute,
        timezone: data.timezone,
      },
      new Date()
    );
  }

  const route = await prisma.bifrostRoute.create({
    data: {
      name: data.name,
      sourceId: data.ravenSatelliteId ? null : (data.sourceId ?? null),
      ravenSatelliteId: data.ravenSatelliteId ?? null,
      sourceConfig: data.sourceConfig as Prisma.InputJsonValue,
      destId: data.destId,
      destConfig: data.destConfig as Prisma.InputJsonValue,
      transformEnabled: data.transformEnabled,
      blueprintVersionId: blueprintValidation.data.blueprintVersionId,
      blueprintId: blueprintValidation.data.blueprintId,
      frequency: data.frequency ?? null,
      daysOfWeek: data.daysOfWeek,
      dayOfMonth: data.dayOfMonth ?? null,
      timeHour: data.timeHour,
      timeMinute: data.timeMinute,
      timezone: data.timezone,
      nextRunAt,
      cursorConfig: (data.cursorConfig ?? null) as Prisma.InputJsonValue,
      userId: session.user.id,
      tenantId: session.tenantId,
    },
  });

  return NextResponse.json(route, { status: 201 });
});
