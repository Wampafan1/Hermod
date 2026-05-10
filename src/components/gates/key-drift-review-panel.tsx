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
  source?: "UCC" | string;
  quality?: unknown;
  requiresReview?: boolean;
  reviewReason?: "KEY_HAS_NULLS" | string;
}

export interface MappedKeyColumn {
  name: string;
  sourceColumn?: string;
  destinationColumn: string;
  nonBlankCount: number;
  nullCount: number;
  distinctCount: number;
  isCurrentKey?: boolean;
  isDiscriminator?: boolean;
}

export interface ManualKeyValidation {
  ok: boolean;
  nullCount: number;
  duplicateCount: number;
  duplicateExamples: Array<{
    keyValues: Record<string, string | number | boolean | null>;
    rowIndexes: number[];
  }>;
  nullKeyExamples: Array<{
    rowIndex: number;
    keyValues: Record<string, string | number | boolean | null>;
    missingColumns: string[];
  }>;
}

export interface KeyDriftDetails {
  oldKey: string[];
  driftType?: "DUPLICATE_KEY" | "BLANK_KEY" | "DUPLICATE_AND_BLANK_KEY";
  currentKeyStillUniqueForBusinessRows?: boolean;
  requiresIncompleteRowApproval?: boolean;
  incompleteRowsHeld?: number;
  incompleteRowExamples?: ManualKeyValidation["nullKeyExamples"];
  recommendedAction?: "REVIEW_INCOMPLETE_ROWS" | "HARDEN_KEY";
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
    inputRowCount?: number;
    blankRowsSkipped?: number;
    columnsAnalyzed: number;
    combinationsTested: number;
    maxWidth: number;
    maxColumns?: number;
    maxCombinations: number;
    truncated: boolean;
    destinationValidated: boolean;
    destinationValidationMode?: string;
    discoveryMode?: "QUICK" | "DUPLICATE_DISCRIMINATOR" | "THOROUGH" | "CAPPED" | "UCC";
    searchExhaustive?: boolean;
    columnsConsidered?: string[];
    columnsExcluded?: Array<{ column: string; reason: string }>;
    discriminatorColumns?: Array<{
      column: string;
      duplicateGroupsSeparated: number;
      nullCount: number;
      distinctCount: number;
    }>;
    currentKeyDuplicateGroupCount?: number;
    candidateSearchLimits?: {
      maxWidth: number;
      maxColumns: number;
      maxCombinations: number;
      combinationsTested: number;
    };
  } | null;
  discoveryMode?: "QUICK" | "DUPLICATE_DISCRIMINATOR" | "THOROUGH" | "CAPPED" | "UCC";
  searchExhaustive?: boolean;
  columnsConsidered?: string[];
  columnsExcluded?: Array<{ column: string; reason: string }>;
  discriminatorColumns?: Array<{
    column: string;
    duplicateGroupsSeparated: number;
    nullCount: number;
    distinctCount: number;
  }>;
  currentKeyDuplicateGroupCount?: number;
  candidateSearchLimits?: {
    maxWidth: number;
    maxColumns: number;
    maxCombinations: number;
    combinationsTested: number;
  };
  mappedColumns?: MappedKeyColumn[];
  manualSelection?: boolean;
  manualValidation?: ManualKeyValidation;
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
  manualCandidate?: boolean;
  selectedKeyValidForBusinessRows?: boolean;
  requiresIncompleteRowApproval?: boolean;
  incompleteRowsHeld?: number;
  incompleteRowExamples?: ManualKeyValidation["nullKeyExamples"];
  manualValidation?: ManualKeyValidation;
}

export interface KeyHardeningResolvePayload {
  action: "APPROVE_KEY_HARDENING" | "APPROVE_INCOMPLETE_ROW_EXCLUSION";
  selectedKey: string[];
  confirmedDdl: string[];
  confirm: true;
  incompleteRowAction?: "EXCLUDE_REVIEWED_ROWS";
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
  approvalMode?: "KEY_HARDENING" | "INCOMPLETE_ROW_EXCLUSION";
  selectedKey: string[] | null;
  ddlPreview: DdlPreview | null;
  approvalChecked: boolean;
  incompleteRowsChecked?: boolean;
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

export function getDefaultManualSelection(keyDrift: KeyDriftDetails): string[] {
  if (isBlankCurrentKeyReview(keyDrift)) {
    return keyDrift.oldKey?.filter(Boolean) ?? [];
  }
  const recommended = keyDrift.recommendation?.columns?.filter(Boolean) ?? [];
  if (recommended.length > 0) return recommended;
  const oldKey = keyDrift.oldKey?.filter(Boolean) ?? [];
  if (oldKey.length > 0) return oldKey;
  return selectDefaultCandidate(keyDrift)?.columns ?? [];
}

export function getMappedColumnsForManualSelection(keyDrift: KeyDriftDetails): MappedKeyColumn[] {
  const mapped = keyDrift.mappedColumns ?? [];
  if (mapped.length > 0) {
    return mapped.map((column) => ({
      name: column.name,
      sourceColumn: column.sourceColumn,
      destinationColumn: column.destinationColumn,
      nonBlankCount: column.nonBlankCount,
      nullCount: column.nullCount,
      distinctCount: column.distinctCount,
      isCurrentKey: column.isCurrentKey,
      isDiscriminator: column.isDiscriminator,
    }));
  }

  const seen = new Set<string>();
  const fallback = [
    ...(keyDrift.oldKey ?? []),
    ...((keyDrift.candidateKeys ?? []).flatMap((candidate) => candidate.columns)),
  ];

  return fallback
    .filter((column) => {
      const key = column.toLowerCase();
      if (!column || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((column) => ({
      name: column,
      destinationColumn: column,
      nonBlankCount: 0,
      nullCount: 0,
      distinctCount: 0,
      isCurrentKey: (keyDrift.oldKey ?? []).some((oldKeyColumn) => sameColumns([oldKeyColumn], [column])),
      isDiscriminator: (keyDrift.discriminatorColumns ?? []).some((disc) =>
        sameColumns([disc.column], [column])
      ),
    }));
}

export function toggleManualKeyColumn(selected: string[], column: string): string[] {
  const exists = selected.some((candidate) => sameColumns([candidate], [column]));
  if (exists) {
    return selected.filter((candidate) => !sameColumns([candidate], [column]));
  }
  return [...selected, column];
}

export function buildResolvePayload(
  selectedKey: string[],
  confirmedDdl: string[],
  incompleteRowAction?: "EXCLUDE_REVIEWED_ROWS",
  action: "APPROVE_KEY_HARDENING" | "APPROVE_INCOMPLETE_ROW_EXCLUSION" = "APPROVE_KEY_HARDENING"
): KeyHardeningResolvePayload {
  return {
    action,
    selectedKey,
    confirmedDdl,
    confirm: true,
    ...(incompleteRowAction ? { incompleteRowAction } : {}),
  };
}

export function canApproveKeyHardening(state: ApprovalState): boolean {
  if (state.approvalMode === "INCOMPLETE_ROW_EXCLUSION") {
    return Boolean(
      state.selectedKey &&
        state.selectedKey.length > 0 &&
        state.incompleteRowsChecked === true &&
        !state.loading
    );
  }

  return Boolean(
    state.selectedKey &&
      state.selectedKey.length > 0 &&
      state.ddlPreview &&
      state.ddlPreview.ddl.length > 0 &&
      !state.ddlPreview.blocked &&
      (
        state.ddlPreview.manualValidation?.ok !== false ||
        state.ddlPreview.requiresIncompleteRowApproval === true
      ) &&
      (
        state.ddlPreview.requiresIncompleteRowApproval !== true ||
        state.incompleteRowsChecked === true
      ) &&
      state.approvalChecked &&
      !state.loading
  );
}

export function isBlankCurrentKeyReview(keyDrift: KeyDriftDetails): boolean {
  return (
    keyDrift.driftType === "BLANK_KEY" &&
    (keyDrift.duplicateExamples?.length ?? 0) === 0
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

export function formatCandidateReviewSummary(candidate: CandidateKey): string {
  const widthText = `${candidate.width.toLocaleString()} ${candidate.width === 1 ? "column" : "columns"}`;
  const nullText = `${candidate.nullCount.toLocaleString()} ${candidate.nullCount === 1 ? "null" : "nulls"}`;
  return candidate.requiresReview || candidate.nullCount > 0
    ? `${widthText}, ${nullText}, review required`
    : `${widthText}, ${nullText}`;
}

export function formatIncompleteRowsHeld(count: number): string {
  return `${count.toLocaleString()} incomplete ${count === 1 ? "row" : "rows"} held for review.`;
}

export function getNoReliableKeyMessage(keyDrift: KeyDriftDetails): string | null {
  if ((keyDrift.candidateKeys?.length ?? 0) > 0) return null;
  const suffix = " Select columns manually to validate a key.";
  const message =
    keyDrift.noReliableKeyReason ??
    "Hermod could not automatically find a key within the current search limits.";
  return message.includes("Select columns manually") ? message : `${message}${suffix}`;
}

export function getDiscoveryDiagnostics(keyDrift: KeyDriftDetails) {
  const discriminatorColumns = (
    keyDrift.discriminatorColumns ?? keyDrift.validationStats?.discriminatorColumns ?? []
  ).map((column) => ({
    column: column.column,
    duplicateGroupsSeparated: column.duplicateGroupsSeparated,
    nullCount: column.nullCount,
    distinctCount: column.distinctCount,
  }));
  const columnsExcluded = (
    keyDrift.columnsExcluded ?? keyDrift.validationStats?.columnsExcluded ?? []
  ).map((column) => ({
    column: column.column,
    reason: column.reason,
  }));

  return {
    discoveryMode: keyDrift.discoveryMode ?? keyDrift.validationStats?.discoveryMode ?? "QUICK",
    searchExhaustive: keyDrift.searchExhaustive ?? keyDrift.validationStats?.searchExhaustive ?? false,
    columnsConsidered: keyDrift.columnsConsidered ?? keyDrift.validationStats?.columnsConsidered ?? [],
    columnsExcluded,
    discriminatorColumns,
    currentKeyDuplicateGroupCount:
      keyDrift.currentKeyDuplicateGroupCount ??
      keyDrift.validationStats?.currentKeyDuplicateGroupCount ??
      0,
    candidateSearchLimits:
      keyDrift.candidateSearchLimits ??
      keyDrift.validationStats?.candidateSearchLimits ??
      (keyDrift.validationStats
        ? {
            maxWidth: keyDrift.validationStats.maxWidth,
            maxColumns: keyDrift.validationStats.maxColumns ?? keyDrift.validationStats.columnsAnalyzed,
            maxCombinations: keyDrift.validationStats.maxCombinations,
            combinationsTested: keyDrift.validationStats.combinationsTested,
          }
        : null),
  };
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
  const blankCurrentKeyReview = isBlankCurrentKeyReview(keyDrift);
  const defaultManualSelection = useMemo(() => getDefaultManualSelection(keyDrift), [keyDrift]);
  const manualColumns = useMemo(() => getMappedColumnsForManualSelection(keyDrift), [keyDrift]);
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(
    defaultManualSelection.length > 0 ? defaultManualSelection : null
  );
  const [ddlPreview, setDdlPreview] = useState<DdlPreview | null>(null);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [incompleteRowsChecked, setIncompleteRowsChecked] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const noReliableKeyMessage = getNoReliableKeyMessage(keyDrift);
  const recommendedColumns = keyDrift.recommendation?.columns ?? null;
  const discoveryDiagnostics = getDiscoveryDiagnostics(keyDrift);

  useEffect(() => {
    setSelectedColumns(defaultManualSelection.length > 0 ? defaultManualSelection : null);
  }, [defaultManualSelection]);

  useEffect(() => {
    let ignore = false;
    setApprovalChecked(false);
    setIncompleteRowsChecked(false);
    setDdlPreview(null);

    if (!selectedColumns || selectedColumns.length === 0) return;
    const previewColumns = selectedColumns;
    if (blankCurrentKeyReview && sameColumns(previewColumns, keyDrift.oldKey)) return;

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
              manualCandidate: data.manualCandidate === true,
              manualValidation: data.manualValidation,
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

    const timer = window.setTimeout(() => {
      void loadPreview();
    }, 350);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [blankCurrentKeyReview, gateId, keyDrift.oldKey, onError, pushId, selectedColumns]);

  const canApprove = canApproveKeyHardening({
    selectedKey: selectedColumns,
    ddlPreview,
    approvalChecked,
    incompleteRowsChecked,
    loading: loadingPreview || approving,
  });
  const canApproveCurrentKeyExclusion = canApproveKeyHardening({
    approvalMode: "INCOMPLETE_ROW_EXCLUSION",
    selectedKey: keyDrift.oldKey,
    ddlPreview: null,
    approvalChecked: false,
    incompleteRowsChecked,
    loading: approving || cancelling,
  });
  const showingCurrentKeyReviewSelection =
    blankCurrentKeyReview &&
    Boolean(selectedColumns && sameColumns(selectedColumns, keyDrift.oldKey));

  async function approve() {
    if (!selectedColumns || !ddlPreview || !canApprove) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/gates/${gateId}/push/${pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildResolvePayload(
          selectedColumns,
          ddlPreview.ddl,
          ddlPreview.requiresIncompleteRowApproval ? "EXCLUDE_REVIEWED_ROWS" : undefined
        )),
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

  async function approveCurrentKeyExclusion() {
    if (!canApproveCurrentKeyExclusion) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/gates/${gateId}/push/${pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildResolvePayload(
          keyDrift.oldKey,
          [],
          "EXCLUDE_REVIEWED_ROWS",
          "APPROVE_INCOMPLETE_ROW_EXCLUSION"
        )),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || data.blockReason || "Unable to approve incomplete row exclusion");
        return;
      }
      setActionResult(data);
      onResolved(data);
    } catch {
      onError("Network error while approving incomplete row exclusion");
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
          <h3 className="heading-norse text-sm text-gold-bright">Key Review Needed</h3>
          <span className="text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 border border-ember/40 text-gold-bright bg-void/70">
            Key Drift
          </span>
        </div>
        <p className="text-text-dim text-xs font-inconsolata leading-6">
          {blankCurrentKeyReview
            ? "The current key is still unique for business rows, but some rows are missing key values. No nonblank rows have been loaded yet."
            : "Hermod found that the current UPSERT key no longer uniquely identifies rows in this upload. No nonblank rows have been loaded yet. Changing destination key constraints requires approval."}
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

      <div className="border border-[rgba(201,147,58,0.08)] bg-void/30 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="label-norse text-[9px]">Discovery Diagnostics</div>
          <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim">
            {discoveryDiagnostics.searchExhaustive ? "Exhaustive search" : "Bounded search"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-text-dim font-inconsolata">
          <Metric label="Mode" value={discoveryDiagnostics.discoveryMode} />
          <Metric label="Columns" value={discoveryDiagnostics.columnsConsidered.length} />
          <Metric
            label="Combos"
            value={discoveryDiagnostics.candidateSearchLimits?.combinationsTested ?? keyDrift.validationStats?.combinationsTested ?? 0}
          />
          <Metric label="Duplicate Groups" value={discoveryDiagnostics.currentKeyDuplicateGroupCount} />
        </div>
        {discoveryDiagnostics.discriminatorColumns.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.16em] text-frost">
              Discriminator columns
            </div>
            <div className="flex flex-wrap gap-2">
              {discoveryDiagnostics.discriminatorColumns.slice(0, 8).map((column) => (
                <span
                  key={column.column}
                  className="border border-frost/20 bg-frost/[0.04] px-2 py-1 text-[10px] text-frost font-inconsolata"
                  title={`${column.duplicateGroupsSeparated} duplicate groups separated, ${column.nullCount} blanks, ${column.distinctCount} distinct values`}
                >
                  {column.column}
                </span>
              ))}
            </div>
          </div>
        )}
        {discoveryDiagnostics.discoveryMode === "CAPPED" && (
          <div className="border border-ember/30 bg-void/70 px-3 py-2 text-[11px] text-gold-bright font-inconsolata">
            Discovery hit search limits. You can still select and validate a key manually.
          </div>
        )}
      </div>

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

      {blankCurrentKeyReview && (
        <div className="border border-gold/20 bg-gold/[0.03] p-4 space-y-3">
          <div className="space-y-2">
            <h4 className="heading-norse text-xs text-gold-bright">Incomplete Rows Need Review</h4>
            <p className="text-[11px] text-text-dim font-inconsolata leading-5">
              The current key is still unique for business rows, but some rows are missing key values.
              Hermod has not loaded those rows. You can exclude the reviewed incomplete rows or cancel and fix the file.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-inconsolata">
            <div className="border border-[rgba(201,147,58,0.08)] bg-void/40 p-3">
              <div className="label-norse text-[9px] mb-2">Keep Current Key</div>
              <div className="text-gold break-words">{keyDrift.oldKey.join(" + ")}</div>
            </div>
            <div className="border border-[rgba(201,147,58,0.08)] bg-void/40 p-3">
              <div className="label-norse text-[9px] mb-2">Rows Held</div>
              <div className="text-gold">
                {formatIncompleteRowsHeld(
                  keyDrift.incompleteRowsHeld ??
                    keyDrift.incompleteRowExamples?.length ??
                    keyDrift.nullKeyExamples?.length ??
                    0
                )}
              </div>
            </div>
          </div>
          <ExampleList
            title="Incomplete Row Examples"
            empty="No incomplete row examples were captured."
            items={(keyDrift.incompleteRowExamples ?? keyDrift.nullKeyExamples ?? []).map(formatNullKeyExample)}
          />
          <label className="flex items-start gap-2 text-[11px] text-text-dim font-inconsolata">
            <input
              type="checkbox"
              checked={incompleteRowsChecked}
              onChange={(event) => setIncompleteRowsChecked(event.target.checked)}
              disabled={approving || cancelling}
              className="mt-0.5"
            />
            <span>I approve excluding the reviewed incomplete rows from this push.</span>
          </label>
          <button
            type="button"
            onClick={approveCurrentKeyExclusion}
            disabled={!canApproveCurrentKeyExclusion}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approving ? "Pushing..." : "Approve Exclusion & Push"}
          </button>
        </div>
      )}

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
          <div className="border border-ember/30 bg-void/70 px-3 py-3 text-[11px] text-gold-bright font-inconsolata">
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
                        {(candidate.requiresReview || candidate.nullCount > 0) && (
                          <span className="text-[8px] uppercase tracking-[0.16em] border border-ember/30 text-gold-bright px-1.5 py-0.5">
                            Review Required
                          </span>
                        )}
                      </div>
                      <p className={`text-[10px] font-inconsolata leading-5 ${
                        candidate.requiresReview || candidate.nullCount > 0
                          ? "text-gold-bright"
                          : "text-text-dim"
                      }`}>
                        {formatCandidateReviewSummary(candidate)}
                      </p>
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

      <div className="space-y-3 border border-[rgba(201,147,58,0.08)] bg-void/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="label-norse text-[10px]">Manual Key Selection</h4>
          <span className="text-[9px] uppercase tracking-[0.18em] text-text-dim">
            {manualColumns.length} mapped columns
          </span>
        </div>
        <p className="text-[11px] text-text-dim font-inconsolata leading-5">
          Select mapped destination columns to validate a key against the staged upload. Hermod previews DDL
          only after the selected key is unique and nonblank in the nonblank mapped rows.
        </p>
        <div className="border border-gold/10 bg-gold/[0.03] px-3 py-2 text-[11px] text-gold font-inconsolata break-words">
          {selectedColumns && selectedColumns.length > 0
            ? selectedColumns.join(" + ")
            : "Select at least one mapped destination column"}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {manualColumns.map((column) => {
            const checked =
              selectedColumns?.some((selected) => sameColumns([selected], [column.destinationColumn])) ??
              false;
            return (
              <label
                key={column.destinationColumn}
                className={`border p-3 cursor-pointer transition-colors ${
                  checked
                    ? "border-gold/40 bg-gold/[0.04]"
                    : "border-[rgba(201,147,58,0.08)] hover:border-gold/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedColumns((current) => {
                        const next = toggleManualKeyColumn(current ?? [], column.destinationColumn);
                        return next.length > 0 ? next : null;
                      })
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text font-inconsolata break-words">
                        {column.destinationColumn}
                      </span>
                      {column.isCurrentKey && (
                        <span className="text-[8px] uppercase tracking-[0.16em] border border-gold/30 text-gold-bright px-1.5 py-0.5">
                          Current
                        </span>
                      )}
                      {column.isDiscriminator && (
                        <span className="text-[8px] uppercase tracking-[0.16em] border border-frost/20 text-frost px-1.5 py-0.5">
                          Discriminator
                        </span>
                      )}
                    </div>
                    {column.sourceColumn && column.sourceColumn !== column.destinationColumn && (
                      <div className="text-[10px] text-text-dim font-inconsolata break-words">
                        Source: {column.sourceColumn}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-[10px] text-text-dim font-inconsolata">
                      <Metric label="Nonblank" value={column.nonBlankCount} />
                      <Metric label="Blanks" value={column.nullCount} />
                      <Metric label="Distinct" value={column.distinctCount} />
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
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

      {selectedColumns && !showingCurrentKeyReviewSelection && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="label-norse text-[10px]">DDL Preview</h4>
            {loadingPreview && <span className="text-[10px] text-text-dim">Loading...</span>}
          </div>

          {ddlPreview?.manualValidation && (
            <div
              className={`border px-3 py-2 text-[11px] font-inconsolata ${
                ddlPreview.manualValidation.ok || ddlPreview.requiresIncompleteRowApproval
                  ? "border-frost/20 bg-frost/[0.04] text-frost"
                  : "border-ember/30 bg-ember/10 text-ember"
              }`}
            >
              {ddlPreview.manualValidation.ok
                ? "Selected key is unique in the staged upload."
                : ddlPreview.requiresIncompleteRowApproval
                  ? `Selected key is verified, but ${ddlPreview.incompleteRowsHeld?.toLocaleString() ?? ddlPreview.manualValidation.nullCount.toLocaleString()} incomplete ${((ddlPreview.incompleteRowsHeld ?? ddlPreview.manualValidation.nullCount) === 1) ? "row must" : "rows must"} be excluded or fixed before this push can continue.`
                : "Selected key is not valid for the staged upload."}
            </div>
          )}

          {ddlPreview?.manualValidation && !ddlPreview.manualValidation.ok && !ddlPreview.requiresIncompleteRowApproval && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ExampleList
                title="Selected-Key Duplicates"
                empty="No selected-key duplicate examples were captured."
                items={ddlPreview.manualValidation.duplicateExamples.map(formatDuplicateExample)}
              />
              <ExampleList
                title="Selected-Key Blanks"
                empty="No selected-key blank examples were captured."
                items={ddlPreview.manualValidation.nullKeyExamples.map(formatNullKeyExample)}
              />
            </div>
          )}

          {ddlPreview?.requiresIncompleteRowApproval && (
            <div className="border border-gold/20 bg-gold/[0.03] p-3 space-y-3">
              <div className="space-y-2">
                <h5 className="label-norse text-[10px] text-gold-bright">Incomplete Rows Need Review</h5>
                <p className="text-[11px] text-text-dim font-inconsolata leading-5">
                  Hermod found nonblank rows that are missing values for the selected key. These rows were not loaded.
                  You can exclude the reviewed incomplete rows or cancel and fix the file.
                </p>
                <div className="text-[11px] text-gold font-inconsolata">
                  {formatIncompleteRowsHeld(ddlPreview.incompleteRowsHeld ?? ddlPreview.manualValidation?.nullCount ?? 0)}
                </div>
              </div>
              <ExampleList
                title="Incomplete Row Examples"
                empty="No incomplete row examples were captured."
                items={(ddlPreview.incompleteRowExamples ?? ddlPreview.manualValidation?.nullKeyExamples ?? []).map(formatNullKeyExample)}
              />
              <label className="flex items-start gap-2 text-[11px] text-text-dim font-inconsolata">
                <input
                  type="checkbox"
                  checked={incompleteRowsChecked}
                  onChange={(event) => setIncompleteRowsChecked(event.target.checked)}
                  disabled={!ddlPreview || ddlPreview.blocked}
                  className="mt-0.5"
                />
                <span>I approve excluding the reviewed incomplete rows from this push.</span>
              </label>
            </div>
          )}

          {ddlPreview?.blocked && (
            <div className="border border-ember/30 bg-ember/10 px-3 py-2 text-[11px] text-ember font-inconsolata">
              {ddlPreview.blockReason || "This key change is blocked."}
            </div>
          )}

          {(ddlPreview?.warnings ?? []).map((warning) => (
            <div
              key={warning}
              className="border border-ember/30 bg-void/70 px-3 py-2 text-[10px] text-gold-bright font-inconsolata"
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
              disabled={
                !ddlPreview ||
                ddlPreview.blocked ||
                (ddlPreview.manualValidation?.ok === false && !ddlPreview.requiresIncompleteRowApproval)
              }
              className="mt-0.5"
            />
            <span>I approve changing the destination key constraint.</span>
          </label>
        </div>
      )}

      {actionResult && actionResult.status !== "SUCCESS" && (
        <div className="border border-ember/30 bg-void/70 px-3 py-2 text-[11px] text-gold-bright font-inconsolata">
          Reviewed push finished with status {String(actionResult.status)}.
          {typeof actionResult.errorMessage === "string" ? ` ${actionResult.errorMessage}` : ""}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {!showingCurrentKeyReviewSelection && (
          <button
            type="button"
            onClick={approve}
            disabled={!canApprove}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approving ? "Applying..." : "Approve Key Change & Push"}
          </button>
        )}
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
