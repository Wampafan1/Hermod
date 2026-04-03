"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/toast";
import { BlueprintDiffModal } from "./blueprint-diff-modal";
import { BlueprintRollbackDialog } from "./blueprint-rollback-dialog";

interface VersionSummary {
  id: string;
  version: number;
  source: string;
  changeReason: string | null;
  changeSummary: unknown;
  aiConfidence: number | null;
  createdAt: string;
  createdBy: string | null;
  stepsCount: number;
  executionCount: number;
  lastExecutedAt: string | null;
  isLocked: boolean;
}

interface BlueprintData {
  id: string;
  routeId: string;
  name: string;
  currentVersion: number;
  status: string;
  versions: VersionSummary[];
}

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  FORGE:       { label: "Forge (AI)", color: "#ffb74d" },
  MANUAL_EDIT: { label: "Manual Edit", color: "#42a5f5" },
  ROLLBACK:    { label: "Rollback", color: "#ce93d8" },
  IMPORT:      { label: "Import", color: "#80cbc4" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  routeId: string;
}

export function BlueprintVersionHistory({ routeId }: Props) {
  const toast = useToast();
  const [data, setData] = useState<BlueprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);
  const [locking, setLocking] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/blueprints/${routeId}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleLock(v: VersionSummary) {
    setLocking(v.id);
    try {
      const res = await fetch(`/api/blueprints/${routeId}/versions/${v.version}`, { method: "POST" });
      if (res.ok) {
        toast.success(`Version ${v.version} locked`);
        fetchData();
      } else {
        const body = await res.json();
        toast.error(body.error || "Failed to lock");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLocking(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-deep border border-border p-5">
        <div className="h-4 w-48 bg-scroll animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <div className="bg-deep border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="label-norse !mb-0 text-gold">Blueprint Version History</h3>
            <p className="text-text-muted text-[10px] font-inconsolata mt-0.5">
              Currently running: Version {data.currentVersion}
            </p>
          </div>
          <button onClick={() => setCollapsed(!collapsed)} className="btn-subtle text-[10px]">
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>

        {/* Version list */}
        {!collapsed && (
          <div className="divide-y divide-border/50">
            {data.versions.map((v, i) => {
              const isCurrent = v.version === data.currentVersion;
              const badge = SOURCE_BADGE[v.source] ?? SOURCE_BADGE.FORGE;
              const prevVersion = data.versions[i + 1]?.version;

              return (
                <div
                  key={v.id}
                  className={`px-5 py-4 ${isCurrent ? "bg-gold-dim/30" : ""}`}
                >
                  {/* Version header */}
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-cinzel text-sm text-text">
                      v{v.version}
                    </span>
                    {isCurrent && (
                      <span className="w-2 h-2 bg-gold animate-pip-pulse" />
                    )}
                    {v.isLocked && (
                      <span className="text-frost text-[10px]" title="Locked">&#x25A3;</span>
                    )}
                    <span
                      className="text-[9px] font-space-grotesk tracking-wider uppercase px-1.5 py-0.5 border"
                      style={{ color: badge.color, borderColor: `${badge.color}40` }}
                    >
                      {badge.label}
                    </span>
                    <span className="text-text-muted text-[10px] font-inconsolata ml-auto">
                      {new Date(v.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  {/* Change reason */}
                  {v.changeReason && (
                    <p className="text-text-dim text-xs font-source-serif italic mb-1.5 ml-0.5">
                      &ldquo;{v.changeReason}&rdquo;
                    </p>
                  )}

                  {/* Stats */}
                  <p className="text-text-muted text-[10px] font-inconsolata mb-2">
                    {v.stepsCount} steps · {v.executionCount} runs
                    {v.lastExecutedAt && <> · Last: {relativeTime(v.lastExecutedAt)}</>}
                    {v.executionCount > 0 && ` · ${v.executionCount} run${v.executionCount !== 1 ? "s" : ""}`}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {prevVersion !== undefined && (
                      <button
                        onClick={() => { setDiffFrom(prevVersion); setDiffTo(v.version); }}
                        className="btn-subtle text-[10px]"
                      >
                        Diff from v{prevVersion}
                      </button>
                    )}
                    {!isCurrent && !v.isLocked && (
                      <button
                        onClick={() => setRollbackTarget(v.version)}
                        className="btn-subtle text-[10px]"
                      >
                        Rollback
                      </button>
                    )}
                    {!v.isLocked && (
                      <button
                        onClick={() => handleLock(v)}
                        disabled={locking === v.id}
                        className="btn-subtle text-[10px] text-frost"
                      >
                        {locking === v.id ? "..." : "Lock"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Diff modal */}
      {diffFrom !== null && diffTo !== null && (
        <BlueprintDiffModal
          routeId={routeId}
          fromVersion={diffFrom}
          toVersion={diffTo}
          onClose={() => { setDiffFrom(null); setDiffTo(null); }}
        />
      )}

      {/* Rollback dialog */}
      {rollbackTarget !== null && (
        <BlueprintRollbackDialog
          routeId={routeId}
          targetVersion={rollbackTarget}
          currentVersion={data.currentVersion}
          onClose={() => setRollbackTarget(null)}
          onRolledBack={() => {
            setRollbackTarget(null);
            fetchData();
          }}
        />
      )}
    </>
  );
}
