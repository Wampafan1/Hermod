"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { DashboardRecentRun } from "@/lib/dashboard/queries";
import { getErrorNarrative } from "@/lib/error-narratives";

const STATUS_FILTERS = ["all", "completed", "failed", "running", "partial"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_BADGE: Record<string, { symbol: string; label: string; className: string }> = {
  completed: { symbol: "\u2713", label: "Arrived", className: "text-success" },
  running:   { symbol: "\u27E1", label: "Riding", className: "text-warning animate-pip-pulse" },
  failed:    { symbol: "\u2715", label: "Fallen", className: "text-error" },
  partial:   { symbol: "\u25D0", label: "Wounded", className: "text-ember" },
};

const TRIGGER_LABEL: Record<string, { label: string; className: string }> = {
  manual:   { label: "By Command", className: "text-gold" },
  schedule: { label: "By Fate", className: "text-text-muted" },
  webhook:  { label: "By Fire", className: "text-realm-muspelheim" },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "\u2014";
  if (ms < 1000) return "< 1s";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = new Date(iso);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  initialRuns: DashboardRecentRun[];
  initialTotal: number;
}

export function ExecutionTimeline({ initialRuns, initialTotal }: Props) {
  const [runs, setRuns] = useState(initialRuns);
  const [total] = useState(initialTotal);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filteredRuns =
    filter === "all" ? runs : runs.filter((r) => r.status === filter);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/dashboard/recent-runs?offset=${runs.length}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        setRuns((prev) => [...prev, ...data.runs]);
      }
    } finally {
      setLoading(false);
    }
  }, [runs.length]);

  const hasMore = runs.length < total;

  return (
    <div className="bg-deep border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="label-norse !mb-0 text-gold">The Chronicle</h3>
            <p className="text-text-muted text-[9px] font-space-grotesk tracking-wider italic mt-0.5">
              Recent journeys across the Bifrost
            </p>
          </div>
          <div className="flex gap-4">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-[10px] font-space-grotesk uppercase tracking-widest transition-colors pb-0.5 ${
                  filter === s
                    ? "text-gold border-b-2 border-gold"
                    : "text-text-muted hover:text-text-dim"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="label-norse text-left px-4 py-2.5 w-24">Status</th>
              <th scope="col" className="label-norse text-left px-4 py-2.5">Route</th>
              <th scope="col" className="label-norse text-left px-4 py-2.5 w-24">Trigger</th>
              <th scope="col" className="label-norse text-right px-4 py-2.5 w-24">Scrolls</th>
              <th scope="col" className="label-norse text-right px-4 py-2.5 w-20">Duration</th>
              <th scope="col" className="label-norse text-right px-4 py-2.5 w-16">Errors</th>
              <th scope="col" className="label-norse text-right px-4 py-2.5 w-28">Time</th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <span className="text-gold-dim text-2xl font-cinzel block mb-2">ᚺ</span>
                  <p className="text-text-muted text-xs tracking-wide">
                    {filter === "all"
                      ? "No sagas have been written yet"
                      : `No ${filter} journeys recorded`}
                  </p>
                </td>
              </tr>
            ) : (
              filteredRuns.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  expanded={expandedId === run.id}
                  onToggle={() =>
                    setExpandedId(expandedId === run.id ? null : run.id)
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && filter === "all" && (
        <div className="px-4 py-3 border-t border-border text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: DashboardRecentRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasError = run.status === "failed" || run.status === "partial";
  const badge = STATUS_BADGE[run.status] ?? { symbol: "?", label: run.status, className: "text-text-muted" };
  const trigger = TRIGGER_LABEL[run.triggeredBy] ?? { label: run.triggeredBy, className: "text-text-dim" };
  const isFailed = run.status === "failed";

  return (
    <>
      <tr
        className={`border-b border-border/30 hover:bg-scroll/50 transition-colors ${hasError ? "cursor-pointer" : ""} ${isFailed ? "bg-error-dim/30" : ""}`}
        onClick={hasError ? onToggle : undefined}
        onKeyDown={hasError ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
        tabIndex={hasError ? 0 : undefined}
        role={hasError ? "button" : undefined}
      >
        <td className="px-4 py-3">
          <span className={`text-[10px] font-space-grotesk tracking-wider uppercase ${badge.className}`}>
            {badge.symbol} {badge.label}
          </span>
        </td>
        <td className="px-4 py-3">
          <Link
            href={`/bifrost/${run.routeId}`}
            onClick={(e) => e.stopPropagation()}
            className="font-cinzel text-[11px] text-text hover:text-gold transition-colors"
          >
            {run.routeName}
          </Link>
        </td>
        <td className="px-4 py-3">
          <span className={`text-[10px] font-space-grotesk tracking-wider uppercase ${trigger.className}`}>
            {trigger.label}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-inconsolata text-xs text-text">
          {run.rowsLoaded !== null ? `${run.rowsLoaded.toLocaleString()}` : "\u2014"}
        </td>
        <td className="px-4 py-3 text-right font-inconsolata text-xs text-text-dim">
          {formatDuration(run.duration)}
        </td>
        <td
          className={`px-4 py-3 text-right font-inconsolata text-xs ${run.errorCount > 0 ? "text-ember" : "text-text-muted"}`}
        >
          {run.errorCount}
        </td>
        <td
          className="px-4 py-3 text-right font-inconsolata text-[10px] text-text-muted"
          title={new Date(run.startedAt).toLocaleString()}
        >
          {formatRelativeTime(run.startedAt)}
        </td>
      </tr>
      {expanded && run.error && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <div className="bg-void border border-error/15 p-3">
              <p className="text-ember text-xs font-source-serif italic mb-1">
                {getErrorNarrative(run.error)}
              </p>
              <p className="font-inconsolata text-[10px] text-error/70 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                {run.error}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
