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
            lte: new Date(Date.now() + 24 * 60 * 60 * 1000), // next 24 hours
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
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-400 mt-1">
          Welcome back, {session.user.name?.split(" ")[0]}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Link href="/reports">
          <StatCard label="Reports" value={reportCount} />
        </Link>
        <Link href="/connections">
          <StatCard label="Connections" value={connectionCount} />
        </Link>
        <Link href="/history">
          <StatCard label="Runs (last 30d)" value={recentRuns.length} />
        </Link>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link
          href="/reports/new"
          className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          New Report
        </Link>
        <Link
          href="/connections"
          className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
        >
          Add Connection
        </Link>
      </div>

      {/* Upcoming Runs */}
      {upcomingSchedules.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Upcoming (24h)</h2>
          <div className="space-y-2">
            {upcomingSchedules.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-sm"
              >
                <span className="text-white">{s.report.name}</span>
                <span className="text-gray-400">
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
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Runs</h2>
        {recentRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No report runs yet. Create your first report to get started.
          </p>
        ) : (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">Report</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Rows</th>
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-gray-800/50">
                    <td className="px-4 py-3">{run.report.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {run.rowCount ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    SUCCESS: "bg-green-500/10 text-green-400",
    FAILED: "bg-red-500/10 text-red-400",
    RUNNING: "bg-yellow-500/10 text-yellow-400",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
        styles[status] ?? "bg-gray-700 text-gray-300"
      }`}
    >
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
