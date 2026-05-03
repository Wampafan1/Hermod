"use client";

import { useCallback, useEffect, useState } from "react";
import { Fragment } from "react";
import { useToast } from "@/components/toast";
import { formatDurationMs } from "@/lib/format-utils";
import { formatBytes } from "./coverage-card";

interface BackupRun {
  id: string;
  type: string;
  status: string;
  triggeredBy: string;
  objectKeys: unknown;
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

function objectKeyRows(value: unknown): Array<{ key: string; database?: string; bytes?: number; checksumSha256?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ key: item }];
    if (item && typeof item === "object" && "key" in item) {
      const record = item as { key?: unknown; database?: unknown; bytes?: unknown; checksumSha256?: unknown };
      if (typeof record.key !== "string") return [];
      return [{
        key: record.key,
        database: typeof record.database === "string" ? record.database : undefined,
        bytes: typeof record.bytes === "number" ? record.bytes : undefined,
        checksumSha256: typeof record.checksumSha256 === "string" ? record.checksumSha256 : undefined,
      }];
    }
    return [];
  });
}

export function BackupHistory({ policyId }: { policyId: string }) {
  const toast = useToast();
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [policyName, setPolicyName] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [policyRes, runsRes] = await Promise.all([
        fetch(`/api/backups/policies/${policyId}`),
        fetch(`/api/backups/policies/${policyId}/runs`),
      ]);
      if (!policyRes.ok || !runsRes.ok) throw new Error("Failed to load backup history");
      const policy = await policyRes.json();
      const history = await runsRes.json();
      setPolicyName(policy.name ?? "");
      setRuns(history.items ?? []);
      setCursor(history.nextCursor ?? null);
    } catch {
      toast.error("Failed to load backup history");
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
      const res = await fetch(`/api/backups/policies/${policyId}/runs?cursor=${cursor}`);
      const history = await res.json();
      if (!res.ok) throw new Error(history.error || "Failed to load more runs");
      setRuns((prev) => [...prev, ...(history.items ?? [])]);
      setCursor(history.nextCursor ?? null);
    } catch {
      toast.error("Failed to load more runs");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading backup history...</span>
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading-norse text-lg mb-6">{policyName || "Backup History"}</h1>
      {runs.length === 0 ? (
        <div className="border border-border bg-deep p-8 text-center">
          <p className="text-text-dim text-sm tracking-wider">No backup runs yet.</p>
        </div>
      ) : (
        <div className="border border-border bg-deep overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                  <th scope="col" className="px-4 py-3 text-left font-normal">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Type</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Started</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Duration</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Bytes</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Checksum</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const objects = objectKeyRows(run.objectKeys);
                  const isExpanded = expanded === run.id;
                  return (
                    <Fragment key={run.id}>
                      <tr
                        className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : run.id)}
                      >
                        <td className={`px-4 py-3 ${STATUS_COLORS[run.status] ?? "text-text-dim"}`}>
                          {objects.length > 0 && (isExpanded ? "v " : "> ")}
                          {run.status}
                        </td>
                        <td className="px-4 py-3 text-text-dim tracking-wider">{run.type}</td>
                        <td className="px-4 py-3 text-text-dim tracking-wider">{new Date(run.startedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-text-dim tracking-wider">{formatDurationMs(run.durationMs)}</td>
                        <td className="px-4 py-3 text-text-dim tracking-wider">{formatBytes(run.bytesWritten)}</td>
                        <td className="px-4 py-3 text-text-dim tracking-wider font-mono">
                          {run.checksumSha256 ? `${run.checksumSha256.slice(0, 16)}...` : "-"}
                        </td>
                        <td className="px-4 py-3 text-text-dim tracking-wider">{run.triggeredBy}</td>
                      </tr>
                      {run.error && (
                        <tr className="border-b border-border/30 bg-void/40">
                          <td colSpan={7} className="px-6 py-2 text-ember text-[0.65rem] tracking-wider">
                            {run.error}
                          </td>
                        </tr>
                      )}
                      {isExpanded && objects.map((object) => (
                        <tr key={`${run.id}:${object.key}`} className="border-b border-border/30 bg-void/40">
                          <td colSpan={4} className="px-8 py-2 text-text-dim font-mono text-[0.65rem] break-all">
                            {object.database && (
                              <span className="text-frost tracking-widest uppercase mr-3">{object.database}</span>
                            )}
                            {object.key}
                          </td>
                          <td className="px-4 py-2 text-text-dim text-[0.65rem]">
                            {object.bytes ? formatBytes(object.bytes) : "-"}
                          </td>
                          <td colSpan={2} className="px-4 py-2 text-text-dim font-mono text-[0.65rem]">
                            {object.checksumSha256 ? `${object.checksumSha256.slice(0, 20)}...` : "-"}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cursor && (
        <div className="flex justify-center py-4">
          <button onClick={loadMore} disabled={loadingMore} className="btn-ghost text-xs">
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
