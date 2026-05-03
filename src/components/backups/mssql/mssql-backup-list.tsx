"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatBytes } from "@/components/backups/coverage-card";
import { MssqlCoverageCard } from "./mssql-coverage-card";

interface MssqlPolicyItem {
  id: string;
  name: string;
  enabled: boolean;
  destinationMode: string;
  databaseSelectionMode: string;
  selectedDatabases: string[];
  nextFullRunAt: string | null;
  nextDifferentialRunAt: string | null;
  nextLogRunAt: string | null;
  lastSuccessfulFullAt: string | null;
  lastSuccessfulDiffAt: string | null;
  lastSuccessfulLogAt: string | null;
  sourceConnection: { name: string; config: Record<string, unknown> };
  storageTarget: { name: string; provider: string } | null;
  artifactCount: number;
  totalBytesStored: string;
  coverage: { status: string; reason: string };
}

const STATUS_DOT: Record<string, string> = {
  HEALTHY: "bg-emerald-400",
  DEGRADED: "bg-amber-400 status-pulse-amber",
  FAILED: "bg-ember status-pulse-red",
  NEVER_RUN: "bg-gray-600",
  UNSUPPORTED: "bg-ember",
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function selectedCount(policy: MssqlPolicyItem): string {
  if (policy.databaseSelectionMode === "ALL_USER_DATABASES") return "All user DBs";
  if (policy.databaseSelectionMode === "PATTERN") return "Pattern";
  return `${policy.selectedDatabases.length || 1} DB`;
}

export function MssqlBackupList() {
  const toast = useToast();
  const router = useRouter();
  const [policies, setPolicies] = useState<MssqlPolicyItem[]>([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [policiesRes, coverageRes] = await Promise.all([
        fetch("/api/backups/mssql/policies"),
        fetch("/api/backups/mssql/coverage"),
      ]);
      if (!policiesRes.ok || !coverageRes.ok) throw new Error("Failed to load SQL Server backups");
      setPolicies(await policiesRes.json());
      setSummary(await coverageRes.json());
    } catch {
      toast.error("Failed to load SQL Server backups");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function runAction(policyId: string, action: "run-full" | "run-differential" | "run-log") {
    const key = `${policyId}:${action}`;
    setRunningAction(key);
    try {
      const res = await fetch(`/api/backups/mssql/policies/${policyId}/${action}`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to queue SQL Server backup job");
      toast.success("SQL Server backup queued");
      fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue SQL Server backup job");
    } finally {
      setRunningAction(null);
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/backups/mssql/policies/${target.id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Failed to delete SQL Server backup policy");
      toast.success(`SQL Server backup policy "${target.name}" deleted`);
      fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete SQL Server backup policy");
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-text-dim tracking-widest uppercase">Loading SQL Server backups...</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="heading-norse text-xl">SQL Server Backups</h1>
          <div className="realm-line mt-2 w-44" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/backups" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">Postgres</Link>
          <Link href="/backups/storage" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">Storage</Link>
          <Link href="/backups/mssql/new" className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase">Create SQL Policy</Link>
        </div>
      </div>

      <MssqlCoverageCard summary={summary} />

      {policies.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <p className="text-text-dim text-sm tracking-wide">No SQL Server backup policies have been forged.</p>
          <Link href="/backups/mssql/new" className="btn-ghost inline-block mt-4">Create SQL Server Policy</Link>
        </div>
      ) : (
        <div className="border border-border bg-deep overflow-x-auto">
          <table className="w-full text-xs min-w-[1250px]">
            <thead>
              <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                {["Coverage", "Policy", "Source", "Mode", "Databases", "Last Full", "Last Diff", "Last Log", "Next Full", "Artifacts", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left font-normal">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id} className="border-b border-border/50 hover:bg-gold/[0.03]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[policy.coverage.status] ?? "bg-gray-600"}`} />
                      <span className="text-text-dim tracking-wider">{policy.coverage.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => router.push(`/backups/mssql/${policy.id}`)} className="text-text hover:text-gold-bright tracking-wider text-left">
                      {policy.name}
                    </button>
                    <span className="block text-[0.55rem] text-text-dim/70 tracking-widest uppercase">{policy.enabled ? "ACTIVE" : "DISABLED"}</span>
                  </td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">
                    {policy.sourceConnection.name}
                    <span className="block text-[0.55rem] text-frost tracking-widest uppercase">
                      {policy.sourceConnection.config?.scope === "SERVER" ? "SERVER" : String(policy.sourceConnection.config?.database ?? "database")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">{policy.destinationMode.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">{selectedCount(policy)}</td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(policy.lastSuccessfulFullAt)}</td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(policy.lastSuccessfulDiffAt)}</td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">{formatDate(policy.lastSuccessfulLogAt)}</td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">
                    {formatDate(policy.nextFullRunAt)}
                    <span className="block text-[0.55rem] text-text-dim/70">Diff {formatDate(policy.nextDifferentialRunAt)} / Log {formatDate(policy.nextLogRunAt)}</span>
                  </td>
                  <td className="px-4 py-3 text-text-dim tracking-wider">
                    {policy.artifactCount}
                    <span className="block text-[0.55rem] text-text-dim/70">{formatBytes(policy.totalBytesStored)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => runAction(policy.id, "run-full")} disabled={runningAction === `${policy.id}:run-full`} className="btn-subtle text-[0.6rem] px-2 py-1">Full</button>
                      <button onClick={() => runAction(policy.id, "run-differential")} disabled={runningAction === `${policy.id}:run-differential`} className="btn-subtle text-[0.6rem] px-2 py-1">Diff</button>
                      <button onClick={() => runAction(policy.id, "run-log")} disabled={runningAction === `${policy.id}:run-log`} className="btn-subtle text-[0.6rem] px-2 py-1">Log</button>
                      <Link href={`/backups/mssql/${policy.id}/history`} className="btn-subtle text-[0.6rem] px-2 py-1">Logs</Link>
                      <Link href={`/backups/mssql/${policy.id}`} className="btn-subtle text-[0.6rem] px-2 py-1">Edit</Link>
                      <button onClick={() => setDeleteTarget({ id: policy.id, name: policy.name })} className="btn-subtle text-[0.6rem] px-2 py-1 text-ember/70">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete SQL Server Backup Policy"
        message={deleteTarget ? `SQL Server backup policy "${deleteTarget.name}" and its run history will be removed. Storage objects are not deleted by this action.` : ""}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
