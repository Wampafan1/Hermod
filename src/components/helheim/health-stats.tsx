"use client";

interface Stats {
  pending: number;
  dead: number;
  recovered: number;
  total: number;
  recoveryRate: number | null;
  newLast24h: number;
}

interface Props {
  stats: Stats;
}

export function HealthStats({ stats }: Props) {
  const cards = [
    {
      label: "Pending",
      value: stats.pending.toLocaleString(),
      accent: stats.pending === 0 ? "text-success" : "text-ember",
      pulse: stats.pending > 0,
    },
    {
      label: "Dead",
      value: stats.dead.toLocaleString(),
      accent: stats.dead === 0 ? "text-success" : "text-error",
    },
    {
      label: "Recovered",
      value: stats.recovered.toLocaleString(),
      accent: "text-success",
    },
    {
      label: "Recovery Rate",
      value: stats.recoveryRate !== null ? `${stats.recoveryRate}%` : "—",
      accent:
        stats.recoveryRate === null
          ? "text-text-dim"
          : stats.recoveryRate >= 80
            ? "text-success"
            : stats.recoveryRate >= 50
              ? "text-ember"
              : "text-error",
    },
    {
      label: "New (24h)",
      value: stats.newLast24h.toLocaleString(),
      accent: stats.newLast24h === 0 ? "text-text-dim" : "text-ember",
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-px bg-border">
      {cards.map((card) => (
        <div key={card.label} className="stat-card-norse">
          <p className="label-norse">{card.label}</p>
          <p className={`text-2xl font-cinzel mt-1 ${card.accent}`}>
            {card.pulse && (
              <span className="inline-block w-2 h-2 bg-ember mr-2 animate-pip-pulse" />
            )}
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
