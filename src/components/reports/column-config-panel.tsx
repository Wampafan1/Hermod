"use client";

import { useState, useCallback, useRef } from "react";
import type { ColumnConfig } from "@/lib/column-config";
import { isMissing, createFormulaColumn } from "@/lib/column-config";

interface ColumnConfigPanelProps {
  config: ColumnConfig[];
  queryColumns: string[];
  onChange: (config: ColumnConfig[]) => void;
  warnings: string[];
}

export function ColumnConfigPanel({
  config,
  queryColumns,
  onChange,
  warnings,
}: ColumnConfigPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [addingFormula, setAddingFormula] = useState(false);
  const [newFormulaName, setNewFormulaName] = useState("");
  const [newFormulaExpr, setNewFormulaExpr] = useState("");
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const visibleCount = config.filter((c) => c.visible).length;

  const updateEntry = useCallback(
    (index: number, updates: Partial<ColumnConfig>) => {
      const next = config.map((entry, i) =>
        i === index ? { ...entry, ...updates } : entry
      );
      onChange(next);
    },
    [config, onChange]
  );

  const removeEntry = useCallback(
    (index: number) => {
      onChange(config.filter((_, i) => i !== index));
    },
    [config, onChange]
  );

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const next = [...config];
    const [dragged] = next.splice(dragItem.current, 1);
    next.splice(dragOverItem.current, 0, dragged);
    onChange(next);

    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleAddFormula = () => {
    if (!newFormulaName.trim() || !newFormulaExpr.trim()) return;
    const entry = createFormulaColumn(newFormulaName.trim(), newFormulaExpr.trim());
    onChange([...config, entry]);
    setNewFormulaName("");
    setNewFormulaExpr("");
    setAddingFormula(false);
  };

  if (collapsed) {
    return (
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-deep border border-border cursor-pointer hover:bg-[rgba(201,147,58,0.04)] transition-colors"
        onClick={() => setCollapsed(false)}
      >
        <span className="text-text-dim text-[0.5625rem] tracking-widest uppercase">
          Column Config
        </span>
        <span className="text-text-dim text-[0.5625rem] tracking-wide">
          {visibleCount} column{visibleCount !== 1 ? "s" : ""} configured
        </span>
      </div>
    );
  }

  return (
    <div className="bg-deep border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="label-norse text-[0.5625rem]">Column Config</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddingFormula(true)}
            className="text-gold text-[0.5625rem] tracking-widest uppercase hover:text-gold-bright transition-colors"
          >
            + Add Formula
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="text-text-dim text-[0.625rem] hover:text-text transition-colors px-1"
            title="Collapse"
          >
            ▲
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="px-3 py-1.5 bg-warning-dim border-b border-warning/20">
          {warnings.map((w, i) => (
            <p key={i} className="text-[0.5625rem] text-warning tracking-wide">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Column list */}
      <div className="max-h-48 overflow-y-auto">
        {/* Table header */}
        <div className="grid grid-cols-[24px_1fr_1fr_60px_1fr_32px_32px] gap-px px-1 py-1 bg-void/50 border-b border-border text-[0.5rem] text-text-dim tracking-widest uppercase">
          <span />
          <span className="px-2">Source</span>
          <span className="px-2">Display Name</span>
          <span className="px-2">Width</span>
          <span className="px-2">Formula</span>
          <span className="text-center">Vis</span>
          <span />
        </div>

        {config.map((entry, index) => {
          const missing = isMissing(entry, queryColumns);
          return (
            <div
              key={entry.id}
              className={`grid grid-cols-[24px_1fr_1fr_60px_1fr_32px_32px] gap-px px-1 items-center border-b border-border/50 ${
                missing ? "bg-error-dim/30" : ""
              }`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
            >
              {/* Drag handle */}
              <span className="text-text-dim/50 text-center cursor-grab text-[0.625rem] select-none">
                ⠿
              </span>

              {/* Source column */}
              <select
                value={entry.sourceColumn ?? ""}
                onChange={(e) =>
                  updateEntry(index, {
                    sourceColumn: e.target.value || null,
                  })
                }
                className="bg-transparent border-none text-text text-[0.625rem] py-1 px-2 focus:outline-none"
              >
                <option value="" className="bg-deep">
                  {entry.formula ? "— (formula)" : "— select —"}
                </option>
                {queryColumns.map((col) => (
                  <option key={col} value={col} className="bg-deep">
                    {col}
                  </option>
                ))}
              </select>

              {/* Display name */}
              <input
                type="text"
                value={entry.displayName}
                onChange={(e) =>
                  updateEntry(index, { displayName: e.target.value })
                }
                className="bg-transparent border-none text-text text-[0.625rem] py-1 px-2 focus:outline-none"
              />

              {/* Width (Excel character-width units) */}
              <input
                type="number"
                value={entry.width}
                step={0.5}
                min={2}
                max={100}
                onChange={(e) =>
                  updateEntry(index, {
                    width: Math.max(2, Math.min(100, parseFloat(e.target.value) || 8.43)),
                  })
                }
                className="bg-transparent border-none text-text text-[0.625rem] py-1 px-2 w-full focus:outline-none"
              />

              {/* Formula */}
              <input
                type="text"
                value={entry.formula ?? ""}
                onChange={(e) =>
                  updateEntry(index, {
                    formula: e.target.value || undefined,
                  })
                }
                placeholder={entry.sourceColumn ? "" : "=A2*B2"}
                className="bg-transparent border-none text-frost text-[0.625rem] py-1 px-2 focus:outline-none font-inconsolata"
              />

              {/* Visibility toggle */}
              <button
                onClick={() =>
                  updateEntry(index, { visible: !entry.visible })
                }
                className={`text-center text-[0.625rem] ${
                  entry.visible ? "text-success" : "text-text-dim/30"
                }`}
                title={entry.visible ? "Visible" : "Hidden"}
              >
                {entry.visible ? "on" : "off"}
              </button>

              {/* Delete (only for formula columns or user-added) */}
              <button
                onClick={() => removeEntry(index)}
                className="text-center text-text-dim/40 hover:text-error text-[0.625rem] transition-colors"
                title="Remove column"
              >
                x
              </button>
            </div>
          );
        })}
      </div>

      {/* Add formula row */}
      {addingFormula && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-void/30">
          <input
            type="text"
            value={newFormulaName}
            onChange={(e) => setNewFormulaName(e.target.value)}
            placeholder="Column name"
            className="input-norse text-[0.625rem] py-1 flex-1"
            autoFocus
          />
          <input
            type="text"
            value={newFormulaExpr}
            onChange={(e) => setNewFormulaExpr(e.target.value)}
            placeholder="=A2*B2"
            className="input-norse text-[0.625rem] py-1 flex-1 font-inconsolata text-frost"
          />
          <button onClick={handleAddFormula} className="btn-ghost text-[0.5625rem] px-2 py-1">
            <span>Add</span>
          </button>
          <button
            onClick={() => setAddingFormula(false)}
            className="text-text-dim text-[0.625rem] hover:text-text"
          >
            x
          </button>
        </div>
      )}
    </div>
  );
}
