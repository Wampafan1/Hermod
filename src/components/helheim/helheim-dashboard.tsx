"use client";

import { useState, useCallback, useEffect } from "react";
import { HealthStats } from "./health-stats";
import { EntryList, type HelheimListEntry } from "./entry-list";
import { EntryDetail } from "./entry-detail";

interface Stats {
  pending: number;
  dead: number;
  recovered: number;
  total: number;
  recoveryRate: number | null;
  newLast24h: number;
  byErrorType: Record<string, number>;
}

interface InitialData {
  entries: HelheimListEntry[];
  stats: {
    pending: number;
    dead: number;
    recovered: number;
  };
}

interface Props {
  initialData: InitialData;
}

export function HelheimDashboard({ initialData }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState<Stats>({
    ...initialData.stats,
    total:
      initialData.stats.pending +
      initialData.stats.dead +
      initialData.stats.recovered,
    recoveryRate:
      initialData.stats.recovered + initialData.stats.dead > 0
        ? Math.round(
            (initialData.stats.recovered /
              (initialData.stats.recovered + initialData.stats.dead)) *
              100
          )
        : null,
    newLast24h: 0,
    byErrorType: {},
  });

  // Fetch full stats on mount
  useEffect(() => {
    fetch("/api/bifrost/helheim/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStats(data);
      });
  }, []);

  const handleActionComplete = useCallback(() => {
    // Refresh both list and stats
    setRefreshKey((k) => k + 1);
    fetch("/api/bifrost/helheim/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStats(data);
      });
    // Re-select the same entry to refresh detail
    setSelectedId((prev) => {
      // Force a re-render by briefly nulling
      setTimeout(() => setSelectedId(prev), 50);
      return null;
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* [A] Health Stats */}
      <div className="animate-fade-up">
        <HealthStats stats={stats} />
      </div>

      {/* [B] Entry List + [C] Detail Panel */}
      <div
        className="grid gap-4 animate-fade-up grid-cols-1 md:grid-cols-[3fr_2fr]"
        style={{ animationDelay: "0.1s" }}
      >
        <EntryList
          entries={initialData.entries}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          refreshKey={refreshKey}
        />
        <EntryDetail
          selectedId={selectedId}
          onActionComplete={handleActionComplete}
        />
      </div>
    </div>
  );
}
