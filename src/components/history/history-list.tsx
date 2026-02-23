"use client";

import { useState } from "react";
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

const STATUS_BADGES: Record<string, string> = {
  SUCCESS: "badge-success",
  FAILED: "badge-error",
  RUNNING: "badge-running",
};

export function HistoryList({ runs }: { runs: RunLog[] }) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const filteredRuns =
    statusFilter === "all"
      ? runs
      : runs.filter((r) => r.status === statusFilter);

  function formatDuration(start: string, end: string | null): string {
    if (!end) return "\u2014";
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
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Run History</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Track all report execution history.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select-norse w-auto"
        >
          <option value="all">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="RUNNING">Running</option>
        </select>
      </div>

      {filteredRuns.length === 0 ? (
        <div className="text-center py-16 bg-deep border border-border">
          <span className="text-gold/20 text-3xl font-cinzel block mb-3">ᚺ</span>
          <p className="text-text-dim text-xs tracking-wide">No run history yet.</p>
        </div>
      ) : (
        <div className="bg-deep border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="label-norse text-left px-4 py-3">Report</th>
                <th className="label-norse text-left px-4 py-3">Status</th>
                <th className="label-norse text-left px-4 py-3">Rows</th>
                <th className="label-norse text-left px-4 py-3">Started</th>
                <th className="label-norse text-left px-4 py-3">Duration</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.id} className="border-b border-border hover:bg-gold/[0.02]">
                  <td className="px-4 py-3 text-text">
                    {run.report.name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`${STATUS_BADGES[run.status] ?? "badge-neutral"} ${run.status === "FAILED" ? "cursor-pointer" : ""}`}
                      onClick={() =>
                        run.status === "FAILED" && run.error
                          ? setErrorModal(run.error)
                          : null
                      }
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-dim">
                    {run.rowCount ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-text-dim text-xs">
                    {relativeTime(run.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-text-dim text-xs">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRerun(run.report.id)}
                      className="btn-subtle"
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
          <div className="bg-deep border border-border-mid max-w-lg w-full mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="heading-norse text-sm">Error Details</h3>
              <button
                onClick={() => setErrorModal(null)}
                className="text-text-dim hover:text-text text-xl"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              <pre className="text-xs text-text bg-void p-4 border border-border overflow-auto max-h-64 whitespace-pre-wrap">
                {errorModal}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-border bg-surface flex justify-end">
              <button
                onClick={() => setErrorModal(null)}
                className="btn-ghost text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
