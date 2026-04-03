"use client";

import { useState, useEffect, useMemo } from "react";

const STATUS_FILTERS = ["all", "pending", "dead", "recovered"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const ERROR_TYPES = [
  { value: null, label: "All Types" },
  { value: "load_failure", label: "Load" },
  { value: "transform_failure", label: "Transform" },
  { value: "auth_failure", label: "Auth" },
  { value: "timeout", label: "Timeout" },
] as const;

const STATUS_DOT: Record<string, string> = {
  pending: "bg-warning animate-pip-pulse",
  retrying: "bg-warning animate-pip-pulse",
  recovered: "bg-success",
  dead: "bg-error",
};

const ERROR_BADGE: Record<string, { text: string; border: string; label: string }> = {
  load_failure:      { text: "text-error", border: "border-error/30", label: "LOAD" },
  transform_failure: { text: "text-warning", border: "border-warning/30", label: "TRANSFORM" },
  auth_failure:      { text: "text-realm-alfheim", border: "border-realm-alfheim/30", label: "AUTH" },
  timeout:           { text: "text-frost", border: "border-frost/30", label: "TIMEOUT" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function relativeCountdown(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

export interface HelheimListEntry {
  id: string;
  routeId: string;
  routeName: string;
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  errorType: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  status: string;
  createdAt: string;
  lastRetriedAt: string | null;
  nextRetryAt: string | null;
}

interface Props {
  entries: HelheimListEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  refreshKey: number;
}

export function EntryList({ entries, selectedId, onSelect, onRefresh, refreshKey }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [errorTypeFilter, setErrorTypeFilter] = useState<string | null>(null);
  const [routeFilter, setRouteFilter] = useState<string | null>(null);
  const [fetchedEntries, setFetchedEntries] = useState(entries);

  // Re-fetch when filters change or after actions
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (routeFilter) params.set("routeId", routeFilter);

    fetch(`/api/bifrost/helheim?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFetchedEntries(data));
  }, [statusFilter, routeFilter, refreshKey]);

  // Extract unique routes for filter dropdown
  const routes = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e) => map.set(e.routeId, e.routeName));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [entries]);

  // Apply client-side error type filter
  const filtered = errorTypeFilter
    ? fetchedEntries.filter((e) => e.errorType === errorTypeFilter)
    : fetchedEntries;

  return (
    <div className="bg-deep border border-border flex flex-col" style={{ minHeight: 400 }}>
      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        {/* Status tabs */}
        <div className="flex gap-4">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-[10px] font-space-grotesk uppercase tracking-widest transition-colors pb-0.5 ${
                statusFilter === s
                  ? "text-gold border-b-2 border-gold"
                  : "text-text-muted hover:text-text-dim"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Error type + route filters */}
        <div className="flex gap-2 flex-wrap">
          {ERROR_TYPES.map((et) => (
            <button
              key={et.label}
              onClick={() => setErrorTypeFilter(et.value)}
              className={`text-[9px] font-space-grotesk uppercase tracking-wider px-2 py-0.5 border transition-colors ${
                errorTypeFilter === et.value
                  ? "border-gold text-gold"
                  : "border-border text-text-muted hover:text-text-dim hover:border-border-mid"
              }`}
            >
              {et.label}
            </button>
          ))}

          {routes.length > 1 && (
            <select
              value={routeFilter ?? ""}
              onChange={(e) => setRouteFilter(e.target.value || null)}
              className="select-norse !w-auto !py-0.5 !text-[9px] !px-2"
            >
              <option value="">All Routes</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 px-4">
            <div className="text-center">
              <span className="block text-4xl font-cinzel mb-3" style={{ color: "rgba(120,144,156,0.3)" }}>
                ᛞ
              </span>
              <p className="text-text-dim text-sm tracking-wide">
                The dead rest in peace.
              </p>
              <p className="text-text-muted text-xs tracking-wide mt-1">
                No failed deliveries await judgment.
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="label-norse text-left px-3 py-2 w-6">&nbsp;</th>
                <th className="label-norse text-left px-3 py-2">Route</th>
                <th className="label-norse text-left px-3 py-2 w-24">Error</th>
                <th className="label-norse text-right px-3 py-2 w-14">Rows</th>
                <th className="label-norse text-center px-3 py-2 w-14">Retries</th>
                <th className="label-norse text-right px-3 py-2 w-16">Age</th>
                <th className="label-norse text-right px-3 py-2 w-20">Next</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const dot = STATUS_DOT[entry.status] ?? "bg-text-muted";
                const badge = ERROR_BADGE[entry.errorType] ?? ERROR_BADGE.load_failure;
                const isSelected = entry.id === selectedId;

                return (
                  <tr
                    key={entry.id}
                    onClick={() => onSelect(entry.id)}
                    className={`border-b border-border/30 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-gold-dim border-l-2 border-l-gold"
                        : "hover:bg-scroll/50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <span className={`inline-block w-2 h-2 ${dot}`} />
                    </td>
                    <td className="px-3 py-2.5 font-cinzel text-[11px] text-text truncate max-w-[160px]">
                      {entry.routeName}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block px-1.5 py-0 text-[8px] font-inconsolata tracking-wider uppercase border ${badge.border} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-inconsolata text-xs text-text-dim">
                      {entry.rowCount.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-center font-inconsolata text-xs ${entry.retryCount > 0 ? "text-ember" : "text-text-dim"}`}
                    >
                      {entry.retryCount}/{entry.maxRetries}
                    </td>
                    <td className="px-3 py-2.5 text-right font-inconsolata text-[10px] text-text-muted">
                      {relativeTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-inconsolata text-[10px] text-text-muted">
                      {entry.status === "pending" || entry.status === "retrying"
                        ? relativeCountdown(entry.nextRetryAt)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
