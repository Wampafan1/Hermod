"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Blueprint {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  beforeSample: string | null;
  afterSample: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGES: Record<string, string> = {
  DRAFT: "bg-gold/10 text-gold border border-gold/30",
  VALIDATED: "bg-green-900/30 text-green-400 border border-green-400/30",
  ACTIVE: "bg-frost/10 text-frost border border-frost/30",
  ARCHIVED: "bg-void/50 text-text-dim border border-border",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface BlueprintListProps {
  blueprints: Blueprint[];
  onRefresh: () => void;
}

export function BlueprintList({ blueprints, onRefresh }: BlueprintListProps) {
  const router = useRouter();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function executeDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/mjolnir/blueprints/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Blueprint deleted");
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  if (blueprints.length === 0) {
    return (
      <div className="text-center py-12 bg-deep border border-border">
        <span className="text-4xl font-cinzel block mb-3 smolder" style={{ color: "rgba(255,183,77,0.3)" }}>ᛗ</span>
        <p className="text-text-dim text-sm tracking-wide">
          The forge stands cold.
        </p>
        <p className="text-text-muted text-xs tracking-wide mt-1">
          Upload BEFORE and AFTER files to forge your first blueprint.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {blueprints.map((bp) => (
        <div
          key={bp.id}
          className="bg-deep border border-border p-5 hover:bg-gold/[0.02] transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-text text-sm truncate">{bp.name}</h3>
                <span
                  className={`inline-flex items-center px-2 py-0.5 text-[0.6875rem] tracking-[0.15em] uppercase ${
                    STATUS_BADGES[bp.status] || STATUS_BADGES.DRAFT
                  }`}
                >
                  {bp.status}
                </span>
                <span className="text-text-dim/80 text-[0.625rem] tracking-wider">
                  v{bp.version}
                </span>
              </div>

              {bp.description && (
                <p className="text-text-dim text-xs tracking-wide truncate">
                  {bp.description}
                </p>
              )}

              <div className="flex items-center gap-4 text-text-dim/80 text-[0.625rem] tracking-wider">
                {bp.beforeSample && (
                  <span>{bp.beforeSample}</span>
                )}
                {bp.beforeSample && bp.afterSample && (
                  <span className="text-gold/30">-&gt;</span>
                )}
                {bp.afterSample && (
                  <span>{bp.afterSample}</span>
                )}
                <span>Updated {formatDate(bp.updatedAt)}</span>
              </div>
            </div>

            <button
              onClick={() => setDeleteTarget(bp.id)}
              className="btn-subtle text-error hover:text-error flex-shrink-0"
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Blueprint"
        message="This blueprint will be permanently removed. Any routes using it will lose their transformation. This cannot be undone."
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
