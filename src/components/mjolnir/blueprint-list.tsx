"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

interface BlueprintUsageCounts {
  reports: number;
  bifrostRoutes: number;
  total: number;
}

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
  usage?: BlueprintUsageCounts;
}

interface BlueprintUsageItem {
  id: string;
  type: "report" | "bifrost_route";
  name: string;
  tenantId: string | null;
  tenantName?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  updatedAt?: string | Date | null;
}

interface BlueprintUsageSummary {
  blueprintId: string;
  total: number;
  reports: BlueprintUsageItem[];
  bifrostRoutes: BlueprintUsageItem[];
}

interface DeleteTarget {
  blueprint: Blueprint;
  usage: BlueprintUsageSummary;
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

function usageSummaryText(usage?: BlueprintUsageCounts): string {
  const reports = usage?.reports ?? 0;
  const routes = usage?.bifrostRoutes ?? 0;
  if (reports === 0 && routes === 0) return "Not attached";

  const parts: string[] = [];
  if (reports > 0) {
    parts.push(`${reports} report${reports === 1 ? "" : "s"}`);
  }
  if (routes > 0) {
    parts.push(`${routes} route${routes === 1 ? "" : "s"}`);
  }
  return `Used by ${parts.join(", ")}`;
}

function usageItemLabel(item: BlueprintUsageItem): string {
  const pieces = [
    item.tenantName || item.tenantId,
    item.enabled === null || item.enabled === undefined
      ? null
      : item.enabled
      ? "enabled"
      : "disabled",
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join(" - ") : "No tenant context";
}

function statusHint(status: string): string | null {
  switch (status) {
    case "DRAFT":
      return "Validate before attaching";
    case "ACTIVE":
      return "Production-ready";
    case "ARCHIVED":
      return "Archived blueprints cannot be newly attached";
    default:
      return null;
  }
}

interface BlueprintListProps {
  blueprints: Blueprint[];
  onRefresh: () => void;
}

export function BlueprintList({ blueprints, onRefresh }: BlueprintListProps) {
  const router = useRouter();
  const toast = useToast();
  const usageDialogRef = useRef<HTMLDivElement>(null);
  const usageDialogTitleId = useId();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [usageTarget, setUsageTarget] = useState<DeleteTarget | null>(null);
  const [loadingBlueprintId, setLoadingBlueprintId] = useState<string | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);

  useFocusTrap(usageDialogRef, !!usageTarget, () => {
    if (!dialogLoading) setUsageTarget(null);
  });

  async function fetchUsage(blueprintId: string): Promise<BlueprintUsageSummary> {
    const res = await fetch(`/api/mjolnir/blueprints/${blueprintId}/usage`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Usage lookup failed");
    }
    return data;
  }

  async function beginDelete(blueprint: Blueprint) {
    setLoadingBlueprintId(blueprint.id);
    try {
      const usage = await fetchUsage(blueprint.id);
      if (usage.total > 0) {
        setUsageTarget({ blueprint, usage });
        return;
      }
      setDeleteTarget({ blueprint, usage });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Usage lookup failed");
    } finally {
      setLoadingBlueprintId(null);
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const { blueprint } = deleteTarget;
    setDialogLoading(true);
    try {
      const res = await fetch(`/api/mjolnir/blueprints/${blueprint.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.usage) {
          setDeleteTarget(null);
          setUsageTarget({ blueprint, usage: data.usage });
          return;
        }
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Blueprint deleted");
      setDeleteTarget(null);
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setDialogLoading(false);
    }
  }

  async function archiveBlueprint(blueprint: Blueprint) {
    setDialogLoading(true);
    setLoadingBlueprintId(blueprint.id);
    try {
      const res = await fetch(`/api/mjolnir/blueprints/${blueprint.id}/archive`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Archive failed");
        return;
      }
      toast.success("Blueprint archived");
      setUsageTarget(null);
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setDialogLoading(false);
      setLoadingBlueprintId(null);
    }
  }

  async function activateBlueprint(blueprint: Blueprint) {
    setLoadingBlueprintId(blueprint.id);
    try {
      const res = await fetch(`/api/mjolnir/blueprints/${blueprint.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Activation failed");
        return;
      }
      toast.success("Blueprint activated");
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setLoadingBlueprintId(null);
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
      {blueprints.map((bp) => {
        const rowLoading = loadingBlueprintId === bp.id;
        const isArchived = bp.status === "ARCHIVED";
        const hint = statusHint(bp.status);

        return (
          <div
            key={bp.id}
            className={`bg-deep border border-border p-5 hover:bg-gold/[0.02] transition-colors ${
              isArchived ? "opacity-70" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
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

                {hint && (
                  <p className={`text-[0.625rem] tracking-wider ${
                    bp.status === "ACTIVE"
                      ? "text-frost"
                      : bp.status === "DRAFT"
                      ? "text-gold"
                      : "text-text-dim"
                  }`}>
                    {hint}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-4 text-text-dim/80 text-[0.625rem] tracking-wider">
                  {bp.beforeSample && (
                    <span>{bp.beforeSample}</span>
                  )}
                  {bp.beforeSample && bp.afterSample && (
                    <span className="text-gold/30">-&gt;</span>
                  )}
                  {bp.afterSample && (
                    <span>{bp.afterSample}</span>
                  )}
                  <span>{usageSummaryText(bp.usage)}</span>
                  <span>Updated {formatDate(bp.updatedAt)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {bp.status === "VALIDATED" && (
                  <button
                    onClick={() => activateBlueprint(bp)}
                    disabled={rowLoading || dialogLoading}
                    className="btn-primary text-xs"
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => archiveBlueprint(bp)}
                  disabled={rowLoading || dialogLoading || isArchived}
                  className={`btn-ghost text-xs ${isArchived ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  Archive
                </button>
                <button
                  onClick={() => beginDelete(bp)}
                  disabled={rowLoading || dialogLoading}
                  className="btn-subtle text-error hover:text-error"
                >
                  {rowLoading ? "Checking..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Blueprint"
        message="This blueprint is not attached to any reports or routes. It will be permanently removed and cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={dialogLoading}
        onConfirm={executeDelete}
        onCancel={() => !dialogLoading && setDeleteTarget(null)}
      />

      {usageTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !dialogLoading && setUsageTarget(null)}
        >
          <div
            ref={usageDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={usageDialogTitleId}
            className="bg-deep border border-border max-w-2xl w-full mx-4 animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border">
              <h2 id={usageDialogTitleId} className="heading-norse text-sm">
                Blueprint In Use
              </h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-text-dim text-xs tracking-wide leading-relaxed">
                This blueprint is attached to the reports and routes below. Archiving
                prevents new attachments but does not remove this blueprint from existing
                reports/routes.
              </p>

              {usageTarget.usage.reports.length > 0 && (
                <div className="space-y-2">
                  <p className="label-norse">Reports</p>
                  <div className="border border-border bg-void/40 divide-y divide-border">
                    {usageTarget.usage.reports.map((item) => (
                      <div key={item.id} className="px-3 py-2">
                        <p className="text-text text-xs tracking-wide">{item.name}</p>
                        <p className="text-text-dim/80 text-[0.625rem] tracking-wider mt-1">
                          {usageItemLabel(item)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {usageTarget.usage.bifrostRoutes.length > 0 && (
                <div className="space-y-2">
                  <p className="label-norse">Bifrost Routes</p>
                  <div className="border border-border bg-void/40 divide-y divide-border">
                    {usageTarget.usage.bifrostRoutes.map((item) => (
                      <div key={item.id} className="px-3 py-2">
                        <p className="text-text text-xs tracking-wide">{item.name}</p>
                        <p className="text-text-dim/80 text-[0.625rem] tracking-wider mt-1">
                          {usageItemLabel(item)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
              <button
                onClick={() => setUsageTarget(null)}
                disabled={dialogLoading}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => archiveBlueprint(usageTarget.blueprint)}
                disabled={dialogLoading || usageTarget.blueprint.status === "ARCHIVED"}
                className={`btn-primary text-xs ${usageTarget.blueprint.status === "ARCHIVED" ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {dialogLoading ? "Archiving..." : usageTarget.blueprint.status === "ARCHIVED" ? "Archived" : "Archive Blueprint"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
