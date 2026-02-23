import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ScheduleList } from "@/components/schedule/schedule-list";

export default async function SchedulesPage() {
  const session = await requireAuth();

  const schedules = await prisma.schedule.findMany({
    where: { report: { userId: session.user.id } },
    include: {
      report: { select: { id: true, name: true } },
      recipients: { select: { email: true } },
    },
    orderBy: { nextRunAt: "asc" },
  });

  // Serialize dates for client component
  const serialized = schedules.map((s) => ({
    id: s.id,
    enabled: s.enabled,
    frequency: s.frequency,
    daysOfWeek: s.daysOfWeek,
    dayOfMonth: s.dayOfMonth,
    timeHour: s.timeHour,
    timeMinute: s.timeMinute,
    timezone: s.timezone,
    nextRunAt: s.nextRunAt?.toISOString() ?? null,
    report: s.report,
    recipients: s.recipients,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading-norse text-xl">Schedules</h1>
        <p className="text-text-dim text-xs tracking-wide mt-1">
          View and manage report delivery schedules.
        </p>
      </div>

      <ScheduleList schedules={serialized} />
    </div>
  );
}
