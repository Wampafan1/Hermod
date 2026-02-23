import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ReportList } from "@/components/reports/report-list";

export default async function ReportsPage() {
  const session = await requireAuth();

  const reports = await prisma.report.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      dataSource: { select: { name: true, type: true } },
      schedule: { select: { enabled: true } },
      runHistory: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });

  const mapped = reports.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    connectionName: r.dataSource.name,
    connectionType: r.dataSource.type,
    lastRunStatus: r.runHistory[0]?.status ?? null,
    scheduled: !!r.schedule,
    scheduleEnabled: r.schedule?.enabled ?? false,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Reports</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Create and manage your SQL reports.
          </p>
        </div>
        <Link href="/reports/new" className="btn-primary">
          <span>New Report</span>
        </Link>
      </div>

      <ReportList reports={mapped} />
    </div>
  );
}
