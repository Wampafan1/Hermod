"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { formatBytes } from "@/components/backups/coverage-card";
import { formatDurationMs } from "@/lib/format-utils";

interface MssqlBackupRun {
  id: string;
  type: string;
  status: string;
  triggeredBy: string;
  databaseName: string | null;
  artifactMetadata: Record<string, unknown> | null;
  bytesWritten: string | null;
  checksumSha256: string | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "text-emerald-400",
  PARTIAL: "text-amber-400",
  FAILED: "text-ember",
  RUNNING: "text-gold animate-pulse",
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function metadataRows(metadata: Record<string, unknown> | null): Array<[string, string]> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]);
}

export function MssqlBackupHistory({ policyId }: { policyId: string }) {
  const toast = useToast();
  const [policyName, setPolicyName] = useState("");
  const [runs, setRuns] = useState<MssqlBackupRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [policyRes, runsRes] = await Promise.all([
        fetch(`/api/backups/mssql/policies/${policyId}`),
        fetch(`/api/backups/mssql/policies/${policyId}/runs`),
      ]);
      if (!policyRes.ok || !runsRes.ok) throw new Error("Failed to load SQL Server backup history");
      const policy = await policyRes.json();
      const history = await runsRes.json();
      setPolicyName(policy.name ?? "");
      setRuns(history.items ?? []);
      setCursor(history.nextCursor ?? null);
    } catch {
      toast.error("Failed to load SQL Server backup history");
    } finally {
      setLoading(false);
    }
  }, [policyId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/backups/mssql/policies/${policyId}/runs?cursor=${cursor}`);
      const history = await res.json();
      if (!res.ok) throw new Error(history.error || "Failed to load more SQL Server backup runs");
      setRuns((prev) => [...prev, ...(history.items ?? [])]);
      setCursor(history.nextCursor ?? null);
    } catch {
      toast.error("Failed to load more SQL Server backup runs");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-text-dim tracking-widest uppercase">Loading SQL Server backup history...</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="heading-norse text-lg">{policyName || "SQL Server Backup History"}</h1>
          <div className="realm-line mt-2 w-44" />
        </div>
        <Link href={`/backups/mssql/${policyId}`} className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
          Edit Policy
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="border border-border bg-deep p-8 text-center">
          <p className="text-text-dim text-sm tracking-wider">No SQL Server backup runs yet.</p>
        </div>
      ) : (
        <div className="border border-border bg-deep overflow-x-auto">
          <table className="w-full text-xs min-w-[980px]">
            <thead>
              <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                {["Status", "Type", "Database", "Started", "Duration", "Bytes", "Checksum", "Trigger"].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 text-left font-normal">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const rows = metadataRows(run.artifactMetadata);
                const isExpanded = expanded === run.id;
                return (
                  <Fragment key={run.id}>
                    <tr
                      className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : run.id)}
                    >
                      <td className={`px-4 py-3 ${STATUS_COLORS[run.status] ?? "text-text-dim"}`}>
                        {rows.length > 0 && (isExpanded ? "v " : "> ")}
                        {run.status}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{run.type}</td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{run.databaseName ?? "-"}</td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(run.startedAt)}</td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{formatDurationMs(run.durationMs)}</td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{formatBytes(run.bytesWritten)}</td>
                      <td className="px-4 py-3 text-text-dim tracking-wider font-mono">
                        {run.checksumSha256 ? `${run.checksumSha256.slice(0, 16)}...` : "-"}
                      </td>
                      <td className="px-4 py-3 text-text-dim tracking-wider">{run.triggeredBy}</td>
                    </tr>
                    {run.error && (
                      <tr className="border-b border-border/30 bg-void/40">
                        <td colSpan={8} className="px-6 py-2 text-ember text-[0.65rem] tracking-wider">
                          {run.error}
                        </td>
                      </tr>
                    )}
                    {isExpanded && rows.map(([key, value]) => (
                      <tr key={`${run.id}:${key}`} className="border-b border-border/30 bg-void/40">
                        <td className="px-8 py-2 text-frost text-[0.62rem] tracking-widest uppercase">{key}</td>
                        <td colSpan={7} className="px-4 py-2 text-text-dim font-mono text-[0.65rem] break-all">{value}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="mt-4 text-center">
          <button onClick={loadMore} disabled={loadingMore} className="btn-ghost px-5 py-2 text-xs tracking-[0.15em] uppercase">
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
