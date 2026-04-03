import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { RealmBanner } from "@/components/realm-banner";

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
      <RealmBanner
        realm="asgard"
        rune="ᛏ"
        title="Schedules"
        subtitle="The Norns weave the threads of time"
        accentColor="#d4af37"
      />

      <ScheduleList schedules={serialized} />
    </div>
  );
}
