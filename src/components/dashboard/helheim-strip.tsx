"use client";

import Link from "next/link";
import type { DashboardHelheim } from "@/lib/dashboard/queries";

interface Props {
  helheim: DashboardHelheim;
}

export function HelheimStrip({ helheim }: Props) {
  const cells = [
    {
      label: "Pending",
      value: (helheim.pending + helheim.retrying).toLocaleString(),
      accent:
        helheim.pending + helheim.retrying === 0
          ? "text-success"
          : "text-ember",
    },
    {
      label: "Dead",
      value: helheim.dead.toLocaleString(),
      accent: helheim.dead === 0 ? "text-success" : "text-error",
    },
    {
      label: "Recovery Rate",
      value:
        helheim.recoveryRate !== null
          ? `${helheim.recoveryRate.toFixed(1)}%`
          : "—",
      accent: "text-text",
    },
  ];

  return (
    <div className="flex items-stretch gap-px bg-border">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex-1 bg-deep px-4 py-3"
        >
          <p className="label-norse">{cell.label}</p>
          <p className={`text-lg font-cinzel ${cell.accent}`}>{cell.value}</p>
        </div>
      ))}
      <div className="flex items-center bg-deep px-4 py-3">
        <Link
          href="/helheim"
          className="text-frost text-xs font-space-grotesk tracking-wider uppercase hover:underline"
        >
          View Helheim →
        </Link>
      </div>
    </div>
  );
}
