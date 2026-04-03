"use client";

import { useState } from "react";
import type { ForgeStep, ForgeStepType } from "@/lib/mjolnir/types";

const STEP_TYPE_LABELS: Record<ForgeStepType, string> = {
  remove_columns: "Remove Columns",
  rename_columns: "Rename Columns",
  reorder_columns: "Reorder Columns",
  filter_rows: "Filter Rows",
  format: "Format",
  calculate: "Calculate",
  sort: "Sort",
  deduplicate: "Deduplicate",
  lookup: "Lookup",
  pivot: "Pivot",
  unpivot: "Unpivot",
  aggregate: "Aggregate",
  split_column: "Split Column",
  merge_columns: "Merge Columns",
  custom_sql: "Custom SQL",
};

const STEP_TYPE_COLORS: Record<ForgeStepType, string> = {
  remove_columns: "bg-ember/10 text-ember border-ember/30",
  rename_columns: "bg-frost/10 text-frost border-frost/30",
  reorder_columns: "bg-gold/10 text-gold border-gold/30",
  filter_rows: "bg-ember/10 text-ember border-ember/30",
  format: "bg-frost/10 text-frost border-frost/30",
  calculate: "bg-gold/10 text-gold border-gold/30",
  sort: "bg-frost/10 text-frost border-frost/30",
  deduplicate: "bg-ember/10 text-ember border-ember/30",
  lookup: "bg-gold/10 text-gold border-gold/30",
  pivot: "bg-frost/10 text-frost border-frost/30",
  unpivot: "bg-frost/10 text-frost border-frost/30",
  aggregate: "bg-gold/10 text-gold border-gold/30",
  split_column: "bg-frost/10 text-frost border-frost/30",
  merge_columns: "bg-frost/10 text-frost border-frost/30",
  custom_sql: "bg-gold/10 text-gold border-gold/30",
};

function confidenceBadge(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-900/30 text-green-400 border-green-400/30";
  if (confidence >= 0.5) return "bg-gold/10 text-gold border-gold/30";
  return "bg-ember/10 text-ember border-ember/30";
}

interface StepEditorProps {
  step: ForgeStep;
  index: number;
  onChange: (step: ForgeStep) => void;
  onRemove: () => void;
}

export function StepEditor({ step, index, onChange, onRemove }: StepEditorProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

  return (
    <div className="bg-deep border border-border p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        {/* Step number */}
        <span className="text-gold/40 text-xs font-cinzel w-6 text-center flex-shrink-0">
          {index + 1}
        </span>

        {/* Type badge */}
        <span
          className={`inline-flex items-center px-2 py-0.5 text-[0.6875rem] tracking-wide uppercase border ${STEP_TYPE_COLORS[step.type]}`}
        >
          {STEP_TYPE_LABELS[step.type]}
        </span>

        {/* Confidence badge */}
        <span
          className={`inline-flex items-center px-2 py-0.5 text-[0.6875rem] tracking-wide border ${confidenceBadge(step.confidence)}`}
        >
          {Math.round(step.confidence * 100)}%
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Config toggle */}
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="btn-subtle text-[0.625rem]"
        >
          {showConfig ? "Hide Config" : "Config"}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="btn-subtle text-error hover:text-error text-[0.625rem]"
        >
          Remove
        </button>
      </div>

      {/* Description */}
      {editingDescription ? (
        <div className="pl-9">
          <textarea
            value={step.description}
            onChange={(e) => onChange({ ...step, description: e.target.value })}
            onBlur={() => setEditingDescription(false)}
            className="input-norse w-full text-xs resize-none"
            rows={2}
            autoFocus
          />
        </div>
      ) : (
        <p
          className="text-text-dim text-xs tracking-wide pl-9 cursor-pointer hover:text-text transition-colors"
          onClick={() => setEditingDescription(true)}
          title="Click to edit description"
        >
          {step.description}
        </p>
      )}

      {/* Config panel (collapsible) */}
      {showConfig && (
        <div className="pl-9">
          <pre className="text-[0.625rem] text-text-dim/80 bg-void/50 border border-border p-3 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(step.config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
