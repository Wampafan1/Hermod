import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ReportList } from "@/components/reports/report-list";
import { RealmBanner } from "@/components/realm-banner";

export default async function ReportsPage() {
  const session = await requireAuth();

  const reports = await prisma.report.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      connection: { select: { name: true, type: true } },
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
    connectionName: r.connection.name,
    connectionType: r.connection.type,
    lastRunStatus: r.runHistory[0]?.status ?? null,
    scheduled: !!r.schedule,
    scheduleEnabled: r.schedule?.enabled ?? false,
  }));

  return (
    <div className="space-y-6">
      <RealmBanner
        realm="asgard"
        rune="ᚠ"
        title="Reports"
        subtitle="Query the databases of Asgard"
        accentColor="#d4af37"
        action={
          <Link href="/reports/new" className="btn-primary">
            <span>New Report</span>
          </Link>
        }
      />

      <ReportList reports={mapped} />
    </div>
  );
}
