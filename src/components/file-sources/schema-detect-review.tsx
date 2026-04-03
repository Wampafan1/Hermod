"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import type { ColumnMapping } from "@/lib/alfheim/types";
import type { AISheetAnalysisResult } from "@/lib/alfheim/sheet-analyzer";

const DATA_TYPES: ColumnMapping["dataType"][] = [
  "STRING",
  "INTEGER",
  "FLOAT",
  "BOOLEAN",
  "TIMESTAMP",
  "JSON",
];

const CONFIDENCE_BADGE: Record<string, { text: string; label: string; desc: string }> = {
  high:   { text: "text-success", label: "HIGH", desc: "AI is confident in this analysis" },
  medium: { text: "text-warning", label: "MEDIUM", desc: "Some ambiguity detected — review the highlighted columns" },
  low:    { text: "text-ember", label: "LOW", desc: "AI couldn't confidently determine the structure — manual review recommended" },
};

interface SchemaDetectReviewProps {
  columns: ColumnMapping[];
  sampleRows: Record<string, unknown>[];
  rawRows?: (string | number | boolean | null)[][];
  filename?: string;
  sheetName?: string;
  totalRows?: number;
  onChange: (columns: ColumnMapping[]) => void;
  onAIResult?: (result: AISheetAnalysisResult) => void;
  accentColor: string;
}

export function SchemaDetectReview({
  columns: initialColumns,
  sampleRows,
  rawRows,
  filename,
  sheetName,
  totalRows,
  onChange,
  onAIResult,
  accentColor,
}: SchemaDetectReviewProps) {
  const toast = useToast();
  const [columns, setColumns] = useState(initialColumns);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiNotes, setAiNotes] = useState<Map<number, string>>(new Map());
  const [observations, setObservations] = useState<string[]>([]);
  const [aiConfidence, setAiConfidence] = useState<string | null>(null);
  const [showObs, setShowObs] = useState(true);

  function updateColumn(idx: number, updates: Partial<ColumnMapping>) {
    const updated = columns.map((col, i) =>
      i === idx ? { ...col, ...updates } : col
    );
    setColumns(updated);
    onChange(updated);
  }

  async function handleAnalyzeWithAI() {
    if (!rawRows || !filename) return;
    setAnalyzing(true);

    try {
      const res = await fetch("/api/connections/analyze-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawRows: rawRows.slice(0, 50),
          filename,
          sheetName,
          totalRows: totalRows ?? rawRows.length,
          totalColumns: rawRows[0]?.length ?? 0,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Analysis failed" }));
        toast.error(body.error || "AI analysis failed — using automatic detection instead");
        return;
      }

      const result: AISheetAnalysisResult = await res.json();

      // Apply AI results to columns
      const notes = new Map<number, string>();
      const updated = columns.map((col, idx) => {
        const aiCol = result.columns.find(
          (ac) => ac.index === idx || ac.suggestedName === col.jsonPath
        );
        if (!aiCol) return col;

        if (aiCol.notes) notes.set(idx, aiCol.notes);

        return {
          ...col,
          columnName: aiCol.suggestedName.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          dataType: aiCol.dataType,
          nullable: aiCol.nullable,
        };
      });

      setColumns(updated);
      onChange(updated);
      setAiNotes(notes);
      setObservations(result.observations);
      setAiConfidence(result.confidence);
      setShowObs(true);
      onAIResult?.(result);
      toast.success("AI analysis complete");
    } catch {
      toast.error("AI analysis failed — using automatic detection instead");
    } finally {
      setAnalyzing(false);
    }
  }

  const canAnalyze = !!rawRows && !!filename;
  const confBadge = aiConfidence ? CONFIDENCE_BADGE[aiConfidence] : null;

  return (
    <div className="space-y-3">
      {/* Header with AI button */}
      <div className="flex items-center justify-between">
        <p className="label-norse !mb-0">Data Configuration</p>
        {canAnalyze && (
          <button
            onClick={handleAnalyzeWithAI}
            disabled={analyzing}
            className="btn-ghost text-xs !border-realm-nidavellir !text-realm-nidavellir hover:!bg-realm-nidavellir/10"
          >
            {analyzing ? (
              <span className="animate-pip-pulse">Analyzing...</span>
            ) : (
              <span>Analyze with AI</span>
            )}
          </button>
        )}
      </div>

      {/* AI Observations panel */}
      {observations.length > 0 && (
        <div className="border-l-2 border-realm-nidavellir bg-deep p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="label-norse !mb-0 !text-realm-nidavellir text-[9px]">AI Observations</span>
              {confBadge && (
                <span className={`text-[8px] font-space-grotesk tracking-wider uppercase ${confBadge.text}`} title={confBadge.desc}>
                  {confBadge.label}
                </span>
              )}
            </div>
            <button onClick={() => setShowObs(!showObs)} className="btn-subtle text-[9px]">
              {showObs ? "collapse" : "expand"}
            </button>
          </div>
          {showObs && (
            <ul className="space-y-1">
              {observations.map((obs, i) => (
                <li key={i} className="text-text-dim text-[11px] font-inconsolata flex gap-2">
                  <span className="text-realm-nidavellir shrink-0">·</span>
                  {obs}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Column table */}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="label-norse text-left px-3 py-2">Column Name</th>
              <th className="label-norse text-left px-3 py-2 w-28">Dest Name</th>
              <th className="label-norse text-left px-3 py-2 w-28">Type</th>
              <th className="label-norse text-center px-3 py-2 w-16">Nullable</th>
              <th className="label-norse text-left px-3 py-2">Sample Values</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => {
              const samples = sampleRows
                .slice(0, 3)
                .map((row) => {
                  const val = row[col.jsonPath];
                  if (val === null || val === undefined) return "null";
                  const s = String(val);
                  return s.length > 30 ? s.slice(0, 30) + "..." : s;
                })
                .join(" | ");

              const note = aiNotes.get(idx);

              return (
                <tr
                  key={col.jsonPath}
                  className="border-b border-border/30 hover:bg-scroll/50"
                >
                  <td className="px-3 py-2 font-inconsolata text-text">
                    {col.jsonPath}
                    {note && (
                      <span
                        className="ml-1 text-realm-nidavellir cursor-help text-[10px]"
                        title={note}
                      >
                        i
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={col.columnName}
                      onChange={(e) =>
                        updateColumn(idx, { columnName: e.target.value })
                      }
                      className="input-norse !text-xs !py-0.5 !px-1 w-full"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={col.dataType}
                      onChange={(e) =>
                        updateColumn(idx, {
                          dataType: e.target.value as ColumnMapping["dataType"],
                        })
                      }
                      className="select-norse !text-xs !py-0.5 !px-1 w-full"
                    >
                      {DATA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      onChange={(e) =>
                        updateColumn(idx, { nullable: e.target.checked })
                      }
                      className="accent-gold"
                    />
                  </td>
                  <td className="px-3 py-2 font-inconsolata text-[10px] text-text-muted truncate max-w-[200px]">
                    {samples}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="px-3 py-2 border-t border-border">
          <p className="text-text-muted text-[10px] font-space-grotesk tracking-wider">
            {columns.length} columns detected ·{" "}
            <span style={{ color: accentColor }}>
              {columns.filter((c) => c.nullable).length} nullable
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
