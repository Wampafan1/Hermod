"use client";

import Link from "next/link";
import type { DashboardStats } from "@/lib/dashboard/queries";

function formatAbbreviated(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function getSuccessNarrative(rate: number | null): { color: string; sublabel: string } {
  if (rate === null) return { color: "var(--text-dim)", sublabel: "No dispatches recorded yet" };
  if (rate >= 95) return { color: "var(--success)", sublabel: "The realms are strong" };
  if (rate >= 80) return { color: "var(--gold)", sublabel: "Most messengers arrive safely" };
  if (rate >= 60) return { color: "var(--ember)", sublabel: "Some messengers fall along the way" };
  return { color: "var(--error)", sublabel: "The Bifrost weakens — check your routes" };
}

function getHelheimNarrative(n: number): string {
  if (n === 0) return "The dead rest in peace";
  if (n <= 5) return `${n} failed ${n === 1 ? "delivery awaits" : "deliveries await"} judgment`;
  if (n <= 20) return "The underworld stirs — attend to the fallen";
  return "Helheim overflows — immediate attention required";
}

interface Props {
  stats: DashboardStats;
}

export function HealthSummary({ stats }: Props) {
  const successInfo = getSuccessNarrative(stats.successRate);

  const cards = [
    {
      value: stats.activeRoutes.toLocaleString(),
      label: "Messengers Riding the Bifrost",
      sublabel: `${stats.activeRoutes} active route${stats.activeRoutes !== 1 ? "s" : ""} carrying data between realms`,
      rune: "ᛒ",
      accentColor: undefined as string | undefined, // rainbow
      rainbow: true,
    },
    {
      value: stats.runsToday.toLocaleString(),
      label: "Dispatches Today",
      sublabel: `${stats.runsToday} ${stats.runsToday === 1 ? "journey" : "journeys"} completed since dawn`,
      rune: "ᚱ",
      accentColor: "var(--gold)",
    },
    {
      value: stats.successRate !== null ? `${stats.successRate.toFixed(1)}%` : "—",
      label: "Realm Reach",
      sublabel: successInfo.sublabel,
      rune: "ᛊ",
      accentColor: successInfo.color,
    },
    {
      value: formatAbbreviated(stats.rowsSynced),
      label: "Rows Ferried",
      sublabel: `${stats.rowsSynced.toLocaleString()} records carried across realms this week`,
      rune: "ᚠ",
      accentColor: "var(--gold)",
    },
    {
      value: stats.helheimPending.toLocaleString(),
      label: "Souls in Helheim",
      sublabel: getHelheimNarrative(stats.helheimPending),
      rune: "ᚺ",
      accentColor: stats.helheimPending === 0
        ? "#78909c"
        : stats.helheimPending <= 5
          ? "var(--ember)"
          : "var(--error)",
      pulse: stats.helheimPending > 0,
      href: "/helheim",
      helheim: stats.helheimPending > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border">
      {cards.map((card) => {
        const borderTop = card.rainbow
          ? "linear-gradient(90deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)"
          : card.accentColor;

        const inner = (
          <div
            key={card.label}
            className={`relative bg-deep p-5 overflow-hidden transition-colors ${card.helheim ? "bg-[rgba(120,144,156,0.03)]" : ""}`}
            style={{ borderTop: `3px solid ${card.rainbow ? "transparent" : (card.accentColor ?? "var(--gold)")}` }}
          >
            {/* Rainbow top border for first card */}
            {card.rainbow && (
              <div
                className="absolute top-0 left-0 right-0 h-[3px]"
                style={{ background: borderTop as string }}
              />
            )}

            {/* Decorative rune in corner */}
            <span
              className="absolute top-3 right-3 text-[40px] font-cinzel select-none leading-none"
              style={{ color: card.accentColor ?? "var(--gold)", opacity: 0.06 }}
            >
              {card.rune}
            </span>

            {/* Value */}
            <p
              className="text-[28px] font-cinzel font-bold tracking-wide"
              style={{ color: card.accentColor ?? "var(--gold)" }}
            >
              {card.pulse && (
                <span className="inline-block w-2 h-2 mr-2 animate-pip-pulse" style={{ background: card.accentColor }} />
              )}
              {card.value}
            </p>

            {/* Label */}
            <p className="text-[9px] font-inconsolata uppercase tracking-[0.25em] text-text-muted mt-1">
              {card.label}
            </p>

            {/* Narrative sublabel */}
            <p className="text-xs font-source-serif italic text-text-muted/50 mt-1.5 leading-snug">
              {card.sublabel}
            </p>

            {/* Helheim fog effect */}
            {card.helheim && (
              <div
                className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                style={{ background: "linear-gradient(transparent, rgba(120,144,156,0.05))" }}
              />
            )}
          </div>
        );

        if (card.href) {
          return (
            <Link key={card.label} href={card.href} className="contents">
              {inner}
            </Link>
          );
        }
        return <div key={card.label}>{inner}</div>;
      })}
    </div>
  );
}
