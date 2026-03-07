"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { CursorConfig, CursorCandidate, ColumnSchema, CursorStrategy } from "@/lib/sync/types";

interface CursorConfigPanelProps {
  tableName: string;
  sourceSystem: string;
  columns: ColumnSchema[];
  onConfirm: (config: CursorConfig) => void;
  cacheKey: string;
}

const STRATEGY_LABELS: Record<CursorStrategy, string> = {
  timestamp_cursor: "Timestamp Cursor",
  integer_id_cursor: "Integer ID",
  rowversion_cursor: "Rowversion",
  full_refresh: "Full Refresh",
};

const STRATEGY_COLORS: Record<CursorStrategy, string> = {
  timestamp_cursor: "#4caf50",
  integer_id_cursor: "#2196f3",
  rowversion_cursor: "#ff9800",
  full_refresh: "#ef5350",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#4caf50",
  medium: "#ff9800",
  low: "#ef5350",
};

export function CursorConfigPanel({
  tableName,
  sourceSystem,
  columns,
  onConfirm,
  cacheKey,
}: CursorConfigPanelProps) {
  const [config, setConfig] = useState<CursorConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideColumn, setOverrideColumn] = useState("");
  const [overrideStrategy, setOverrideStrategy] = useState<CursorStrategy>("timestamp_cursor");
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, CursorConfig>>(new Map());

  const detect = useCallback(async () => {
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setConfig(cached);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setConfig(null);

    try {
      const res = await fetch("/api/bifrost/routes/detect-cursor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName, sourceSystem, realm: "alfheim", columns }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Detection failed");

      const result: CursorConfig = await res.json();
      cacheRef.current.set(cacheKey, result);
      setConfig(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setLoading(false);
    }
  }, [tableName, sourceSystem, columns, cacheKey]);

  useEffect(() => {
    if (tableName && columns.length > 0) {
      detect();
    }
    return () => abortRef.current?.abort();
  }, [detect]);

  function handleOverrideConfirm() {
    if (!overrideColumn) return;
    const col = columns.find((c) => c.name === overrideColumn);
    const overrideConfig: CursorConfig = {
      strategy: overrideStrategy,
      cursorColumn: overrideStrategy === "full_refresh" ? null : overrideColumn,
      cursorColumnType: col?.type ?? null,
      primaryKey: config?.primaryKey ?? null,
      confidence: "high",
      reasoning: "Manually configured by user.",
      warnings: [],
      candidates: [],
    };
    setConfig(overrideConfig);
    setOverrideMode(false);
    onConfirm(overrideConfig);
  }

  if (loading) {
    return (
      <div className="border border-[#ce93d8]/20 bg-void/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[#ce93d8]/40 text-sm animate-pulse font-cinzel">&#x16BE;</span>
          <span className="text-text-dim text-[0.65rem] tracking-wider">
            Analysing schema...
          </span>
        </div>
        <div className="h-1 bg-[#ce93d8]/10 overflow-hidden">
          <div className="h-full bg-[#ce93d8]/30 animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-ember/30 bg-void/50 p-3">
        <p className="text-ember text-[0.65rem] tracking-wider">{error}</p>
        <button onClick={detect} className="text-[#ce93d8] text-[0.55rem] tracking-widest uppercase mt-1 hover:text-[#ce93d8]/80 cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  if (!config) return null;

  const strategyColor = STRATEGY_COLORS[config.strategy];
  const confidenceColor = CONFIDENCE_COLORS[config.confidence];

  return (
    <div className="border border-[#ce93d8]/20 bg-void/50 p-3 space-y-3">
      {/* Header: Strategy Badge + Confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[0.55rem] tracking-[0.25em] uppercase px-2 py-0.5 border font-semibold"
            style={{ color: strategyColor, borderColor: `${strategyColor}40` }}
          >
            {STRATEGY_LABELS[config.strategy]}
          </span>
          {config.cursorColumn && (
            <span className="text-text text-[0.65rem] font-mono tracking-wider">
              {config.cursorColumn}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 inline-block"
            style={{ backgroundColor: confidenceColor }}
          />
          <span
            className="text-[0.5rem] tracking-[0.3em] uppercase"
            style={{ color: confidenceColor }}
          >
            {config.confidence}
          </span>
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-text-dim text-[0.6rem] tracking-wider leading-relaxed">
        {config.reasoning}
      </p>

      {/* Warnings */}
      {config.warnings.length > 0 && (
        <div className="space-y-1">
          {config.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-ember text-[0.55rem] mt-px">&#x26A0;</span>
              <span className="text-ember/80 text-[0.55rem] tracking-wider leading-relaxed">
                {w}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Low confidence warning */}
      {config.confidence === "low" && (
        <div className="border border-ember/20 bg-ember/5 px-2 py-1.5">
          <p className="text-ember text-[0.55rem] tracking-wider">
            Low confidence — verify the selected strategy is correct before proceeding.
          </p>
        </div>
      )}

      {/* Candidates (collapsible) */}
      {config.candidates.length > 0 && (
        <div>
          <button
            onClick={() => setShowCandidates(!showCandidates)}
            className="text-[#ce93d8] text-[0.55rem] tracking-widest uppercase hover:text-[#ce93d8]/80 cursor-pointer"
          >
            {showCandidates ? "Hide" : "Show"} Candidates ({config.candidates.length})
          </button>
          {showCandidates && (
            <div className="mt-2 space-y-1">
              {config.candidates.map((c: CursorCandidate, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-1 border border-border/20 bg-deep/50"
                >
                  <span className="text-text text-[0.6rem] font-mono w-32 truncate">
                    {c.column}
                  </span>
                  <div className="flex-1 h-1 bg-border/20 overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${c.score}%`,
                        backgroundColor: STRATEGY_COLORS[c.strategy],
                        opacity: 0.6,
                      }}
                    />
                  </div>
                  <span className="text-text-dim text-[0.5rem] w-6 text-right">
                    {c.score}
                  </span>
                  <span
                    className="text-[0.45rem] tracking-widest uppercase w-20 text-right"
                    style={{ color: STRATEGY_COLORS[c.strategy] }}
                  >
                    {STRATEGY_LABELS[c.strategy]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Override Section */}
      {overrideMode ? (
        <div className="border border-border/30 bg-deep/50 p-2 space-y-2">
          <div>
            <label className="label-norse">Column</label>
            <select
              value={overrideColumn}
              onChange={(e) => setOverrideColumn(e.target.value)}
              className="select-norse"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-norse">Strategy</label>
            <select
              value={overrideStrategy}
              onChange={(e) => setOverrideStrategy(e.target.value as CursorStrategy)}
              className="select-norse"
            >
              {(Object.keys(STRATEGY_LABELS) as CursorStrategy[]).map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleOverrideConfirm}
              disabled={!overrideColumn}
              className="btn-ghost text-[0.55rem] px-3 disabled:opacity-40"
            >
              Apply Override
            </button>
            <button
              onClick={() => setOverrideMode(false)}
              className="text-text-dim text-[0.55rem] tracking-widest uppercase hover:text-text cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(config)}
            className="btn-ghost text-[0.55rem] px-3 border-[#ce93d8]/30 text-[#ce93d8] hover:bg-[#ce93d8]/5"
          >
            Confirm Strategy
          </button>
          <button
            onClick={() => setOverrideMode(true)}
            className="text-text-dim text-[0.55rem] tracking-widest uppercase hover:text-text cursor-pointer"
          >
            Override
          </button>
        </div>
      )}
    </div>
  );
}
