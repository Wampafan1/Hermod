"use client";

import { useState, useRef, useId } from "react";
import { useToast } from "@/components/toast";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

interface Props {
  routeId: string;
  targetVersion: number;
  currentVersion: number;
  onClose: () => void;
  onRolledBack: () => void;
}

export function BlueprintRollbackDialog({
  routeId,
  targetVersion,
  currentVersion,
  onClose,
  onRolledBack,
}: Props) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, true, onClose);

  async function handleRollback() {
    setLoading(true);
    try {
      const res = await fetch(`/api/blueprints/${routeId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetVersion,
          reason: reason.trim() || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Rolled back to v${targetVersion} — created v${data.version}`);
        onRolledBack();
      } else {
        const body = await res.json().catch(() => ({ error: "Rollback failed" }));
        toast.error(body.error || "Rollback failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

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
        className="bg-deep border border-border-mid max-w-sm w-full mx-4 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 id={titleId} className="heading-norse text-sm flex items-center gap-2">
            <span className="text-gold">&#x2692;</span>
            Rollback to Version {targetVersion}
          </h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-text-dim text-xs tracking-wide leading-relaxed">
            This creates a new version (v{currentVersion + 1}) with the same steps as v{targetVersion}.
            The current version is preserved in history.
          </p>
          <p className="text-text-muted text-[10px] font-inconsolata">
            Nothing is deleted. You can always roll forward again.
          </p>

          <div>
            <label className="label-norse">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Currency conversion step broke EUR invoices"
              className="input-norse text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={loading} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={handleRollback}
            disabled={loading}
            className="btn-primary text-xs"
          >
            <span>{loading ? "Rolling back..." : `Rollback to v${targetVersion}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
