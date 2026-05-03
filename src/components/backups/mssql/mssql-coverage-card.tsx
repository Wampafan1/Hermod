"use client";

import { formatBytes } from "@/components/backups/coverage-card";

interface MssqlCoverageCardProps {
  summary: {
    policyCount: number;
    artifactCount: number;
    totalBytesStored: string;
    byStatus: Record<string, number>;
  } | null;
}

export function MssqlCoverageCard({ summary }: MssqlCoverageCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border mb-6">
      {[
        ["Policies", summary?.policyCount ?? 0],
        ["Artifacts", summary?.artifactCount ?? 0],
        ["Stored", formatBytes(summary?.totalBytesStored ?? "0")],
        ["Healthy", summary?.byStatus?.HEALTHY ?? 0],
      ].map(([label, value]) => (
        <div key={label} className="bg-deep p-4">
          <p className="label-norse">{label}</p>
          <p className="text-text text-lg tracking-wider mt-2">{value}</p>
        </div>
      ))}
    </div>
  );
}
