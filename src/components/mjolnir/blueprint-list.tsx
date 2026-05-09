"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import {
  BlueprintScopeBadge,
  BlueprintStatusBadge,
  getBlueprintStatusHelperText,
  isAttachableBlueprintStatus,
  usageSummaryText,
} from "@/components/mjolnir/blueprint-status-badge";

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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function rowStatusHint(status: string): string {
  if (isAttachableBlueprintStatus(status)) {
    return `Attachable - ${getBlueprintStatusHelperText(status)}`;
  }
  return getBlueprintStatusHelperText(status);
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
  const [expandedUsage, setExpandedUsage] = useState<Record<string, boolean>>({});
  const [usageDetails, setUsageDetails] = useState<Record<string, BlueprintUsageSummary>>({});
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

  async function toggleUsage(blueprint: Blueprint) {
    if (expandedUsage[blueprint.id]) {
      setExpandedUsage((current) => ({ ...current, [blueprint.id]: false }));
      return;
    }

    setLoadingBlueprintId(blueprint.id);
    try {
      const usage = usageDetails[blueprint.id] ?? await fetchUsage(blueprint.id);
      setUsageDetails((current) => ({ ...current, [blueprint.id]: usage }));
      setExpandedUsage((current) => ({ ...current, [blueprint.id]: true }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Usage lookup failed");
    } finally {
      setLoadingBlueprintId(null);
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
        const hint = rowStatusHint(bp.status);
        const expanded = expandedUsage[bp.id];
        const detailedUsage = usageDetails[bp.id];

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
                  <BlueprintStatusBadge status={bp.status} />
                  <BlueprintScopeBadge />
                  <span className="text-text-dim/80 text-[0.625rem] tracking-wider">
                    v{bp.version}
                  </span>
                </div>

                {bp.description && (
                  <p className="text-text-dim text-xs tracking-wide truncate">
                    {bp.description}
                  </p>
                )}

                <p className={`text-[0.625rem] tracking-wider ${
                    isAttachableBlueprintStatus(bp.status)
                      ? "text-frost"
                      : bp.status === "DRAFT"
                      ? "text-gold"
                      : "text-text-dim"
                  }`}>
                    {hint}
                </p>

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
                <button
                  onClick={() => toggleUsage(bp)}
                  disabled={rowLoading || dialogLoading}
                  className="btn-ghost text-xs"
                >
                  {expanded ? "Hide Used By" : rowLoading ? "Loading..." : "Used By"}
                </button>
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

            {expanded && detailedUsage && (
              <div className="mt-4 border border-border bg-void/40 p-3">
                <p className="label-norse mb-2">Used By</p>
                {detailedUsage.total === 0 ? (
                  <p className="text-text-dim text-xs tracking-wide">
                    This blueprint is not currently attached to any reports or Bifrost routes.
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {detailedUsage.reports.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-gold text-[0.625rem] tracking-[0.25em] uppercase">Reports</p>
                        <div className="divide-y divide-border border border-border">
                          {detailedUsage.reports.map((item) => (
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

                    {detailedUsage.bifrostRoutes.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-frost text-[0.625rem] tracking-[0.25em] uppercase">Bifrost Routes</p>
                        <div className="divide-y divide-border border border-border">
                          {detailedUsage.bifrostRoutes.map((item) => (
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
                )}
              </div>
            )}
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
                {usageTarget.usage.total > 0
                  ? "This blueprint is attached to the reports and routes below. Archiving prevents new attachments but does not remove this blueprint from existing reports/routes."
                  : "This blueprint is not currently attached to any reports or Bifrost routes."}
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
              {usageTarget.usage.total > 0 && (
                <button
                  onClick={() => archiveBlueprint(usageTarget.blueprint)}
                  disabled={dialogLoading || usageTarget.blueprint.status === "ARCHIVED"}
                  className={`btn-primary text-xs ${usageTarget.blueprint.status === "ARCHIVED" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {dialogLoading ? "Archiving..." : usageTarget.blueprint.status === "ARCHIVED" ? "Archived" : "Archive Blueprint"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
