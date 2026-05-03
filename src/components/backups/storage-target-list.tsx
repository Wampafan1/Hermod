"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface StorageTargetListItem {
  id: string;
  name: string;
  provider: string;
  accessMode: string;
  config: Record<string, unknown>;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: {
    ok?: boolean;
    checks?: Array<{ status?: string }>;
    error?: string;
  } | null;
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-emerald-400",
  ERROR: "bg-ember status-pulse-red",
  DISABLED: "bg-gray-600",
};

function configText(target: StorageTargetListItem, key: string, fallback = "-"): string {
  const value = target.config?.[key];
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function lastTestSummary(target: StorageTargetListItem): string {
  const result = target.lastTestResult;
  if (!result) return "No test";
  if (result.ok) return "Passed";
  const failed = result.checks?.filter((check) => check.status === "failed").length ?? 0;
  return failed > 0 ? `${failed} failed` : "Warnings";
}

export function StorageTargetList() {
  const toast = useToast();
  const [targets, setTargets] = useState<StorageTargetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      const res = await fetch("/api/backups/storage-targets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load storage targets");
      setTargets(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load storage targets");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  async function runTest(target: StorageTargetListItem) {
    setTestingId(target.id);
    try {
      const res = await fetch(`/api/backups/storage-targets/${target.id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Storage test failed");
      if (data.ok) {
        toast.success(`${target.name} passed storage tests`);
      } else {
        toast.error(data.error || `${target.name} failed storage tests`);
      }
      fetchTargets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storage test failed");
      fetchTargets();
    } finally {
      setTestingId(null);
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/backups/storage-targets/${target.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete storage target");
      toast.success(`Storage target "${target.name}" deleted`);
      fetchTargets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete storage target");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading storage targets...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="heading-norse text-xl">Niflheim Storage</h1>
          <div className="realm-line mt-2 w-40" />
          <p className="text-text-dim text-xs tracking-wide leading-6 mt-2">
            S3 and GCS destinations for PostgreSQL backup artifacts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/backups" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            Policies
          </Link>
          <Link href="/backups/storage/new" className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase">
            New Storage Target
          </Link>
        </div>
      </div>

      {targets.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <span className="text-4xl text-gold font-cinzel block mb-3">ᚾ</span>
          <p className="text-text-dim text-sm tracking-wide">No backup storage targets have been forged.</p>
          <Link href="/backups/storage/new" className="btn-ghost mt-4 inline-block">
            Create Storage Target
          </Link>
        </div>
      ) : (
        <div className="border border-border bg-deep">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1000px]">
              <thead>
                <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                  <th scope="col" className="px-4 py-3 text-left font-normal">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Name</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Provider</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Bucket</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Region</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Folder</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Access</th>
                  <th scope="col" className="px-4 py-3 text-left font-normal">Last Test</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => (
                  <tr key={target.id} className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[target.status] ?? "bg-gray-600"}`} />
                        <span className="text-text-dim tracking-wider">{target.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/backups/storage/${target.id}`} className="text-text hover:text-gold-bright tracking-wider">
                        {target.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{target.provider.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider font-mono">{configText(target, "bucket")}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{configText(target, "region", configText(target, "location"))}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider font-mono">{configText(target, "prefix", "backups")}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">{target.accessMode.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {target.lastTestedAt ? new Date(target.lastTestedAt).toLocaleString() : "Never"}
                      <span className="block text-[0.55rem] text-text-dim/70">{lastTestSummary(target)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => runTest(target)}
                          disabled={testingId === target.id}
                          className="btn-subtle text-[0.6rem] px-2 py-1"
                        >
                          {testingId === target.id ? "Testing..." : "Test"}
                        </button>
                        <Link href={`/backups/storage/${target.id}/edit`} className="btn-subtle text-[0.6rem] px-2 py-1">
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ id: target.id, name: target.name })}
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
        title="Delete Storage Target"
        message={deleteTarget ? `Storage target "${deleteTarget.name}" will be removed unless active backup policies still reference it.` : ""}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
