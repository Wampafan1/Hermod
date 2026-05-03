"use client";

interface CoverageSummary {
  policyCount: number;
  artifactCount: number;
  totalBytesStored: string;
  byStatus: Record<string, number>;
}

function formatBytes(value: string | number | null | undefined): string {
  const bytes = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index++;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function CoverageCard({ summary }: { summary: CoverageSummary | null }) {
  const healthy = summary?.byStatus.HEALTHY ?? 0;
  const degraded = summary?.byStatus.DEGRADED ?? 0;
  const failed = summary?.byStatus.FAILED ?? 0;
  const neverRun = summary?.byStatus.NEVER_RUN ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-px bg-border mb-6">
      <Stat label="Policies" value={String(summary?.policyCount ?? 0)} />
      <Stat label="Healthy" value={String(healthy)} color="text-emerald-400" />
      <Stat label="Degraded" value={String(degraded)} color="text-amber-400" />
      <Stat label="Failed" value={String(failed)} color="text-ember" />
      <Stat label="Never Run" value={String(neverRun)} />
      <Stat label="Stored" value={formatBytes(summary?.totalBytesStored ?? "0")} />
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

export { formatBytes };
