import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { updateScheduleSchema } from "@/lib/validations/schedules";
import { calculateNextRun } from "@/lib/schedule-utils";

// PUT /api/schedules/[id] — update schedule
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/schedules/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing schedule ID" }, { status: 400 });
  }

  const existing = await prisma.schedule.findFirst({
    where: { id, report: { userId: session.user.id } },
    include: { report: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Merge with existing to compute nextRunAt
  const merged = {
    frequency: data.frequency ?? existing.frequency,
    daysOfWeek: data.daysOfWeek ?? existing.daysOfWeek,
    dayOfMonth: data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
    monthsOfYear: data.monthsOfYear ?? existing.monthsOfYear,
    timeHour: data.timeHour ?? existing.timeHour,
    timeMinute: data.timeMinute ?? existing.timeMinute,
    timezone: data.timezone ?? existing.timezone,
  };

  const enabled = data.enabled ?? existing.enabled;
  const nextRunAt = enabled ? calculateNextRun(merged) : null;

  // Validate emailConnectionId ownership if provided
  if (data.emailConnectionId) {
    const emailConn = await prisma.emailConnection.findFirst({
      where: { id: data.emailConnectionId, userId: session.user.id },
    });
    if (!emailConn) {
      return NextResponse.json({ error: "Email connection not found" }, { status: 404 });
    }
  }

  // Handle recipients update
  if (data.recipients) {
    await prisma.recipient.deleteMany({ where: { scheduleId: id } });
    await prisma.recipient.createMany({
      data: data.recipients.map((r) => ({
        email: r.email,
        name: r.name,
        scheduleId: id,
      })),
    });
  }

  const updated = await prisma.schedule.update({
    where: { id },
    data: {
      ...data,
      recipients: undefined, // handled above
      nextRunAt,
    },
    include: {
      recipients: true,
      emailConnection: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
});

// DELETE /api/schedules/[id]
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/schedules/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing schedule ID" }, { status: 400 });
  }

  const existing = await prisma.schedule.findFirst({
    where: { id, report: { userId: session.user.id } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  await prisma.schedule.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
