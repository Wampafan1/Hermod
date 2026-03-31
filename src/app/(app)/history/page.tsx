import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { HistoryList } from "@/components/history/history-list";

const PAGE_SIZE = 50;

export default async function HistoryPage() {
  const session = await requireAuth();

  const [runsRaw, reports] = await Promise.all([
    prisma.runLog.findMany({
      where: { report: { userId: session.user.id } },
      orderBy: { startedAt: "desc" },
      take: PAGE_SIZE + 1,
      include: {
        report: {
          select: {
            id: true,
            name: true,
            schedule: { select: { id: true } },
          },
        },
      },
    }),
    prisma.report.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasMore = runsRaw.length > PAGE_SIZE;
  const items = hasMore ? runsRaw.slice(0, PAGE_SIZE) : runsRaw;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  const serialized = items.map((r) => ({
    id: r.id,
    status: r.status,
    rowCount: r.rowCount,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    report: {
      id: r.report.id,
      name: r.report.name,
      scheduleId: r.report.schedule?.id ?? null,
    },
  }));

  return (
    <div className="space-y-6">
      <HistoryList
        initialRuns={serialized}
        initialCursor={nextCursor}
        reports={reports}
      />
    </div>
  );
}
