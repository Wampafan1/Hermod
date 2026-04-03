"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { PayloadTable } from "./payload-table";

const ERROR_TYPE_STYLE: Record<string, { border: string; text: string; label: string }> = {
  load_failure:      { border: "border-error/30", text: "text-error", label: "LOAD" },
  transform_failure: { border: "border-warning/30", text: "text-warning", label: "TRANSFORM" },
  auth_failure:      { border: "border-realm-alfheim/30", text: "text-realm-alfheim", label: "AUTH" },
  timeout:           { border: "border-frost/30", text: "text-frost", label: "TIMEOUT" },
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: "bg-warning-dim", text: "text-warning", label: "PENDING" },
  retrying:  { bg: "bg-warning-dim", text: "text-warning", label: "RETRYING" },
  recovered: { bg: "bg-success-dim", text: "text-success", label: "RECOVERED" },
  dead:      { bg: "bg-error-dim", text: "text-error", label: "DEAD" },
};

interface EntryDetail {
  id: string;
  routeId: string;
  routeName: string;
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  errorType: string;
  errorMessage: string;
  errorDetails: Record<string, unknown> | null;
  retryCount: number;
  maxRetries: number;
  status: string;
  createdAt: string;
  lastRetriedAt: string | null;
  nextRetryAt: string | null;
  payloadPreview: Record<string, unknown>[];
  totalRows: number;
}

interface Props {
  selectedId: string | null;
  onActionComplete: () => void;
}

export function EntryDetail({ selectedId, onActionComplete }: Props) {
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setShowDetails(false);
    setConfirmKill(false);
    fetch(`/api/bifrost/helheim/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setDetail(data))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function handleRetry() {
    if (!detail) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/bifrost/helheim/${detail.id}/retry`, {
        method: "POST",
      });
      const body = await res.json();
      if (res.ok && body.status === "recovered") {
        toast.success(`Entry recovered — ${body.rowsLoaded} rows loaded`);
      } else {
        toast.error(body.error || "Retry failed");
      }
      onActionComplete();
    } catch {
      toast.error("Network error during retry");
    } finally {
      setRetrying(false);
    }
  }

  async function handleKill() {
    if (!detail) return;
    try {
      const res = await fetch(`/api/bifrost/helheim/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill" }),
      });
      if (res.ok) {
        toast.success("Entry marked as dead");
      } else {
        const body = await res.json();
        toast.error(body.error || "Failed to kill entry");
      }
      setConfirmKill(false);
      onActionComplete();
    } catch {
      toast.error("Network error");
    }
  }

  if (!selectedId) {
    return (
      <div className="bg-deep border border-border h-full flex items-center justify-center p-6">
        <p className="text-text-muted text-xs tracking-wide text-center">
          <span className="block text-2xl font-cinzel text-gold-dim mb-2">ᛞ</span>
          Select an entry to view details
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-deep border border-border h-full p-6 space-y-4">
        <div className="h-6 w-24 bg-scroll animate-pulse" />
        <div className="h-4 w-48 bg-scroll animate-pulse" />
        <div className="h-32 bg-scroll animate-pulse" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="bg-deep border border-border h-full flex items-center justify-center p-6">
        <p className="text-text-muted text-xs">Entry not found</p>
      </div>
    );
  }

  const statusStyle = STATUS_STYLE[detail.status] ?? STATUS_STYLE.pending;
  const errorStyle = ERROR_TYPE_STYLE[detail.errorType] ?? ERROR_TYPE_STYLE.load_failure;
  const isPending = detail.status === "pending" || detail.status === "retrying";
  const isDead = detail.status === "dead";
  const isRecovered = detail.status === "recovered";

  return (
    <div className="bg-deep border border-border h-full overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Header */}
        <div>
          <span
            className={`inline-block px-3 py-1 text-[10px] font-space-grotesk tracking-widest uppercase font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.text === "text-warning" ? "border-warning/30" : statusStyle.text === "text-success" ? "border-success/30" : "border-error/30"}`}
          >
            {statusStyle.label}
          </span>

          <div className="mt-3 space-y-1">
            <p className="text-sm">
              <span className="text-text-dim text-[10px] font-space-grotesk tracking-wider uppercase mr-2">
                Route
              </span>
              <Link
                href={`/bifrost/${detail.routeId}`}
                className="font-cinzel text-text hover:text-gold transition-colors"
              >
                {detail.routeName}
              </Link>
            </p>
            <p className="text-[10px] font-inconsolata text-text-muted">
              ID: {detail.id}
            </p>
            <p className="text-[10px] font-inconsolata text-text-muted">
              Created: {new Date(detail.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Error Section */}
        <div>
          <p className="label-norse !text-gold !mb-2">Error</p>
          <span
            className={`inline-block px-2 py-0.5 text-[8px] font-inconsolata tracking-widest uppercase border ${errorStyle.border} ${errorStyle.text} mb-2`}
          >
            {errorStyle.label}
          </span>
          <div className="bg-void border border-error/15 p-3 font-inconsolata text-xs text-error whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
            {detail.errorMessage}
          </div>

          {detail.errorDetails && (
            <div className="mt-2">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="btn-subtle text-[10px]"
              >
                {showDetails ? "Hide Details" : "Show Details"}
              </button>
              {showDetails && (
                <div className="mt-2 bg-void border border-border p-3 font-inconsolata text-[10px] text-text-dim whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                  {JSON.stringify(detail.errorDetails, null, 2)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Retry History */}
        <div>
          <p className="label-norse !text-gold !mb-2">Retry History</p>
          <p className="text-xs font-inconsolata text-text-dim">
            Retry {detail.retryCount} of {detail.maxRetries}
          </p>
          <p className="text-[10px] font-inconsolata text-text-muted mt-0.5">
            Last retry:{" "}
            {detail.lastRetriedAt
              ? new Date(detail.lastRetriedAt).toLocaleString()
              : "Not yet retried"}
          </p>
          {detail.nextRetryAt && isPending && (
            <p className="text-[10px] font-inconsolata text-text-muted mt-0.5">
              Next retry: {new Date(detail.nextRetryAt).toLocaleString()}
            </p>
          )}

          {/* Retry progress boxes */}
          <div className="flex gap-1.5 mt-2">
            {Array.from({ length: detail.maxRetries }).map((_, i) => {
              const filled = i < detail.retryCount;
              const isDeadBox = isDead && filled;
              return (
                <div
                  key={i}
                  className={`w-5 h-5 border ${
                    isDeadBox
                      ? "bg-error/20 border-error/40"
                      : filled
                        ? "bg-ember/20 border-ember/40"
                        : "border-border bg-transparent"
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Payload Preview */}
        <div>
          <p className="label-norse !text-gold !mb-2">Payload Preview</p>
          <PayloadTable
            rows={detail.payloadPreview}
            totalRows={detail.totalRows}
          />
        </div>

        {/* Actions */}
        <div className="pt-2 border-t border-border">
          {isRecovered ? (
            <p className="text-success text-xs font-inconsolata tracking-wide">
              This entry was successfully recovered
            </p>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="btn-primary text-xs"
              >
                <span>{retrying ? "Retrying..." : "Retry Now"}</span>
              </button>

              {isPending && !confirmKill && (
                <button
                  onClick={() => setConfirmKill(true)}
                  className="btn-danger text-xs"
                >
                  Mark Dead
                </button>
              )}
            </div>
          )}

          {/* Kill confirmation */}
          {confirmKill && (
            <div className="mt-3 p-3 bg-void border border-error/20">
              <p className="text-xs text-text-dim mb-3">
                This will stop all retry attempts. The payload data will be
                preserved but no further delivery attempts will be made.
              </p>
              <div className="flex gap-2">
                <button onClick={handleKill} className="btn-danger text-xs">
                  Confirm Kill
                </button>
                <button
                  onClick={() => setConfirmKill(false)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
