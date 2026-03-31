"use client";

import { useId, useRef } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, open, onCancel);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
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
          <h2 id={titleId} className="heading-norse text-sm">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-text-dim text-xs tracking-wide leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
          <button onClick={onCancel} disabled={loading} className="btn-ghost text-xs">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`${confirmVariant === "primary" ? "btn-primary" : "btn-danger"} text-xs`}
          >
            {loading ? `${confirmLabel}...` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
