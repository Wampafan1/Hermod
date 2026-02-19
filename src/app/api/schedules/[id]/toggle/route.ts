import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { calculateNextRun } from "@/lib/schedule-utils";

// POST /api/schedules/[id]/toggle — enable/disable schedule
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/schedules/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing schedule ID" }, { status: 400 });
  }

  const existing = await prisma.schedule.findFirst({
    where: { id, report: { userId: session.user.id } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const newEnabled = !existing.enabled;
  const nextRunAt = newEnabled
    ? calculateNextRun({
        frequency: existing.frequency,
        daysOfWeek: existing.daysOfWeek,
        dayOfMonth: existing.dayOfMonth,
        monthsOfYear: existing.monthsOfYear,
        timeHour: existing.timeHour,
        timeMinute: existing.timeMinute,
        timezone: existing.timezone,
      })
    : null;

  const updated = await prisma.schedule.update({
    where: { id },
    data: { enabled: newEnabled, nextRunAt },
  });

  return NextResponse.json(updated);
});
