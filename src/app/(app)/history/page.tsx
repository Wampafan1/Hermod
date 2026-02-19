"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/toast";

interface RunLog {
  id: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  report: { id: string; name: string };
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-green-500/10 text-green-400",
  FAILED: "bg-red-500/10 text-red-400",
  RUNNING: "bg-yellow-500/10 text-yellow-400",
};

export default function HistoryPage() {
  const toast = useToast();
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [errorModal, setErrorModal] = useState<string | null>(null);

  useEffect(() => {
    // Fetch runs from all reports
    fetch("/api/reports")
      .then((r) => r.json())
      .then(async (reports: Array<{ id: string }>) => {
        // Fetch run history via a custom endpoint or aggregate
        // For simplicity, we'll fetch from a dedicated history endpoint
        const res = await fetch("/api/history");
        if (res.ok) {
          setRuns(await res.json());
        }
      })
      .catch(() => toast.error("Failed to load history"))
      .finally(() => setLoading(false));
  }, [toast]);

  const filteredRuns =
    statusFilter === "all"
      ? runs
      : runs.filter((r) => r.status === statusFilter);

  function formatDuration(start: string, end: string | null): string {
    if (!end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  async function handleRerun(reportId: string) {
    try {
      const res = await fetch(`/api/reports/${reportId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Re-run failed");
        return;
      }
      toast.success("Report re-sent");
    } catch {
      toast.error("Network error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Run History</h1>
          <p className="text-gray-400 mt-1">
            Track all report execution history.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="RUNNING">Running</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4 animate-pulse h-14" />
          ))}
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">No run history yet.</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Report</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Rows</th>
                <th className="text-left px-4 py-3 font-medium">Started</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.id} className="border-b border-gray-800/50">
                  <td className="px-4 py-3 font-medium text-white">
                    {run.report.name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        STATUS_STYLES[run.status] ?? "bg-gray-700 text-gray-300"
                      } ${run.status === "FAILED" ? "cursor-pointer" : ""}`}
                      onClick={() =>
                        run.status === "FAILED" && run.error
                          ? setErrorModal(run.error)
                          : null
                      }
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {run.rowCount ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {relativeTime(run.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRerun(run.report.id)}
                      className="text-gray-400 hover:text-white text-xs transition-colors"
                    >
                      Re-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Error modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-red-400">Error Details</h3>
              <button
                onClick={() => setErrorModal(null)}
                className="text-gray-400 hover:text-white text-xl"
              >
                &times;
              </button>
            </div>
            <pre className="text-sm text-gray-300 bg-gray-800 p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
              {errorModal}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return new Date(dateStr).toLocaleDateString();
}
