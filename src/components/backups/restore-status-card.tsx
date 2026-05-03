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
  checksumSha256: string | null;
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

const STATUS_STYLE: Record<string, string> = {
  RUNNING: "bg-gold status-pulse-amber",
  SUCCESS: "bg-emerald-400",
  FAILED: "bg-ember status-pulse-red",
  CANCELLED: "bg-gray-500",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function RestoreStatusCard({ restoreId }: { restoreId: string }) {
  const toast = useToast();
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/backups/restores/${restoreId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load restore job");
      setJob(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load restore job");
    } finally {
      setLoading(false);
    }
  }, [restoreId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (job?.status !== "RUNNING") return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [job?.status, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading restore...</span>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="border border-border bg-deep p-8 text-center">
        <p className="text-text-dim text-sm tracking-wider">Restore job not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/backups/restores" className="text-text-dim text-xs tracking-wider hover:text-gold">
            &larr; Restore History
          </Link>
          <h1 className="heading-norse text-lg mt-3">Restore Status</h1>
          <div className="realm-line mt-2 w-40" />
        </div>
        <Link href={`/backups/${job.policy.id}/restore`} className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
          New Restore
        </Link>
      </div>

      <div className="border border-border bg-deep p-5">
        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[job.status] ?? "bg-gray-500"}`} />
          <span className="heading-norse text-sm">{job.status}</span>
          <span className="text-text-dim text-xs tracking-widest uppercase">{job.mode}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
          <Field label="Policy" value={job.policy.name} />
          <Field label="Target" value={`${job.targetConnection.name} (${String(job.targetConnection.config?.database ?? "postgres")})`} />
          <Field label="Backup Point" value={job.backupRun ? formatDate(job.backupRun.startedAt) : "-"} />
          <Field label="Duration" value={formatDurationMs(job.durationMs)} />
          <Field label="Bytes Downloaded" value={formatBytes(job.bytesDownloaded)} />
          <Field label="Checksum Verified" value={job.checksumVerified ? "Yes" : "No"} />
          <Field label="Started" value={formatDate(job.startedAt)} />
          <Field label="Completed" value={formatDate(job.completedAt)} />
        </div>

        <div className="mt-5">
          <span className="label-norse">Artifact</span>
          <p className="font-mono text-text-dim text-[0.7rem] tracking-wide break-all mt-2">{job.objectKey}</p>
        </div>

        {job.checksumSha256 && (
          <div className="mt-5">
            <span className="label-norse">Checksum</span>
            <p className="font-mono text-text-dim text-[0.7rem] tracking-wide break-all mt-2">{job.checksumSha256}</p>
          </div>
        )}

        {job.error && (
          <div className="border border-ember/30 bg-ember/10 p-4 mt-5 text-ember text-xs tracking-wide leading-6">
            {job.error}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-deep p-4">
      <div className="label-norse">{label}</div>
      <div className="text-text text-xs tracking-wider mt-2">{value}</div>
    </div>
  );
}
