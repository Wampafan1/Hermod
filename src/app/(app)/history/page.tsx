import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { HistoryList } from "@/components/history/history-list";

export default async function HistoryPage() {
  const session = await requireAuth();

  const runs = await prisma.runLog.findMany({
    where: { report: { userId: session.user.id } },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: {
      report: { select: { id: true, name: true } },
    },
  });

  // Serialize dates for client component
  const serialized = runs.map((r) => ({
    id: r.id,
    status: r.status,
    rowCount: r.rowCount,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    report: r.report,
  }));

  return (
    <div className="space-y-6">
      <HistoryList runs={serialized} />
    </div>
  );
}
