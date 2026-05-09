"use client";

import { useEffect, useMemo, useState } from "react";

export interface CandidateKey {
  columns: string[];
  unique: boolean;
  nullCount: number;
  duplicateCount: number;
  coverage: number;
  width: number;
  score: number;
}

export interface KeyDriftDetails {
  oldKey: string[];
  reason: string;
  candidateKeys?: CandidateKey[];
  recommendation?: {
    columns: string[];
    source?: "DETERMINISTIC" | "AI" | string;
    reason?: string;
    score?: number;
  } | null;
  noReliableKeyReason?: string | null;
  aiUsed?: boolean;
  aiExplanation?: string | null;
  validationStats?: {
    rowCount: number;
    columnsAnalyzed: number;
    combinationsTested: number;
    maxWidth: number;
    maxCombinations: number;
    truncated: boolean;
    destinationValidated: boolean;
    destinationValidationMode?: string;
  } | null;
  duplicateExamples?: Array<{
    keyValues: Record<string, string | number | boolean | null>;
    rowIndexes: number[];
  }>;
  nullKeyExamples?: Array<{
    rowIndex: number;
    keyValues: Record<string, string | number | boolean | null>;
    missingColumns: string[];
  }>;
}

export interface DdlPreview {
  selectedKey: string[];
  ddl: string[];
  warnings: string[];
  blocked: boolean;
  blockReason?: string | null;
  requiresConfirmation: boolean;
}

export interface KeyHardeningResolvePayload {
  action: "APPROVE_KEY_HARDENING";
  selectedKey: string[];
  confirmedDdl: string[];
  confirm: true;
}

interface KeyDriftReviewPanelProps {
  gateId: string;
  pushId: string;
  keyDrift: KeyDriftDetails;
  blankRowsSkipped: number;
  onResolved: (result: Record<string, unknown>) => void;
  onCancelled: () => void;
  onError: (message: string) => void;
}

interface ApprovalState {
  selectedKey: string[] | null;
  ddlPreview: DdlPreview | null;
  approvalChecked: boolean;
  loading: boolean;
}

export function selectDefaultCandidate(keyDrift: KeyDriftDetails): CandidateKey | null {
  const candidates = keyDrift.candidateKeys ?? [];
  if (candidates.length === 0) return null;
  const recommended = keyDrift.recommendation?.columns;
  if (recommended) {
    const match = candidates.find((candidate) => sameColumns(candidate.columns, recommended));
    if (match) return match;
  }
  return candidates[0] ?? null;
}

export function buildResolvePayload(
  selectedKey: string[],
  confirmedDdl: string[]
): KeyHardeningResolvePayload {
  return {
    action: "APPROVE_KEY_HARDENING",
    selectedKey,
    confirmedDdl,
    confirm: true,
  };
}

export function canApproveKeyHardening(state: ApprovalState): boolean {
  return Boolean(
    state.selectedKey &&
      state.selectedKey.length > 0 &&
      state.ddlPreview &&
      state.ddlPreview.ddl.length > 0 &&
      !state.ddlPreview.blocked &&
      state.approvalChecked &&
      !state.loading
  );
}

export function formatKeyDriftReason(keyDrift: KeyDriftDetails): string {
  if (keyDrift.reason) return keyDrift.reason;
  const hasDuplicates = (keyDrift.duplicateExamples?.length ?? 0) > 0;
  const hasNulls = (keyDrift.nullKeyExamples?.length ?? 0) > 0;
  if (hasDuplicates && hasNulls) return "The current key has duplicate and blank values in this upload.";
  if (hasDuplicates) return "The current key has duplicate values in this upload.";
  if (hasNulls) return "The current key has blank values in this upload.";
  return "The current UPSERT key no longer uniquely identifies rows in this upload.";
}

export function formatKeyValueMap(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${formatKeyValue(value)}`)
    .join(", ");
}

export function formatDuplicateExample(example: {
  keyValues: Record<string, unknown>;
  rowIndexes: number[];
}): string {
  return `Rows ${example.rowIndexes.join(", ")} - ${formatKeyValueMap(example.keyValues)}`;
}

export function formatNullKeyExample(example: {
  rowIndex: number;
  keyValues: Record<string, unknown>;
  missingColumns: string[];
}): string {
  return `Row ${example.rowIndex} - missing ${example.missingColumns.join(", ")} - ${formatKeyValueMap(example.keyValues)}`;
}

export function formatBlankRowsSkipped(count: number): string | null {
  if (count <= 0) return null;
  return `${count.toLocaleString()} fully blank mapped ${count === 1 ? "row was" : "rows were"} skipped and counted.`;
}

export function getNoReliableKeyMessage(keyDrift: KeyDriftDetails): string | null {
  if ((keyDrift.candidateKeys?.length ?? 0) > 0) return null;
  return keyDrift.noReliableKeyReason ?? "No reliable key was found in this upload.";
}

export function KeyDriftReviewPanel({
  gateId,
  pushId,
  keyDrift,
  blankRowsSkipped,
  onResolved,
  onCancelled,
  onError,
}: KeyDriftReviewPanelProps) {
  const defaultCandidate = useMemo(() => selectDefaultCandidate(keyDrift), [keyDrift]);
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(
    defaultCandidate?.columns ?? null
  );
  const [ddlPreview, setDdlPreview] = useState<DdlPreview | null>(null);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const noReliableKeyMessage = getNoReliableKeyMessage(keyDrift);
  const recommendedColumns = keyDrift.recommendation?.columns ?? null;

  useEffect(() => {
    setSelectedColumns(defaultCandidate?.columns ?? null);
  }, [defaultCandidate]);

  useEffect(() => {
    let ignore = false;
    setApprovalChecked(false);
    setDdlPreview(null);

    if (!selectedColumns || selectedColumns.length === 0) return;
    const previewColumns = selectedColumns;

    async function loadPreview() {
      setLoadingPreview(true);
      try {
        const query = encodeURIComponent(previewColumns.join(","));
        const res = await fetch(`/api/gates/${gateId}/push/${pushId}/resolve?selectedKey=${query}`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          if (data?.blocked || Array.isArray(data?.ddl)) {
            setDdlPreview({
              selectedKey: data.selectedKey ?? previewColumns,
              ddl: Array.isArray(data.ddl) ? data.ddl : [],
              warnings: Array.isArray(data.warnings) ? data.warnings : [],
              blocked: true,
              blockReason: data.blockReason ?? data.error ?? "This key change is blocked.",
              requiresConfirmation: true,
            });
            return;
          }
          onError(data.error || "Unable to preview destination key changes");
          return;
        }
        setDdlPreview(data as DdlPreview);
      } catch {
        if (!ignore) onError("Network error while previewing destination key changes");
      } finally {
        if (!ignore) setLoadingPreview(false);
      }
    }

    void loadPreview();
    return () => {
      ignore = true;
    };
  }, [gateId, onError, pushId, selectedColumns]);

  const canApprove = canApproveKeyHardening({
    selectedKey: selectedColumns,
    ddlPreview,
    approvalChecked,
    loading: loadingPreview || approving,
  });

  async function approve() {
    if (!selectedColumns || !ddlPreview || !canApprove) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/gates/${gateId}/push/${pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildResolvePayload(selectedColumns, ddlPreview.ddl)),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || data.blockReason || "Unable to apply hardened key");
        return;
      }
      setActionResult(data);
      onResolved(data);
    } catch {
      onError("Network error while applying hardened key");
    } finally {
      setApproving(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/gates/${gateId}/push/${pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError((data as { error?: string }).error || "Unable to cancel key review");
        return;
      }
      onCancelled();
    } catch {
      onError("Network error while cancelling key review");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="card-norse p-5 space-y-5 border-amber-700/30">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="heading-norse text-sm text-amber-400">Key Review Needed</h3>
          <span className="text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 border border-amber-700/30 text-amber-400 bg-amber-900/10">
            Key Drift
          </span>
        </div>
        <p className="text-text-dim text-xs font-inconsolata leading-6">
          Hermod found that the current UPSERT key no longer uniquely identifies rows in this upload.
          No nonblank rows have been loaded yet. Changing destination key constraints requires approval.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-inconsolata">
        <div className="border border-[rgba(201,147,58,0.08)] bg-void/30 p-3">
          <div className="label-norse text-[9px] mb-2">Current Key</div>
          <div className="text-gold break-words">{keyDrift.oldKey.join(" + ") || "Not configured"}</div>
        </div>
        <div className="border border-[rgba(201,147,58,0.08)] bg-void/30 p-3">
          <div className="label-norse text-[9px] mb-2">Reason</div>
          <div className="text-text-dim">{formatKeyDriftReason(keyDrift)}</div>
        </div>
      </div>

      {formatBlankRowsSkipped(blankRowsSkipped) && (
        <div className="border border-frost/10 bg-frost/[0.04] px-3 py-2 text-[11px] text-frost font-inconsolata">
          {formatBlankRowsSkipped(blankRowsSkipped)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExampleList
          title="Duplicate Current-Key Values"
          empty="No duplicate current-key examples were captured."
          items={(keyDrift.duplicateExamples ?? []).map(formatDuplicateExample)}
        />
        <ExampleList
          title="Blank Current-Key Values"
          empty="No blank current-key examples were captured."
          items={(keyDrift.nullKeyExamples ?? []).map(formatNullKeyExample)}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="label-norse text-[10px]">Candidate Keys</h4>
          {keyDrift.recommendation && (
            <span className="text-[9px] uppercase tracking-[0.18em] text-frost">
              {keyDrift.recommendation.source === "AI" ? "AI recommendation" : "Deterministic recommendation"}
            </span>
          )}
        </div>

        {noReliableKeyMessage ? (
          <div className="border border-amber-700/30 bg-amber-900/10 px-3 py-3 text-[11px] text-amber-400 font-inconsolata">
            {noReliableKeyMessage}
          </div>
        ) : (
          <div className="space-y-2">
            {(keyDrift.candidateKeys ?? []).map((candidate) => {
              const selected = selectedColumns ? sameColumns(candidate.columns, selectedColumns) : false;
              const recommended = recommendedColumns ? sameColumns(candidate.columns, recommendedColumns) : false;
              return (
                <label
                  key={candidate.columns.join("|")}
                  className={`block border p-3 cursor-pointer transition-colors ${
                    selected
                      ? "border-gold/40 bg-gold/[0.04]"
                      : "border-[rgba(201,147,58,0.08)] hover:border-gold/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name={`key-candidate-${pushId}`}
                      checked={selected}
                      onChange={() => setSelectedColumns(candidate.columns)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text text-xs font-inconsolata break-words">
                          {candidate.columns.join(" + ")}
                        </span>
                        {recommended && (
                          <span className="text-[8px] uppercase tracking-[0.16em] border border-frost/20 text-frost px-1.5 py-0.5">
                            Recommended
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] text-text-dim font-inconsolata">
                        <Metric label="Width" value={candidate.width} />
                        <Metric label="Coverage" value={`${Math.round(candidate.coverage * 100)}%`} />
                        <Metric label="Nulls" value={candidate.nullCount} />
                        <Metric label="Duplicates" value={candidate.duplicateCount} />
                        <Metric label="Score" value={candidate.score} />
                      </div>
                      {recommended && keyDrift.recommendation?.reason && (
                        <p className="text-[10px] text-text-dim font-inconsolata leading-5">
                          {keyDrift.recommendation.reason}
                        </p>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {keyDrift.validationStats && (
        <div className="border border-[rgba(201,147,58,0.08)] bg-void/30 p-3">
          <div className="label-norse text-[9px] mb-2">Validation Stats</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-text-dim font-inconsolata">
            <Metric label="Rows" value={keyDrift.validationStats.rowCount} />
            <Metric label="Columns" value={keyDrift.validationStats.columnsAnalyzed} />
            <Metric label="Combos" value={keyDrift.validationStats.combinationsTested} />
            <Metric
              label="Destination"
              value={keyDrift.validationStats.destinationValidated ? "Checked" : "Preview checks before DDL"}
            />
          </div>
        </div>
      )}

      {selectedColumns && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="label-norse text-[10px]">DDL Preview</h4>
            {loadingPreview && <span className="text-[10px] text-text-dim">Loading...</span>}
          </div>

          {ddlPreview?.blocked && (
            <div className="border border-ember/30 bg-ember/10 px-3 py-2 text-[11px] text-ember font-inconsolata">
              {ddlPreview.blockReason || "This key change is blocked."}
            </div>
          )}

          {(ddlPreview?.warnings ?? []).map((warning) => (
            <div
              key={warning}
              className="border border-amber-700/20 bg-amber-900/10 px-3 py-2 text-[10px] text-amber-400 font-inconsolata"
            >
              {warning}
            </div>
          ))}

          <div className="bg-void/60 border border-[rgba(201,147,58,0.08)]">
            {(ddlPreview?.ddl.length ?? 0) > 0 ? (
              ddlPreview?.ddl.map((statement) => (
                <pre
                  key={statement}
                  className="whitespace-pre-wrap break-words text-[10px] leading-5 text-frost font-inconsolata border-b last:border-b-0 border-[rgba(201,147,58,0.06)] p-3"
                >
                  {statement}
                </pre>
              ))
            ) : (
              <div className="p-3 text-[10px] text-text-dim font-inconsolata">
                {loadingPreview ? "Generating preview..." : "No DDL preview available."}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 text-[11px] text-text-dim font-inconsolata">
            <input
              type="checkbox"
              checked={approvalChecked}
              onChange={(event) => setApprovalChecked(event.target.checked)}
              disabled={!ddlPreview || ddlPreview.blocked}
              className="mt-0.5"
            />
            <span>I approve changing the destination key constraint.</span>
          </label>
        </div>
      )}

      {actionResult && actionResult.status !== "SUCCESS" && (
        <div className="border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-400 font-inconsolata">
          Reviewed push finished with status {String(actionResult.status)}.
          {typeof actionResult.errorMessage === "string" ? ` ${actionResult.errorMessage}` : ""}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={!canApprove}
          className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {approving ? "Applying..." : "Approve Key Change & Push"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={cancelling || approving}
          className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {cancelling ? "Cancelling..." : "Cancel staged upload"}
        </button>
      </div>
    </section>
  );
}

function ExampleList({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div className="border border-[rgba(201,147,58,0.08)] bg-void/30 p-3 space-y-2">
      <div className="label-norse text-[9px]">{title}</div>
      {items.length === 0 ? (
        <div className="text-[10px] text-text-dim font-inconsolata">{empty}</div>
      ) : (
        items.slice(0, 5).map((item) => (
          <div key={item} className="text-[10px] text-text-dim font-inconsolata leading-5">
            {item}
          </div>
        ))
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-text">{value}</div>
      <div className="text-text-dim uppercase tracking-[0.16em]">{label}</div>
    </div>
  );
}

function formatKeyValue(value: unknown): string {
  if (value == null || value === "") return "blank";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return String(value);
}

function sameColumns(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase());
}
