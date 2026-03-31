"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface RunLog {
  id: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  report: { id: string; name: string; scheduleId: string | null };
}

interface ReportOption {
  id: string;
  name: string;
}

interface HistoryListProps {
  initialRuns: RunLog[];
  initialCursor: string | null;
  reports: ReportOption[];
}

const STATUS_BADGES: Record<string, string> = {
  SUCCESS: "badge-success",
  FAILED: "badge-error",
  RUNNING: "badge-running",
};

export function HistoryList({ initialRuns, initialCursor, reports }: HistoryListProps) {
  const toast = useToast();
  const [runs, setRuns] = useState<RunLog[]>(initialRuns);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [statusFilter, setStatusFilter] = useState("all");
  const [reportFilter, setReportFilter] = useState("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [rerunTarget, setRerunTarget] = useState<RunLog | null>(null);
  const [rerunning, setRerunning] = useState(false);

  const fetchRuns = useCallback(async (status: string, reportId: string, pageCursor?: string) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (reportId !== "all") params.set("reportId", reportId);
    if (pageCursor) params.set("cursor", pageCursor);

    const res = await fetch(`/api/history?${params}`);
    if (!res.ok) throw new Error("Failed to load history");
    return res.json() as Promise<{ items: RunLog[]; nextCursor: string | null }>;
  }, []);

  async function handleFilterChange(newStatus: string, newReport: string) {
    setStatusFilter(newStatus);
    setReportFilter(newReport);
    try {
      const data = await fetchRuns(newStatus, newReport);
      setRuns(data.items);
      setCursor(data.nextCursor);
    } catch {
      toast.error("Failed to load history");
    }
  }

  async function handleLoadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchRuns(statusFilter, reportFilter, cursor);
      setRuns((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      toast.error("Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleRerun() {
    if (!rerunTarget?.report.scheduleId) return;
    setRerunning(true);
    try {
      const res = await fetch(`/api/schedules/${rerunTarget.report.scheduleId}/send-now`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Re-run failed");
        return;
      }
      toast.success(`Sent to ${data.recipientCount} recipient${data.recipientCount !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Network error");
    } finally {
      setRerunning(false);
      setRerunTarget(null);
    }
  }

  function onRerunClick(run: RunLog) {
    if (!run.report.scheduleId) {
      toast.error("No schedule configured — use Test Send from the report editor");
      return;
    }
    setRerunTarget(run);
  }

  function formatDuration(start: string, end: string | null): string {
    if (!end) return "\u2014";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
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
        <div className="flex gap-2">
          <select
            value={reportFilter}
            onChange={(e) => handleFilterChange(statusFilter, e.target.value)}
            className="select-norse w-auto"
          >
            <option value="all">All reports</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value, reportFilter)}
            className="select-norse w-auto"
          >
            <option value="all">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="RUNNING">Running</option>
          </select>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 bg-deep border border-border">
          <span className="text-gold/20 text-3xl font-cinzel block mb-3">&#5765;</span>
          <p className="text-text-dim text-xs tracking-wide">No run history found.</p>
        </div>
      ) : (
        <div className="bg-deep border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="label-norse text-left px-4 py-3">Report</th>
                <th scope="col" className="label-norse text-left px-4 py-3">Status</th>
                <th scope="col" className="label-norse text-left px-4 py-3">Rows</th>
                <th scope="col" className="label-norse text-left px-4 py-3">Started</th>
                <th scope="col" className="label-norse text-left px-4 py-3">Duration</th>
                <th scope="col" className="text-right px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border hover:bg-gold/[0.02]">
                  <td className="px-4 py-3 text-text">{run.report.name}</td>
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
                  <td className="px-4 py-3 text-text-dim">{run.rowCount ?? "\u2014"}</td>
                  <td className="px-4 py-3 text-text-dim text-xs">{relativeTime(run.startedAt)}</td>
                  <td className="px-4 py-3 text-text-dim text-xs">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onRerunClick(run)} className="btn-subtle">
                      Re-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="btn-ghost text-xs"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {/* Error detail modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setErrorModal(null)}>
          <div className="bg-deep border border-border-mid max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="heading-norse text-sm">Error Details</h3>
              <button onClick={() => setErrorModal(null)} className="text-text-dim hover:text-text text-xl">
                &times;
              </button>
            </div>
            <div className="p-5">
              <pre className="text-xs text-text bg-void p-4 border border-border overflow-auto max-h-64 whitespace-pre-wrap">
                {errorModal}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-border bg-surface flex justify-end">
              <button onClick={() => setErrorModal(null)} className="btn-ghost text-xs">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Re-run confirmation */}
      <ConfirmDialog
        open={!!rerunTarget}
        title="Re-run Report"
        message={rerunTarget ? `Re-run ${rerunTarget.report.name} and send to all scheduled recipients?` : ""}
        confirmLabel="Re-run"
        confirmVariant="primary"
        loading={rerunning}
        onConfirm={handleRerun}
        onCancel={() => { if (!rerunning) setRerunTarget(null); }}
      />
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
