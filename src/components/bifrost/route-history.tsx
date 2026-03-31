"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/toast";
import { formatDurationMs } from "@/lib/format-utils";

interface RouteLogEntry {
  id: string;
  status: string;
  rowsExtracted: number | null;
  rowsLoaded: number | null;
  errorCount: number;
  duration: number | null;
  triggeredBy: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface HelheimEntryItem {
  id: string;
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  errorType: string;
  errorMessage: string;
  errorDetails: Record<string, unknown> | null;
  retryCount: number;
  maxRetries: number;
  status: string;
  createdAt: string;
  lastRetriedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "text-emerald-400",
  partial: "text-amber-400",
  failed: "text-red-400",
  running: "text-gold animate-pulse",
};

const HELHEIM_STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-400",
  retrying: "text-gold animate-pulse",
  recovered: "text-emerald-400",
  dead: "text-red-400",
};

export function RouteHistory({ routeId }: { routeId: string }) {
  const [logs, setLogs] = useState<RouteLogEntry[]>([]);
  const [helheim, setHelheim] = useState<HelheimEntryItem[]>([]);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();

  const fetchData = useCallback(async () => {
    try {
      const [logsRes, helheimRes] = await Promise.all([
        fetch(`/api/bifrost/routes/${routeId}/logs`),
        fetch(`/api/bifrost/helheim?routeId=${routeId}`),
      ]);
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.items);
        setLogCursor(data.nextCursor);
      }
      if (helheimRes.ok) setHelheim(await helheimRes.json());
    } catch {
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [routeId, toast]);

  async function handleLoadMore() {
    if (!logCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/bifrost/routes/${routeId}/logs?cursor=${logCursor}`);
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => [...prev, ...data.items]);
        setLogCursor(data.nextCursor);
      }
    } catch {
      toast.error("Failed to load more logs");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function retryEntry(entryId: string) {
    toast.success("Retrying...");
    try {
      const res = await fetch(`/api/bifrost/helheim/${entryId}/retry`, { method: "POST" });
      const result = await res.json();
      if (result.status === "recovered") {
        toast.success(`Recovered: ${result.rowsLoaded} rows loaded`);
      } else {
        toast.error(result.error || "Retry failed");
      }
      fetchData();
    } catch {
      toast.error("Retry failed");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading history...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Run Logs */}
      <h2 className="heading-norse text-sm mb-4">
        Run History
      </h2>

      {logs.length === 0 ? (
        <div className="border border-border bg-deep p-8 text-center mb-8">
          <p className="text-text-dim text-sm tracking-wider">No runs yet.</p>
        </div>
      ) : (
        <div className="border border-border bg-deep overflow-hidden mb-8">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                <th className="px-4 py-3 text-left font-normal">Status</th>
                <th className="px-4 py-3 text-left font-normal">Started</th>
                <th className="px-4 py-3 text-left font-normal">Duration</th>
                <th className="px-4 py-3 text-left font-normal">Extracted</th>
                <th className="px-4 py-3 text-left font-normal">Loaded</th>
                <th className="px-4 py-3 text-left font-normal">Errors</th>
                <th className="px-4 py-3 text-left font-normal">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const logHelheim = helheim.filter((h) => h.jobId === log.id);
                const hasErrors = logHelheim.length > 0;
                const isExpanded = expandedLog === log.id;

                return (
                  <React.Fragment key={log.id}>
                    <tr
                      className={`border-b border-border/50 transition-colors ${
                        hasErrors ? "cursor-pointer hover:bg-gold/[0.03]" : ""
                      }`}
                      onClick={() => hasErrors && setExpandedLog(isExpanded ? null : log.id)}
                    >
                      <td className="px-4 py-3">
                        <span className={STATUS_COLORS[log.status] ?? "text-gray-400"}>
                          {hasErrors && (isExpanded ? "▼ " : "▶ ")}
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">
                        {new Date(log.startedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">
                        {formatDurationMs(log.duration)}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">
                        {log.rowsExtracted?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">
                        {log.rowsLoaded?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {log.errorCount > 0 ? (
                          <span className="text-ember">{log.errorCount.toLocaleString()}</span>
                        ) : (
                          <span className="text-text-dim">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">
                        {log.triggeredBy}
                      </td>
                    </tr>
                    {isExpanded &&
                      logHelheim.map((entry) => (
                        <tr
                          key={entry.id}
                          className="bg-void/50 border-b border-border/30"
                        >
                          <td colSpan={2} className="px-8 py-2">
                            <span className={`text-[0.65rem] ${HELHEIM_STATUS_COLORS[entry.status]}`}>
                              Chunk {entry.chunkIndex} — {entry.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-text-dim text-[0.65rem]">
                            {entry.rowCount} rows
                          </td>
                          <td colSpan={2} className="px-4 py-2 text-text-dim text-[0.65rem]">
                            <span className="text-ember/80">{entry.errorType}</span>:{" "}
                            {entry.errorMessage.slice(0, 80)}
                            {entry.errorMessage.length > 80 && "..."}
                          </td>
                          <td className="px-4 py-2 text-text-dim text-[0.65rem]">
                            {entry.retryCount}/{entry.maxRetries}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {(entry.status === "pending" || entry.status === "dead") && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryEntry(entry.id);
                                }}
                                className="btn-subtle text-[0.6rem] px-2 py-0.5"
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {logCursor && (
        <div className="flex justify-center py-4">
          <button onClick={handleLoadMore} disabled={loadingMore} className="btn-ghost text-xs">
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {/* Helheim Summary */}
      {helheim.length > 0 && (
        <>
          <h2 className="heading-norse text-ember text-sm mb-4">
            Helheim — Dead Letters
          </h2>
          <div className="grid grid-cols-4 gap-px bg-border mb-8">
            <Stat
              label="Total Entries"
              value={helheim.length.toString()}
            />
            <Stat
              label="Pending"
              value={helheim.filter((h) => h.status === "pending").length.toString()}
              color="text-amber-400"
            />
            <Stat
              label="Recovered"
              value={helheim.filter((h) => h.status === "recovered").length.toString()}
              color="text-emerald-400"
            />
            <Stat
              label="Dead"
              value={helheim.filter((h) => h.status === "dead").length.toString()}
              color="text-red-400"
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat-card-norse text-center">
      <div className={`text-lg font-cinzel ${color ?? "text-gold-bright"}`}>{value}</div>
      <div className="label-norse mt-1">{label}</div>
    </div>
  );
}
