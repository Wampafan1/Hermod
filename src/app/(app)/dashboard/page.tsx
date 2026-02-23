import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await requireAuth();

  const [reportCount, connectionCount, recentRuns, upcomingSchedules] =
    await Promise.all([
      prisma.report.count({ where: { userId: session.user.id } }),
      prisma.dataSource.count({ where: { userId: session.user.id } }),
      prisma.runLog.findMany({
        where: { report: { userId: session.user.id } },
        orderBy: { startedAt: "desc" },
        take: 10,
        include: { report: { select: { name: true } } },
      }),
      prisma.schedule.findMany({
        where: {
          enabled: true,
          report: { userId: session.user.id },
          nextRunAt: {
            lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
            gte: new Date(),
          },
        },
        orderBy: { nextRunAt: "asc" },
        take: 5,
        include: { report: { select: { name: true } } },
      }),
    ]);

  return (
    <div className="space-y-8">
      <div className="animate-fade-up">
        <h1 className="heading-norse text-xl">Dashboard</h1>
        <p className="text-text-dim text-xs tracking-wide mt-1">
          Welcome back, {session.user.name?.split(" ")[0]}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-px animate-fade-up" style={{ animationDelay: "0.05s" }}>
        <Link href="/reports">
          <StatCard label="Reports" value={reportCount} rune="ᚱ" />
        </Link>
        <Link href="/connections">
          <StatCard label="Connections" value={connectionCount} rune="ᚷ" />
        </Link>
        <Link href="/history">
          <StatCard label="Runs (30d)" value={recentRuns.length} rune="ᚺ" />
        </Link>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <Link href="/reports/new" className="btn-primary">
          <span>New Report</span>
        </Link>
        <Link href="/connections" className="btn-ghost">
          Add Connection
        </Link>
      </div>

      {/* Upcoming Runs */}
      {upcomingSchedules.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: "0.15s" }}>
          <h2 className="heading-norse text-sm mb-3">Upcoming (24h)</h2>
          <div className="space-y-px">
            {upcomingSchedules.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-4 py-3 bg-deep border border-border text-sm"
              >
                <span className="text-text">{s.report.name}</span>
                <span className="text-text-dim text-xs">
                  {s.nextRunAt
                    ? relativeTimeServer(s.nextRunAt)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Runs */}
      <div className="animate-fade-up" style={{ animationDelay: "0.2s" }}>
        <h2 className="heading-norse text-sm mb-3">Recent Runs</h2>
        {recentRuns.length === 0 ? (
          <div className="text-center py-16 bg-deep border border-border">
            <span className="text-gold/20 text-3xl font-cinzel block mb-3">ᚱ</span>
            <p className="text-text-dim text-xs tracking-wide">
              No report runs yet. Create your first report to get started.
            </p>
          </div>
        ) : (
          <div className="bg-deep border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-norse text-left px-4 py-3">Report</th>
                  <th className="label-norse text-left px-4 py-3">Status</th>
                  <th className="label-norse text-left px-4 py-3">Rows</th>
                  <th className="label-norse text-left px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-border hover:bg-gold/[0.02]">
                    <td className="px-4 py-3 text-text">{run.report.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-text-dim">
                      {run.rowCount ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-dim">
                      {relativeTimeServer(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, rune }: { label: string; value: number; rune: string }) {
  return (
    <div className="stat-card-norse">
      <div className="flex items-start justify-between">
        <div>
          <p className="label-norse">{label}</p>
          <p className="text-3xl font-cinzel text-gold-bright mt-1">{value}</p>
        </div>
        <span className="text-gold/10 text-2xl font-cinzel">{rune}</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    SUCCESS: "badge-success",
    FAILED: "badge-error",
    RUNNING: "badge-running",
  };
  return (
    <span className={classMap[status] ?? "badge-neutral"}>
      {status}
    </span>
  );
}

function relativeTimeServer(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = Math.abs(now - then);
  const isFuture = then > now;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return isFuture ? "in a moment" : "just now";
  if (diffMin < 60)
    return isFuture ? `in ${diffMin} min` : `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)
    return isFuture
      ? `in ${diffHr} hr${diffHr > 1 ? "s" : ""}`
      : `${diffHr} hr${diffHr > 1 ? "s" : ""} ago`;
  return new Date(date).toLocaleDateString();
}
