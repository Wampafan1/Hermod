"use client";

import { useState, useCallback } from "react";
import type { UCCResult, DiscoveredUCC } from "@/lib/ucc/discovery";

type WriteMode = "merge" | "append" | "truncate";

interface PKDetectionPanelProps {
  result: UCCResult;
  writeMode: WriteMode;
  onWriteModeChange: (mode: WriteMode) => void;
  onPkColumnsChange: (columns: string[]) => void;
  allColumns: string[];
  onManualValidationRequest?: (
    columns: string[]
  ) => Promise<{ isUnique: boolean; duplicateGroups?: number }>;
}

export function PKDetectionPanel({
  result,
  writeMode,
  onWriteModeChange,
  onPkColumnsChange,
  allColumns,
  onManualValidationRequest,
}: PKDetectionPanelProps) {
  const [selectedUCCIndex, setSelectedUCCIndex] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [manualColumns, setManualColumns] = useState<Set<string>>(new Set());
  const [manualValidation, setManualValidation] = useState<{
    isUnique: boolean;
    duplicateGroups?: number;
  } | null>(null);
  const [validating, setValidating] = useState(false);

  const recommended = result.uccs[0] ?? null;
  const hasKey = result.uccs.length > 0;

  // Select a UCC and notify parent
  const selectUCC = useCallback(
    (idx: number) => {
      setSelectedUCCIndex(idx);
      setShowManual(false);
      const ucc = result.uccs[idx];
      if (ucc) onPkColumnsChange(ucc.columns);
    },
    [result.uccs, onPkColumnsChange]
  );

  // Manual column toggle
  function toggleManualColumn(col: string) {
    const next = new Set(manualColumns);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    setManualColumns(next);
    setManualValidation(null); // reset validation on change
    onPkColumnsChange(Array.from(next));
  }

  // Live validation for manual override
  async function validateManual() {
    if (!onManualValidationRequest || manualColumns.size === 0) return;
    setValidating(true);
    try {
      const validationResult = await onManualValidationRequest(
        Array.from(manualColumns)
      );
      setManualValidation(validationResult);
    } catch {
      setManualValidation(null);
    } finally {
      setValidating(false);
    }
  }

  function formatColumns(ucc: DiscoveredUCC): string {
    return ucc.columns.join(" + ");
  }

  function handleWriteModeChange(mode: WriteMode) {
    // If trying to select merge with no key and no manual override, block it
    if (mode === "merge" && !hasKey && !showManual) return;
    onWriteModeChange(mode);
  }

  return (
    <div className="bg-deep border border-border p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 mb-1">
        <h3 className="label-norse !mb-0 text-gold">
          Primary Key{" "}
          {hasKey ? (
            <span className="text-text-dim font-inconsolata text-[10px] ml-2 normal-case tracking-normal">
              Verified across all{" "}
              {result.stats.totalRows.toLocaleString()} rows
            </span>
          ) : (
            <span className="text-ember font-inconsolata text-[10px] ml-2 normal-case tracking-normal">
              No unique key found
            </span>
          )}
        </h3>
        <div className="flex-1 h-px bg-border" />
        <span className="text-gold-dim text-xs font-cinzel select-none">
          ᚱ
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Key found state */}
      {hasKey && recommended && (
        <div className="space-y-3">
          {/* Recommended key */}
          <div className="bg-void border-2 border-gold-dim p-4">
            <p className="text-[9px] font-space-grotesk tracking-[0.3em] uppercase text-gold-dim mb-1">
              Recommended Key
            </p>
            <p className="font-cinzel text-sm text-text">
              {formatColumns(recommended)}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-success text-[10px] font-inconsolata">
                Unique across every row
              </span>
              <span className="text-text-muted text-[10px] font-inconsolata">
                {recommended.quality.totalNullCount === 0
                  ? "0 nulls"
                  : `${recommended.quality.totalNullCount.toLocaleString()} nulls`}
              </span>
            </div>
          </div>

          {/* Other valid keys */}
          {result.uccs.length > 1 && (
            <div>
              <p className="text-[9px] font-space-grotesk tracking-[0.3em] uppercase text-text-muted mb-2">
                Other valid keys found
              </p>
              <div className="space-y-1">
                {result.uccs.map((ucc, idx) => (
                  <label
                    key={idx}
                    className={`flex items-center gap-3 px-3 py-2 border cursor-pointer transition-colors ${
                      selectedUCCIndex === idx
                        ? "bg-void border-gold-dim"
                        : "border-border hover:bg-scroll/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="ucc-selection"
                      checked={selectedUCCIndex === idx}
                      onChange={() => selectUCC(idx)}
                      className="accent-gold"
                    />
                    <span className="text-xs font-inconsolata text-text">
                      {formatColumns(ucc)}
                    </span>
                    <span className="text-[10px] text-text-muted font-inconsolata ml-auto">
                      {ucc.type === "single"
                        ? "single column"
                        : `${ucc.quality.columnCount} columns`}
                      {ucc.quality.totalNullCount > 0
                        ? `, ${ucc.quality.totalNullCount} nulls`
                        : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No key found state */}
      {!hasKey && (
        <div className="bg-void border border-ember/30 p-4">
          <p className="text-xs font-inconsolata text-text leading-relaxed">
            Hermod analyzed all{" "}
            <span className="text-text font-bold">
              {result.stats.totalRows.toLocaleString()}
            </span>{" "}
            rows across{" "}
            <span className="text-text font-bold">
              {result.stats.candidateColumns}
            </span>{" "}
            candidate columns. No single column or combination (up to 4 columns)
            uniquely identifies every row.
          </p>
          <p className="text-ember text-[11px] font-inconsolata mt-2">
            Merge (Upsert) cannot be used safely.
          </p>
        </div>
      )}

      {/* Write mode selector */}
      <div>
        <p className="label-norse mb-2">Write Mode</p>
        <div className="flex gap-px bg-border">
          {(
            [
              {
                value: "merge" as const,
                label: "Merge (Upsert)",
                desc: "Update existing, insert new",
              },
              {
                value: "append" as const,
                label: "Append",
                desc: "Always insert, allow duplicates",
              },
              {
                value: "truncate" as const,
                label: "Truncate + Reload",
                desc: "Delete all, then insert",
              },
            ] as const
          ).map((opt) => {
            const isMergeDisabled =
              opt.value === "merge" && !hasKey && !showManual;
            return (
              <button
                key={opt.value}
                onClick={() => handleWriteModeChange(opt.value)}
                disabled={isMergeDisabled}
                title={
                  isMergeDisabled
                    ? "Merge requires a verified unique key. No unique key was found."
                    : undefined
                }
                className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                  isMergeDisabled
                    ? "bg-void opacity-40 cursor-not-allowed"
                    : writeMode === opt.value
                      ? "bg-deep border-b-2 border-gold"
                      : "bg-void hover:bg-scroll/50"
                }`}
              >
                <span
                  className={`text-xs font-space-grotesk tracking-wider block ${
                    isMergeDisabled
                      ? "text-text-muted"
                      : writeMode === opt.value
                        ? "text-gold"
                        : "text-text-dim"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="text-[9px] text-text-muted">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual override */}
      <div>
        <button
          onClick={() => setShowManual(!showManual)}
          className="btn-subtle text-[10px]"
        >
          {showManual
            ? "Hide manual override"
            : "Override key columns manually"}
        </button>

        {showManual && (
          <div className="mt-3 bg-void border border-border p-3 space-y-3">
            {!hasKey && (
              <p className="text-ember text-[10px] font-inconsolata border border-ember/30 bg-ember/5 p-2">
                Manual override — Hermod could not verify this key is unique.
                Merge may produce duplicates.
              </p>
            )}

            <div className="grid grid-cols-3 gap-1">
              {allColumns.map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-scroll/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={manualColumns.has(col)}
                    onChange={() => toggleManualColumn(col)}
                    className="accent-gold"
                  />
                  <span className="text-xs font-inconsolata text-text-dim truncate">
                    {col}
                  </span>
                </label>
              ))}
            </div>

            {/* Live validation */}
            {manualColumns.size > 0 && onManualValidationRequest && (
              <div className="flex items-center gap-3">
                <button
                  onClick={validateManual}
                  disabled={validating}
                  className="btn-ghost text-[10px]"
                >
                  {validating ? "Checking..." : "Verify uniqueness"}
                </button>

                {manualValidation && (
                  <span
                    className={`text-[10px] font-inconsolata ${
                      manualValidation.isUnique
                        ? "text-success"
                        : "text-error"
                    }`}
                  >
                    {manualValidation.isUnique
                      ? "Unique across all rows"
                      : `Not unique — ${(manualValidation.duplicateGroups ?? 0).toLocaleString()} duplicate groups found`}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats footer */}
      {result.stats && (
        <div className="flex gap-4 text-[9px] font-inconsolata text-text-muted border-t border-border pt-2">
          <span>
            {result.stats.candidateColumns}/{result.stats.totalColumns} columns
            analyzed
          </span>
          <span>{result.stats.levelsSearched} levels searched</span>
          <span>{result.stats.queriesExecuted} queries</span>
          <span>{result.stats.totalDurationMs}ms</span>
          {result.stats.timedOut && (
            <span className="text-ember">Timed out — partial results</span>
          )}
        </div>
      )}
    </div>
  );
}
