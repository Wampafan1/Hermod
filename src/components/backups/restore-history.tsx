"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { formatDurationMs } from "@/lib/format-utils";
import { formatBytes } from "./coverage-card";

interface RestoreJob {
  id: string;
  mode: string;
  status: string;
  objectKey: string;
  checksumVerified: boolean;
  bytesDownloaded: string | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  policy: { id: string; name: string };
  backupRun: { id: string; startedAt: string; type: string } | null;
  targetConnection: { id: string; name: string; config: Record<string, unknown> };
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-gold animate-pulse",
  SUCCESS: "text-emerald-400",
  FAILED: "text-ember",
  CANCELLED: "text-gray-400",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function RestoreHistory() {
  const toast = useToast();
  const [jobs, setJobs] = useState<RestoreJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backups/restores");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load restore history");
      setJobs(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load restore history");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(id: string) {
    setRetrying(id);
    try {
      const res = await fetch(`/api/backups/restores/${id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retry restore");
      toast.success("Restore retry queued");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry restore");
    } finally {
      setRetrying(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading restores...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="heading-norse text-xl">Restore History</h1>
          <div className="realm-line mt-2 w-40" />
        </div>
        <Link href="/backups/restore" className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase">
          New Restore
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <p className="text-text-dim text-sm tracking-wide">No restore jobs have been recorded.</p>
        </div>
      ) : (
        <div className="border border-border bg-deep overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1050px]">
              <thead>
                <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                  <th scope="col" className="px-4 py-3 text-left font-normal">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Policy</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Backup</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Target</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Checksum</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Bytes</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Duration</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors">
                    <td className={`px-4 py-3 ${STATUS_COLORS[job.status] ?? "text-text-dim"}`}>{job.status}</td>
                    <td className="px-4 py-3 text-text tracking-wider">{job.policy.name}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {job.backupRun ? formatDate(job.backupRun.startedAt) : "-"}
                      <span className="block text-[0.55rem] text-gold tracking-widest uppercase">{job.mode}</span>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {job.targetConnection.name}
                      <span className="block text-[0.55rem] text-frost tracking-widest uppercase">
                        {String(job.targetConnection.config?.database ?? "postgres")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{job.checksumVerified ? "Verified" : "-"}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{formatBytes(job.bytesDownloaded)}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{formatDurationMs(job.durationMs)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/backups/restores/${job.id}`} className="btn-subtle text-[0.6rem] px-2 py-1">
                          Details
                        </Link>
                        {job.status === "FAILED" && (
                          <button
                            onClick={() => retry(job.id)}
                            disabled={retrying === job.id}
                            className="btn-subtle text-[0.6rem] px-2 py-1"
                          >
                            {retrying === job.id ? "Queueing..." : "Retry"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
