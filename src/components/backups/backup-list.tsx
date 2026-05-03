"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { CoverageCard, formatBytes } from "./coverage-card";

interface BackupPolicyItem {
  id: string;
  name: string;
  enabled: boolean;
  fullFrequency: string;
  walFrequency: string | null;
  nextFullRunAt: string | null;
  nextWalRunAt: string | null;
  lastSuccessfulFullAt: string | null;
  lastSuccessfulWalAt: string | null;
  walEnabled: boolean;
  sourceConnection: { name: string; type: string; config: Record<string, unknown> };
  storageTarget: { name: string; provider: string };
  artifactCount: number;
  totalBytesStored: string;
  latestChecksum: string | null;
  coverage: { status: string; reason: string };
  runs: Array<{ status: string; type: string; error: string | null }>;
}

interface CoverageSummary {
  policyCount: number;
  artifactCount: number;
  totalBytesStored: string;
  byStatus: Record<string, number>;
}

const STATUS_DOT: Record<string, string> = {
  HEALTHY: "bg-emerald-400",
  DEGRADED: "bg-amber-400 status-pulse-amber",
  FAILED: "bg-ember status-pulse-red",
  NEVER_RUN: "bg-gray-600",
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function checksumShort(value: string | null): string {
  return value ? `${value.slice(0, 12)}...` : "-";
}

export function BackupList() {
  const toast = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<BackupPolicyItem[]>([]);
  const [summary, setSummary] = useState<CoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [policiesRes, coverageRes] = await Promise.all([
        fetch("/api/backups/policies"),
        fetch("/api/backups/coverage"),
      ]);
      if (!policiesRes.ok || !coverageRes.ok) throw new Error("Failed to load backups");
      setPolicies(await policiesRes.json());
      setSummary(await coverageRes.json());
    } catch {
      toast.error("Failed to load backups");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function runAction(policyId: string, action: "run-full" | "run-wal") {
    const key = `${policyId}:${action}`;
    setRunningAction(key);
    try {
      const res = await fetch(`/api/backups/policies/${policyId}/${action}`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to queue backup job");
      toast.success(action === "run-full" ? "Full backup queued" : "WAL archive queued");
      fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue backup job");
    } finally {
      setRunningAction(null);
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/backups/policies/${target.id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Failed to delete policy");
      toast.success(`Backup policy "${target.name}" deleted`);
      fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete policy");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading backups...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="heading-norse text-xl">Niflheim Backups</h1>
          <div className="realm-line mt-2 w-40" />
        </div>
        <div className="flex items-center gap-3">
          <Link href="/backups/mssql" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            SQL Server
          </Link>
          <Link href="/backups/restores" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            Restores
          </Link>
          <Link href="/backups/storage" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            Storage Targets
          </Link>
          <Link href="/backups/restore" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            Restore
          </Link>
          <Link href="/backups/new" className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase">
            Create Policy
          </Link>
        </div>
      </div>

      <CoverageCard summary={summary} />

      {policies.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <p className="text-text-dim text-sm tracking-wide">No Niflheim policies have been forged.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-4">
            <Link href="/backups/storage/new" className="btn-ghost inline-block">
              Create Storage Target
            </Link>
            <Link href="/backups/new" className="btn-ghost inline-block">
              Create Postgres Policy
            </Link>
            <Link href="/backups/mssql/new" className="btn-ghost inline-block">
              Create SQL Server Policy
            </Link>
          </div>
        </div>
      ) : (
        <div className="border border-border bg-deep">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                  <th scope="col" className="px-4 py-3 text-left font-normal">Coverage</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Policy</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Source</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Storage</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Last Full</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Last WAL</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Next Full</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Next WAL</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Artifacts</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id} className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[policy.coverage.status] ?? "bg-gray-600"}`} />
                        <span className="text-text-dim tracking-wider">{policy.coverage.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/backups/${policy.id}`)}
                        className="text-text hover:text-gold-bright tracking-wider text-left"
                      >
                        {policy.name}
                      </button>
                      <div className="text-[0.55rem] text-text-dim/70 tracking-widest uppercase mt-1">
                        {policy.enabled ? "ACTIVE" : "DISABLED"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {policy.sourceConnection.name}
                      <span className="block text-[0.55rem] text-frost tracking-widest uppercase">
                        {policy.sourceConnection.config?.scope === "SERVER"
                          ? `server via ${String(policy.sourceConnection.config?.maintenanceDatabase ?? "postgres")}`
                          : String(policy.sourceConnection.config?.database ?? "postgres")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {policy.storageTarget.name}
                      <span className="block text-[0.55rem] text-gold tracking-widest uppercase">
                        {policy.storageTarget.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(policy.lastSuccessfulFullAt)}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {policy.walEnabled ? formatDate(policy.lastSuccessfulWalAt) : "WAL off"}
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(policy.nextFullRunAt)}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {policy.walEnabled ? formatDate(policy.nextWalRunAt) : "WAL off"}
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {policy.artifactCount.toLocaleString()}
                      <span className="block text-[0.55rem] text-text-dim/70">
                        {formatBytes(policy.totalBytesStored)} / {checksumShort(policy.latestChecksum)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => runAction(policy.id, "run-full")}
                          disabled={runningAction === `${policy.id}:run-full`}
                          className="btn-subtle text-[0.6rem] px-2 py-1"
                        >
                          {runningAction === `${policy.id}:run-full` ? "Queueing..." : "Run Full"}
                        </button>
                        <button
                          onClick={() => runAction(policy.id, "run-wal")}
                          disabled={!policy.walEnabled || runningAction === `${policy.id}:run-wal`}
                          title={policy.walEnabled ? "Archive WAL now" : "Enable WAL/PITR coverage on the policy first"}
                          className="btn-subtle text-[0.6rem] px-2 py-1"
                        >
                          {runningAction === `${policy.id}:run-wal` ? "Queueing..." : policy.walEnabled ? "Archive WAL" : "WAL Off"}
                        </button>
                        <Link href={`/backups/${policy.id}/history`} className="btn-subtle text-[0.6rem] px-2 py-1">
                          Logs
                        </Link>
                        <Link href={`/backups/${policy.id}/restore`} className="btn-subtle text-[0.6rem] px-2 py-1">
                          Restore
                        </Link>
                        <Link href={`/backups/${policy.id}`} className="btn-subtle text-[0.6rem] px-2 py-1">
                          Edit
                        </Link>
                        <button
                          onClick={() => setDeleteTarget({ id: policy.id, name: policy.name })}
                          className="btn-subtle text-[0.6rem] px-2 py-1 text-ember/70 hover:text-ember"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Backup Policy"
        message={deleteTarget ? `Backup policy "${deleteTarget.name}" and its run history will be removed. Storage objects are not deleted by this action.` : ""}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
