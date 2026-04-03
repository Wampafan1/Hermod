"use client";

import { useState, useEffect, useRef, useId } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

interface StepDiff {
  stepId: string;
  status: "added" | "removed" | "modified" | "unchanged";
  oldStep?: { type: string; order: number; description: string; config: Record<string, unknown> };
  newStep?: { type: string; order: number; description: string; config: Record<string, unknown> };
  changes?: { field: string; from: unknown; to: unknown }[];
}

interface DiffData {
  from: number;
  to: number;
  changeSummary: {
    added: unknown[];
    removed: unknown[];
    modified: unknown[];
    reordered: boolean;
    totalChanges: number;
  };
  stepByStepDiff: StepDiff[];
}

const STATUS_STYLE: Record<string, { bg: string; border: string; label: string }> = {
  added:     { bg: "bg-success-dim/30", border: "border-l-success", label: "NEW" },
  removed:   { bg: "bg-error-dim/30", border: "border-l-error", label: "REMOVED" },
  modified:  { bg: "bg-warning-dim/30", border: "border-l-warning", label: "MODIFIED" },
  unchanged: { bg: "", border: "border-l-transparent", label: "" },
};

interface Props {
  routeId: string;
  fromVersion: number;
  toVersion: number;
  onClose: () => void;
}

export function BlueprintDiffModal({ routeId, fromVersion, toVersion, onClose }: Props) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, true, onClose);

  useEffect(() => {
    fetch(`/api/blueprints/${routeId}/diff/${fromVersion}/${toVersion}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [routeId, fromVersion, toVersion]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep border border-border-mid max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 id={titleId} className="heading-norse text-sm">
              v{fromVersion} &rarr; v{toVersion}
            </h2>
            {data && (
              <p className="text-text-muted text-[10px] font-inconsolata mt-0.5">
                {data.changeSummary.totalChanges} change{data.changeSummary.totalChanges !== 1 ? "s" : ""}:
                {data.changeSummary.added.length > 0 && ` +${data.changeSummary.added.length} added`}
                {data.changeSummary.removed.length > 0 && ` -${data.changeSummary.removed.length} removed`}
                {data.changeSummary.modified.length > 0 && ` ~${data.changeSummary.modified.length} modified`}
                {data.changeSummary.reordered && " (reordered)"}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-subtle text-xs">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-scroll animate-pulse" />
              ))}
            </div>
          ) : !data ? (
            <p className="text-text-muted text-xs">Failed to load diff</p>
          ) : (
            <div className="space-y-2">
              {data.stepByStepDiff.map((step) => {
                const style = STATUS_STYLE[step.status];
                const displayStep = step.newStep || step.oldStep;
                if (!displayStep) return null;

                return (
                  <div
                    key={step.stepId}
                    className={`border-l-2 ${style.border} ${style.bg} p-3 ${step.status === "unchanged" ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-space-grotesk tracking-wider uppercase text-text-dim">
                        Step {displayStep.order}: {displayStep.type}
                      </span>
                      {style.label && (
                        <span className="text-[8px] font-space-grotesk tracking-widest uppercase text-gold px-1 border border-gold/30">
                          {style.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-dim font-source-serif italic">
                      {displayStep.description}
                    </p>

                    {/* Show changes for modified steps */}
                    {step.status === "modified" && step.changes && step.changes.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {step.changes.map((change, ci) => (
                          <div key={ci} className="font-inconsolata text-[10px]">
                            <span className="text-text-muted">{change.field}: </span>
                            <span className="text-error line-through mr-1">
                              {JSON.stringify(change.from)}
                            </span>
                            <span className="text-success">
                              {JSON.stringify(change.to)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Show config for added/removed */}
                    {(step.status === "added" || step.status === "removed") && (
                      <pre className="mt-1 font-inconsolata text-[9px] text-text-muted whitespace-pre-wrap">
                        {JSON.stringify(displayStep.config, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
