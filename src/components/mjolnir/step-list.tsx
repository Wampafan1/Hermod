"use client";

import { useState, useRef, useCallback } from "react";
import type { ForgeStep, ForgeStepType } from "@/lib/mjolnir/types";
import { StepEditor } from "@/components/mjolnir/step-editor";

const ALL_STEP_TYPES: ForgeStepType[] = [
  "remove_columns",
  "rename_columns",
  "reorder_columns",
  "filter_rows",
  "format",
  "calculate",
  "sort",
  "deduplicate",
  "lookup",
  "pivot",
  "unpivot",
  "aggregate",
  "split_column",
  "merge_columns",
  "custom_sql",
];

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

interface StepListProps {
  steps: ForgeStep[];
  onChange: (steps: ForgeStep[]) => void;
}

export function StepList({ steps, onChange }: StepListProps) {
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const handleStepChange = useCallback(
    (index: number, updated: ForgeStep) => {
      const next = [...steps];
      next[index] = updated;
      onChange(next);
    },
    [steps, onChange]
  );

  const handleStepRemove = useCallback(
    (index: number) => {
      const next = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i }));
      onChange(next);
    },
    [steps, onChange]
  );

  function handleAddStep(type: ForgeStepType) {
    const newStep: ForgeStep = {
      order: steps.length,
      type,
      confidence: 1.0,
      config: {},
      description: `${STEP_TYPE_LABELS[type]} (manually added)`,
    };
    onChange([...steps, newStep]);
    setShowTypeSelector(false);
  }

  // Drag-and-drop handlers
  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Use a minimal drag image
    e.dataTransfer.setData("text/plain", String(index));
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex !== null && dragIndex !== index) {
      setDropIndex(index);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDropIndex(null);
    }
  }

  function handleDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    dragCounter.current = 0;

    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }

    const reordered = [...steps];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const renumbered = reordered.map((s, i) => ({ ...s, order: i }));

    onChange(renumbered);
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
    dragCounter.current = 0;
  }

  if (steps.length === 0) {
    return (
      <div className="text-center py-8 bg-deep border border-border">
        <span className="text-gold/20 text-xl font-cinzel block mb-2">ᛗ</span>
        <p className="text-text-dim text-xs tracking-wide">
          No transformation steps detected.
        </p>
        <button
          onClick={() => setShowTypeSelector(true)}
          className="btn-subtle mt-3"
        >
          Add a step manually
        </button>

        {showTypeSelector && (
          <TypeSelector
            onSelect={handleAddStep}
            onClose={() => setShowTypeSelector(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <div key={`step-${index}-${step.type}`}>
          {/* Drop indicator line */}
          {dropIndex === index && dragIndex !== null && dragIndex !== index && (
            <div className="h-0.5 bg-gold mx-4 my-0" />
          )}

          <div
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={`transition-opacity ${
              dragIndex === index ? "opacity-40" : "opacity-100"
            }`}
            style={{ cursor: "grab" }}
          >
            <StepEditor
              step={step}
              index={index}
              onChange={(updated) => handleStepChange(index, updated)}
              onRemove={() => handleStepRemove(index)}
            />
          </div>

          {/* 1px gap between items */}
          {index < steps.length - 1 && <div className="h-px" />}
        </div>
      ))}

      {/* Drop indicator at end */}
      {dropIndex === steps.length && dragIndex !== null && (
        <div className="h-0.5 bg-gold mx-4" />
      )}

      {/* Add step button */}
      <div className="pt-3 relative">
        <button
          onClick={() => setShowTypeSelector(!showTypeSelector)}
          className="btn-ghost text-xs"
        >
          <span>+ Add Step</span>
        </button>

        {showTypeSelector && (
          <TypeSelector
            onSelect={handleAddStep}
            onClose={() => setShowTypeSelector(false)}
          />
        )}
      </div>
    </div>
  );
}

function TypeSelector({
  onSelect,
  onClose,
}: {
  onSelect: (type: ForgeStepType) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <div className="absolute left-0 bottom-full mb-1 z-50 bg-deep border border-border-mid p-2 min-w-[200px]">
        <p className="label-norse px-2 py-1 mb-1">Step Type</p>
        {ALL_STEP_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="block w-full text-left px-3 py-1.5 text-xs text-text-dim hover:text-text hover:bg-gold/[0.04] transition-colors tracking-wide"
          >
            {STEP_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </>
  );
}
