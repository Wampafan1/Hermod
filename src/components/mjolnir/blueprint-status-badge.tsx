"use client";

import type { BlueprintStatus } from "@/lib/mjolnir/blueprint-status";

export interface BlueprintOptionLike {
  id: string;
  name: string;
  status: string;
}

export interface BlueprintUsageCountsLike {
  reports?: number | null;
  bifrostRoutes?: number | null;
  total?: number | null;
}

export const BLUEPRINT_STATUS_LABELS: Record<BlueprintStatus, string> = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const BLUEPRINT_STATUS_HELPER_TEXT: Record<BlueprintStatus, string> = {
  DRAFT: "Validate before attaching",
  VALIDATED: "Ready to attach",
  ACTIVE: "Production-ready",
  ARCHIVED: "Not attachable",
};

const BLUEPRINT_STATUS_CLASSES: Record<BlueprintStatus, string> = {
  DRAFT: "border-gold/30 bg-gold/10 text-gold",
  VALIDATED: "border-green-400/30 bg-green-900/30 text-green-400",
  ACTIVE: "border-frost/30 bg-frost/10 text-frost",
  ARCHIVED: "border-border bg-void/50 text-text-dim",
};

export function isKnownBlueprintStatus(status: string): status is BlueprintStatus {
  return status === "DRAFT" || status === "VALIDATED" || status === "ACTIVE" || status === "ARCHIVED";
}

export function isAttachableBlueprintStatus(status: string): boolean {
  return status === "VALIDATED" || status === "ACTIVE";
}

export function getBlueprintStatusLabel(status: string): string {
  return isKnownBlueprintStatus(status) ? BLUEPRINT_STATUS_LABELS[status] : status;
}

export function getBlueprintStatusHelperText(status: string): string {
  return isKnownBlueprintStatus(status) ? BLUEPRINT_STATUS_HELPER_TEXT[status] : "Unknown status";
}

export function getBlueprintStatusBadgeClasses(status: string): string {
  return isKnownBlueprintStatus(status)
    ? BLUEPRINT_STATUS_CLASSES[status]
    : "border-border bg-void/50 text-text-dim";
}

export function blueprintOptionLabel(blueprint: BlueprintOptionLike): string {
  return `${blueprint.name} (${blueprint.status})`;
}

export function filterAttachableBlueprintOptions<T extends BlueprintOptionLike>(
  blueprints: T[],
  currentBlueprintId?: string | null
): T[] {
  return blueprints.filter((blueprint) =>
    isAttachableBlueprintStatus(blueprint.status) && blueprint.id !== currentBlueprintId
  );
}

export function findLegacyCurrentBlueprint<T extends BlueprintOptionLike>(
  blueprints: T[],
  currentBlueprintId?: string | null
): T | null {
  if (!currentBlueprintId) return null;
  const current = blueprints.find((blueprint) => blueprint.id === currentBlueprintId);
  return current && !isAttachableBlueprintStatus(current.status) ? current : null;
}

export function legacyCurrentBlueprintLabel(blueprint: BlueprintOptionLike): string {
  return `Current legacy blueprint: ${blueprint.name} (${blueprint.status})`;
}

export function usageSummaryText(usage?: BlueprintUsageCountsLike): string {
  const reports = usage?.reports ?? 0;
  const routes = usage?.bifrostRoutes ?? 0;
  if (reports === 0 && routes === 0) return "Not attached";

  const parts: string[] = [];
  if (reports > 0) parts.push(`${reports} report${reports === 1 ? "" : "s"}`);
  if (routes > 0) parts.push(`${routes} route${routes === 1 ? "" : "s"}`);
  return `Used by ${parts.join(", ")}`;
}

export function BlueprintStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-[0.6875rem] tracking-[0.15em] uppercase ${getBlueprintStatusBadgeClasses(status)}`}
      title={getBlueprintStatusHelperText(status)}
    >
      {getBlueprintStatusLabel(status)}
    </span>
  );
}

export function BlueprintScopeBadge({ label = "Personal" }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center border border-border bg-void/40 px-2 py-0.5 text-[0.625rem] tracking-[0.15em] uppercase text-text-dim"
      title="Personal user-owned blueprint under the current ownership model"
    >
      {label}
    </span>
  );
}
