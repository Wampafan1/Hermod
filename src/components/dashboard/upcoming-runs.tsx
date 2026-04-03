"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { DashboardUpcoming } from "@/lib/dashboard/queries";

function formatCountdown(targetIso: string, now: number): string {
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return "now";

  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `In ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return `In ${hrs}h ${remMins}m`;
  return `In ${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function urgencyStyle(targetIso: string, now: number): { className: string; imminent: boolean } {
  const diff = new Date(targetIso).getTime() - now;
  const mins = diff / 60_000;
  if (mins <= 5) return { className: "text-gold font-semibold", imminent: true };
  if (mins <= 15) return { className: "text-ember font-semibold", imminent: false };
  if (mins <= 60) return { className: "text-gold", imminent: false };
  return { className: "text-text-dim", imminent: false };
}

interface Props {
  runs: DashboardUpcoming[];
}

export function UpcomingRuns({ runs }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-deep border border-border overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="label-norse !mb-0 text-gold">Upcoming Dispatches</h3>
        <p className="text-text-muted text-[9px] font-space-grotesk tracking-wider italic mt-0.5">
          The next messengers to ride
        </p>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 500 }}>
        {runs.length === 0 ? (
          <div className="p-6 text-center">
            <span className="text-gold-dim text-xl font-cinzel block mb-2">ᛏ</span>
            <p className="text-text-muted text-xs tracking-wide">
              No dispatches in the next 24 hours
            </p>
          </div>
        ) : (
          <div>
            {runs.map((run, i) => {
              const urgency = urgencyStyle(run.nextRunAt, now);
              return (
                <div key={run.id}>
                  <Link
                    href={`/bifrost/${run.id}`}
                    className="block px-4 py-3 hover:bg-scroll transition-colors"
                  >
                    <p className="font-cinzel text-sm text-text truncate">
                      {run.name}
                    </p>
                    <p className={`text-[11px] font-inconsolata mt-0.5 ${urgency.className}`}
                      style={urgency.imminent ? { animation: "dispatchImminent 3s ease-in-out infinite" } : undefined}
                    >
                      {formatCountdown(run.nextRunAt, now)} · {formatAbsoluteTime(run.nextRunAt)}
                    </p>
                  </Link>
                  {/* Rune divider between items */}
                  {i < runs.length - 1 && (
                    <div className="flex items-center gap-3 px-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-gold-dim text-[8px] font-cinzel select-none">ᚱ</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
