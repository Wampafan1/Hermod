"use client";

import { useState, useMemo } from "react";
import type { PKDetectionResult } from "@/lib/alfheim/pk-detector";
import { testUniqueness } from "@/lib/alfheim/pk-detector";

type WriteMode = "merge" | "append" | "truncate";

interface PKDetectionPanelProps {
  detection: PKDetectionResult;
  allColumns: string[];
  sampleRows: Record<string, unknown>[];
  writeMode: WriteMode;
  onWriteModeChange: (mode: WriteMode) => void;
  onPkColumnsChange: (columns: string[]) => void;
}

const CONFIDENCE_STYLE: Record<string, { text: string; label: string }> = {
  high:   { text: "text-success", label: "HIGH" },
  medium: { text: "text-warning", label: "MEDIUM" },
  low:    { text: "text-ember", label: "LOW" },
};

export function PKDetectionPanel({
  detection,
  allColumns,
  sampleRows,
  writeMode,
  onWriteModeChange,
  onPkColumnsChange,
}: PKDetectionPanelProps) {
  const [manualColumns, setManualColumns] = useState<Set<string>>(
    new Set(detection.columns)
  );
  const [showManual, setShowManual] = useState(false);

  const manualScore = useMemo(
    () =>
      manualColumns.size > 0
        ? testUniqueness(sampleRows, Array.from(manualColumns))
        : 0,
    [manualColumns, sampleRows]
  );

  function toggleColumn(col: string) {
    const next = new Set(manualColumns);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    setManualColumns(next);
    onPkColumnsChange(Array.from(next));
  }

  const conf = CONFIDENCE_STYLE[detection.confidence] ?? CONFIDENCE_STYLE.low;

  // Build example PK values
  const exampleValues = sampleRows.slice(0, 3).map((row) =>
    detection.columns.map((c) => String(row[c] ?? "")).join("_")
  );

  return (
    <div className="bg-deep border border-border p-5 space-y-4">
      <div className="flex items-center gap-4 mb-1">
        <h3 className="label-norse !mb-0 text-gold">Primary Key — For Merge Operations</h3>
        <div className="flex-1 h-px bg-border" />
        <span className="text-gold-dim text-xs font-cinzel select-none">ᚱ</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Detected key */}
      <div className="bg-void border border-border p-4">
        <p className="text-xs font-space-grotesk text-text-dim tracking-wider mb-2">
          Detected{" "}
          <span className="text-text">
            {detection.type === "single"
              ? "single column"
              : detection.type === "composite"
                ? "composite key"
                : "synthetic key (no natural key found)"}
          </span>
        </p>

        <p className="font-cinzel text-sm text-text">
          {detection.columns.join(" + ")}
        </p>

        <div className="flex items-center gap-3 mt-2">
          <span className={`text-[10px] font-space-grotesk tracking-wider uppercase ${conf.text}`}>
            Confidence: {conf.label}
          </span>
          <span className="text-text-muted text-[10px] font-inconsolata">
            {detection.uniquenessScore === 1
              ? "100% unique in sample"
              : `${(detection.uniquenessScore * 100).toFixed(0)}% unique in sample`}
          </span>
        </div>

        <p className="text-text-muted text-[11px] font-source-serif italic mt-2">
          {detection.reason}
        </p>

        {/* Example PK values */}
        {detection.type !== "synthetic" && exampleValues.length > 0 && (
          <div className="mt-3">
            <p className="text-text-muted text-[9px] font-space-grotesk tracking-wider uppercase mb-1">
              {detection.type === "composite" ? "Generated __hermod_pk" : "Key values"}
            </p>
            <div className="font-inconsolata text-[10px] text-text-dim space-y-0.5">
              {exampleValues.map((v, i) => (
                <div key={i}>{v}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Write mode selector */}
      <div>
        <p className="label-norse mb-2">Write Mode</p>
        <div className="flex gap-px bg-border">
          {([
            { value: "merge" as const, label: "Merge (Upsert)", desc: "Update existing, insert new" },
            { value: "append" as const, label: "Append", desc: "Always insert, allow duplicates" },
            { value: "truncate" as const, label: "Truncate + Reload", desc: "Delete all, then insert" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => onWriteModeChange(opt.value)}
              className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                writeMode === opt.value
                  ? "bg-deep border-b-2 border-gold"
                  : "bg-void hover:bg-scroll/50"
              }`}
            >
              <span className={`text-xs font-space-grotesk tracking-wider block ${
                writeMode === opt.value ? "text-gold" : "text-text-dim"
              }`}>
                {opt.label}
              </span>
              <span className="text-[9px] text-text-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
        {detection.confidence === "low" && writeMode === "merge" && (
          <p className="text-ember text-[10px] mt-2 font-inconsolata">
            No natural unique key was found. Merge may produce unexpected results.
            Consider Truncate + Reload instead.
          </p>
        )}
      </div>

      {/* Manual override */}
      <div>
        <button
          onClick={() => setShowManual(!showManual)}
          className="btn-subtle text-[10px]"
        >
          {showManual ? "Hide manual override" : "Override key columns manually"}
        </button>

        {showManual && (
          <div className="mt-3 bg-void border border-border p-3">
            <div className="grid grid-cols-3 gap-1">
              {allColumns.map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-scroll/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={manualColumns.has(col)}
                    onChange={() => toggleColumn(col)}
                    className="accent-gold"
                  />
                  <span className="text-xs font-inconsolata text-text-dim truncate">
                    {col}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-space-grotesk tracking-wider text-text-muted">
                Uniqueness:
              </span>
              <span
                className={`text-[10px] font-inconsolata ${
                  manualScore === 1 ? "text-success" : manualScore >= 0.95 ? "text-warning" : "text-error"
                }`}
              >
                {(manualScore * 100).toFixed(0)}% of sample rows are unique
                {manualScore === 1 && " \u2713"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
