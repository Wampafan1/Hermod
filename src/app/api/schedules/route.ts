import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { createScheduleSchema } from "@/lib/validations/schedules";
import { calculateNextRun } from "@/lib/schedule-utils";

// GET /api/schedules — list all schedules with report names
export const GET = withAuth(async (_req, session) => {
  const schedules = await prisma.schedule.findMany({
    where: { report: { userId: session.user.id } },
    include: {
      report: { select: { id: true, name: true } },
      recipients: { select: { email: true, name: true } },
      emailConnection: { select: { id: true, name: true } },
    },
    orderBy: { nextRunAt: "asc" },
  });
  return NextResponse.json(schedules);
});

// POST /api/schedules — create schedule for a report
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Verify user owns the report
  const report = await prisma.report.findFirst({
    where: { id: data.reportId, userId: session.user.id },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Verify user owns the email connection
  const emailConn = await prisma.emailConnection.findFirst({
    where: { id: data.emailConnectionId, userId: session.user.id },
  });
  if (!emailConn) {
    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });
  }

  // Check if report already has a schedule
  const existing = await prisma.schedule.findUnique({
    where: { reportId: data.reportId },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Report already has a schedule. Update the existing one." },
      { status: 409 }
    );
  }

  const nextRunAt = data.enabled
    ? calculateNextRun({
        frequency: data.frequency,
        daysOfWeek: data.daysOfWeek,
        dayOfMonth: data.dayOfMonth ?? null,
        monthsOfYear: data.monthsOfYear,
        timeHour: data.timeHour,
        timeMinute: data.timeMinute,
        timezone: data.timezone,
      })
    : null;

  const schedule = await prisma.schedule.create({
    data: {
      reportId: data.reportId,
      enabled: data.enabled,
      frequency: data.frequency,
      daysOfWeek: data.daysOfWeek,
      dayOfMonth: data.dayOfMonth,
      monthsOfYear: data.monthsOfYear ?? [],
      timeHour: data.timeHour,
      timeMinute: data.timeMinute,
      timezone: data.timezone,
      emailSubject: data.emailSubject,
      emailBody: data.emailBody,
      emailConnectionId: data.emailConnectionId,
      nextRunAt,
      recipients: {
        create: data.recipients.map((r) => ({
          email: r.email,
          name: r.name,
        })),
      },
    },
    include: { recipients: true },
  });

  return NextResponse.json(schedule, { status: 201 });
});
