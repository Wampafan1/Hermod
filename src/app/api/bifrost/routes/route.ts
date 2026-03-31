import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createRouteSchema } from "@/lib/validations/bifrost";
import { calculateNextRun } from "@/lib/schedule-utils";
import { validateBlueprintForStreaming } from "@/lib/bifrost/forge/forge-validator";

// GET /api/bifrost/routes — List all routes for current user
export const GET = withAuth(async (req, session) => {
  const routes = await prisma.bifrostRoute.findMany({
    where: { userId: session.user.id },
    include: {
      source: { select: { id: true, name: true, type: true } },
      dest: { select: { id: true, name: true, type: true } },
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

  // Validate source Connection belongs to user
  const source = await prisma.connection.findFirst({
    where: { id: data.sourceId, userId: session.user.id },
  });
  if (!source) {
    return NextResponse.json({ error: "Source connection not found" }, { status: 404 });
  }

  const dest = await prisma.connection.findFirst({
    where: { id: data.destId, userId: session.user.id },
  });
  if (!dest) {
    return NextResponse.json({ error: "Destination connection not found" }, { status: 404 });
  }

  // Validate blueprint streaming compatibility if transform enabled
  if (data.transformEnabled && data.blueprintId) {
    const blueprint = await prisma.blueprint.findFirst({
      where: { id: data.blueprintId, userId: session.user.id },
      select: { steps: true },
    });
    if (!blueprint) {
      return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
    }
    const steps = blueprint.steps as Array<{ type: string }>;
    const validation = validateBlueprintForStreaming(steps);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Blueprint contains stateful steps not supported in streaming mode",
          statefulSteps: validation.statefulSteps,
          suggestion: validation.suggestion,
        },
        { status: 400 }
      );
    }
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
      sourceId: data.sourceId,
      sourceConfig: data.sourceConfig as Prisma.InputJsonValue,
      destId: data.destId,
      destConfig: data.destConfig as Prisma.InputJsonValue,
      transformEnabled: data.transformEnabled,
      blueprintId: data.blueprintId ?? null,
      frequency: data.frequency ?? null,
      daysOfWeek: data.daysOfWeek,
      dayOfMonth: data.dayOfMonth ?? null,
      timeHour: data.timeHour,
      timeMinute: data.timeMinute,
      timezone: data.timezone,
      nextRunAt,
      cursorConfig: (data.cursorConfig ?? null) as Prisma.InputJsonValue,
      userId: session.user.id,
    },
  });

  return NextResponse.json(route, { status: 201 });
});
