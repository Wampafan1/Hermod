"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import type { DashboardRoute } from "@/lib/dashboard/queries";
import { REALM_ICONS } from "@/lib/realm-config";
import { getErrorNarrative } from "@/lib/error-narratives";

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  completed: { dot: "bg-success", label: "Arrived" },
  running:   { dot: "bg-warning animate-pip-pulse", label: "Riding" },
  failed:    { dot: "bg-error status-pulse-red", label: "Fallen" },
  partial:   { dot: "bg-ember", label: "Wounded" },
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

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return "< 1s";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

function formatNextRun(iso: string | null): string {
  if (!iso) return "Not scheduled";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  routes: DashboardRoute[];
}

export function RouteHealthGrid({ routes }: Props) {
  if (routes.length === 0) {
    return (
      <div className="bg-deep border border-border p-12 text-center">
        <span
          className="text-4xl font-cinzel block mb-3 animate-rune-float"
          style={{
            background: "linear-gradient(135deg, rgba(255,107,107,0.3), rgba(255,167,38,0.3), rgba(255,238,88,0.3), rgba(102,187,106,0.3), rgba(66,165,245,0.3), rgba(126,87,194,0.3))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >ᛒ</span>
        <p className="text-text-dim text-sm tracking-wide">The Bifrost awaits its first crossing.</p>
        <Link href="/bifrost/new" className="btn-ghost text-xs mt-4 inline-block">
          Forge New Route
        </Link>
      </div>
    );
  }

  return (
    <div
      className="grid gap-px bg-border"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}
    >
      {routes.map((route) => (
        <RouteCard key={route.id} route={route} />
      ))}
    </div>
  );
}

function RouteCard({ route }: { route: DashboardRoute }) {
  const [triggering, setTriggering] = useState(false);
  const toast = useToast();

  const isRunning = route.lastRun?.status === "running";
  const isFailed = route.lastRun?.status === "failed";
  const isDisabled = !route.enabled;

  async function handleTrigger(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (triggering || isRunning) return;

    setTriggering(true);
    try {
      const res = await fetch(`/api/bifrost/routes/${route.id}/run`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        toast.error(body.error || "Failed to trigger route");
      } else {
        toast.success(`Route "${route.name}" triggered`);
      }
    } catch {
      toast.error("Network error triggering route");
    } finally {
      setTriggering(false);
    }
  }

  const status = route.lastRun
    ? STATUS_STYLE[route.lastRun.status] ?? { dot: "bg-text-muted", label: "" }
    : null;

  const srcIcon = REALM_ICONS[route.sourceType];
  const dstIcon = REALM_ICONS[route.destType];

  return (
    <Link
      href={`/bifrost/${route.id}`}
      className={`block bg-void p-4 hoverable-card transition-all ${isDisabled ? "opacity-50" : ""}`}
    >
      {/* Row 1: Status + Name + Trigger */}
      <div className="flex items-center gap-2">
        {status ? (
          <span className={`inline-block w-2.5 h-2.5 shrink-0 ${status.dot}`} />
        ) : (
          <span className="inline-block w-2.5 h-2.5 shrink-0 border border-border-mid bg-transparent" />
        )}
        <span className="font-cinzel text-sm text-text truncate flex-1">
          {route.name}
        </span>
        {route.helheimPending > 0 && (
          <span className="text-[10px] font-space-grotesk tracking-wider uppercase text-ember">
            {route.helheimPending} dlq
          </span>
        )}
        <button
          onClick={handleTrigger}
          disabled={triggering || isRunning || isDisabled}
          className="btn-ghost !p-1 !min-h-0 text-[10px] !tracking-normal disabled:opacity-30 hover:!bg-gold-dim"
          title="Trigger manual run"
        >
          {triggering ? "..." : "▶"}
        </button>
      </div>

      {/* Row 2: Source → Dest flow with realm icons */}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] font-space-grotesk tracking-wider uppercase">
        {srcIcon && (
          <span style={{ color: srcIcon.color }}>{srcIcon.icon}</span>
        )}
        <span style={{ color: srcIcon?.color ?? "var(--text-muted)" }}>
          {route.sourceType}
        </span>
        <span className="text-text-muted mx-0.5">→</span>
        {dstIcon && (
          <span style={{ color: dstIcon.color }}>{dstIcon.icon}</span>
        )}
        <span style={{ color: dstIcon?.color ?? "var(--text-muted)" }}>
          {route.destType}
        </span>
      </div>

      {/* Row 3: Last run info — narrative for failures */}
      <div className="mt-2 text-[11px] font-inconsolata leading-relaxed">
        {route.lastRun ? (
          isFailed ? (
            <span className="text-ember" title={route.lastRun.errorCount > 0 ? "Click route for details" : undefined}>
              {getErrorNarrative(null)}
              <span className="text-text-muted ml-1">· {relativeTime(route.lastRun.startedAt)}</span>
            </span>
          ) : (
            <span className="text-text-dim">
              Last rode {relativeTime(route.lastRun.startedAt)}
              {route.lastRun.rowsLoaded !== null && (
                <> · {route.lastRun.rowsLoaded.toLocaleString()} scrolls</>
              )}
              {route.lastRun.duration !== null && (
                <> · {formatDuration(route.lastRun.duration)}</>
              )}
            </span>
          )
        ) : (
          <span className="text-text-muted italic">Awaiting first dispatch</span>
        )}
      </div>

      {/* Row 4: Next run */}
      <div className="mt-0.5 text-[11px] font-inconsolata text-text-muted">
        {route.lastRun ? "Next dispatch" : "Scheduled"}: {formatNextRun(route.nextRunAt)}
      </div>
    </Link>
  );
}
