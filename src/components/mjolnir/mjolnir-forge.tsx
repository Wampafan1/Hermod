"use client";

import { useReducer, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FileUploadZone } from "@/components/mjolnir/file-upload-zone";
import { StepList } from "@/components/mjolnir/step-list";
import { ValidationReport } from "@/components/mjolnir/validation-report";
import { BlueprintList } from "@/components/mjolnir/blueprint-list";
import { ForgeAnimation } from "@/components/mjolnir/forge-animation";
import type { FileInfo } from "@/components/mjolnir/file-upload-zone";
import type { ForgeStep, StructuralDiffResult, BlueprintFormatting } from "@/lib/mjolnir/types";
import type { ValidationResult } from "@/lib/mjolnir/engine/validation";

// ─── State ───────────────────────────────────────────

interface ForgeState {
  currentStep: number; // 0-5
  beforeFile: FileInfo | null;
  afterFile: FileInfo | null;
  description: string;
  steps: ForgeStep[];
  diff: Partial<StructuralDiffResult> | null;
  afterFormatting: BlueprintFormatting | null;
  validation: ValidationResult | null;
  blueprintName: string;
  loading: boolean;
  error: string | null;
  warnings: string[];
}

const initialState: ForgeState = {
  currentStep: 0,
  beforeFile: null,
  afterFile: null,
  description: "",
  steps: [],
  diff: null,
  afterFormatting: null,
  validation: null,
  blueprintName: "",
  loading: false,
  error: null,
  warnings: [],
};

// ─── Actions ─────────────────────────────────────────

type ForgeAction =
  | { type: "SET_BEFORE"; payload: FileInfo }
  | { type: "SET_AFTER"; payload: FileInfo }
  | { type: "SET_DESCRIPTION"; payload: string }
  | { type: "SET_STEPS"; payload: ForgeStep[] }
  | { type: "SET_ANALYSIS"; payload: { steps: ForgeStep[]; diff: Partial<StructuralDiffResult>; afterFormatting?: BlueprintFormatting | null; warnings?: string[] } }
  | { type: "SET_VALIDATION"; payload: ValidationResult }
  | { type: "SET_BLUEPRINT_NAME"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "GO_TO_STEP"; payload: number }
  | { type: "RESET" };

function forgeReducer(state: ForgeState, action: ForgeAction): ForgeState {
  switch (action.type) {
    case "SET_BEFORE":
      return {
        ...state,
        beforeFile: action.payload,
        currentStep: 1,
        error: null,
      };
    case "SET_AFTER":
      return {
        ...state,
        afterFile: action.payload,
        currentStep: 2,
        error: null,
      };
    case "SET_DESCRIPTION":
      return { ...state, description: action.payload };
    case "SET_STEPS":
      return { ...state, steps: action.payload };
    case "SET_ANALYSIS":
      return {
        ...state,
        steps: action.payload.steps,
        diff: action.payload.diff,
        afterFormatting: action.payload.afterFormatting ?? null,
        warnings: action.payload.warnings ?? [],
        currentStep: 3,
        loading: false,
        error: null,
      };
    case "SET_VALIDATION":
      return {
        ...state,
        validation: action.payload,
        currentStep: 4,
        loading: false,
        error: null,
      };
    case "SET_BLUEPRINT_NAME":
      return { ...state, blueprintName: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload, error: null };
    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };
    case "GO_TO_STEP":
      return { ...state, currentStep: action.payload };
    case "RESET":
      return { ...initialState };
    default:
      return state;
  }
}

// ─── Wizard Step Labels ──────────────────────────────

const STEP_LABELS = [
  "Upload Before",
  "Upload After",
  "Describe",
  "Review Steps",
  "Validate",
  "Save",
];

const STEP_RUNES = ["ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᛗ"];

// ─── Component ───────────────────────────────────────

interface MjolnirForgeProps {
  blueprints: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    version: number;
    beforeSample: string | null;
    afterSample: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}

export function MjolnirForge({ blueprints: initialBlueprints }: MjolnirForgeProps) {
  const [state, dispatch] = useReducer(forgeReducer, initialState);
  const router = useRouter();
  const toast = useToast();

  // ─── API Calls ────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!state.beforeFile || !state.afterFile) return;

    dispatch({ type: "SET_LOADING", payload: true });

    try {
      const res = await fetch("/api/mjolnir/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beforeFileId: state.beforeFile.fileId,
          afterFileId: state.afterFile.fileId,
          description: state.description || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_ERROR", payload: data.error || "Analysis failed." });
        return;
      }

      const data = await res.json();
      dispatch({
        type: "SET_ANALYSIS",
        payload: { steps: data.steps, diff: data.diff, afterFormatting: data.afterFormatting, warnings: data.warnings },
      });
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Network error during analysis." });
    }
  }, [state.beforeFile, state.afterFile, state.description]);

  const handleValidate = useCallback(async () => {
    if (!state.beforeFile || !state.afterFile || state.steps.length === 0) return;

    dispatch({ type: "SET_LOADING", payload: true });

    try {
      const res = await fetch("/api/mjolnir/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: state.steps,
          beforeFileId: state.beforeFile.fileId,
          afterFileId: state.afterFile.fileId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_ERROR", payload: data.error || "Validation failed." });
        return;
      }

      const data = await res.json();
      dispatch({ type: "SET_VALIDATION", payload: data });
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Network error during validation." });
    }
  }, [state.beforeFile, state.afterFile, state.steps]);

  const handleSave = useCallback(async () => {
    if (!state.blueprintName.trim()) {
      dispatch({ type: "SET_ERROR", payload: "Blueprint name is required." });
      return;
    }
    if (state.steps.length === 0) {
      dispatch({ type: "SET_ERROR", payload: "At least one step is required." });
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });

    try {
      const res = await fetch("/api/mjolnir/blueprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.blueprintName.trim(),
          description: state.description || undefined,
          steps: state.steps,
          sourceSchema: state.beforeFile
            ? { columns: state.beforeFile.columns, types: {} }
            : undefined,
          analysisLog: state.diff || undefined,
          afterFormatting: state.afterFormatting || undefined,
          beforeSample: state.beforeFile?.filename,
          afterSample: state.afterFile?.filename,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_ERROR", payload: data.error || "Save failed." });
        return;
      }

      toast.success("Blueprint forged successfully.");
      dispatch({ type: "RESET" });
      router.refresh();
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Network error during save." });
    }
  }, [state, toast, router]);

  // ─── Step navigation helpers ──────────────────────

  function canNavigateTo(step: number): boolean {
    if (step === 0) return true;
    if (step === 1) return state.beforeFile !== null;
    if (step === 2) return state.afterFile !== null;
    if (step === 3) return state.steps.length > 0;
    if (step === 4) return state.validation !== null;
    if (step === 5) return state.validation !== null;
    return false;
  }

  // ─── Render ───────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Progress bar */}
      <div className="bg-deep border border-border p-5">
        <div className="flex items-center justify-between">
          {STEP_LABELS.map((label, i) => {
            const isCompleted = state.currentStep > i;
            const isCurrent = state.currentStep === i;
            const navigable = canNavigateTo(i);

            return (
              <div
                key={label}
                className="flex items-center flex-1 last:flex-initial"
              >
                {/* Step dot + label */}
                <button
                  onClick={() => navigable && dispatch({ type: "GO_TO_STEP", payload: i })}
                  disabled={!navigable}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    navigable ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span
                    className={`w-7 h-7 flex items-center justify-center text-xs font-cinzel border transition-colors ${
                      isCompleted
                        ? "bg-gold/20 border-gold text-gold"
                        : isCurrent
                        ? "bg-gold-bright/10 border-gold-bright text-gold-bright"
                        : "bg-void/50 border-border text-text-dim/40"
                    }`}
                  >
                    {STEP_RUNES[i]}
                  </span>
                  <span
                    className={`text-[0.5625rem] tracking-[0.15em] uppercase whitespace-nowrap ${
                      isCompleted
                        ? "text-gold"
                        : isCurrent
                        ? "text-gold-bright"
                        : "text-text-dim/40"
                    }`}
                  >
                    {label}
                  </span>
                </button>

                {/* Connecting line */}
                {i < STEP_LABELS.length - 1 && (
                  <div
                    className={`flex-1 h-px mx-3 mt-[-1rem] ${
                      isCompleted ? "bg-gold/40" : "bg-border"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error display */}
      {state.error && (
        <div className="bg-ember/5 border border-ember/30 p-4">
          <p className="text-ember text-xs tracking-wide">{state.error}</p>
        </div>
      )}

      {/* Loading overlay */}
      {state.loading && <ForgeAnimation />}

      {/* Step panels */}
      {!state.loading && (
        <div className="bg-deep border border-border p-6 animate-fade-up">
          {/* Step 0: Upload BEFORE */}
          {state.currentStep === 0 && (
            <div className="space-y-4">
              <p className="label-norse">Step 1 — Upload Before File</p>
              <FileUploadZone
                label="BEFORE"
                description="The original source file before any transformations."
                onUpload={(info) => dispatch({ type: "SET_BEFORE", payload: info })}
              />
            </div>
          )}

          {/* Step 1: Upload AFTER */}
          {state.currentStep === 1 && (
            <div className="space-y-4">
              <p className="label-norse">Step 2 — Upload After File</p>
              <p className="text-text-dim text-xs tracking-wide">
                Uploaded:{" "}
                <span className="text-text">{state.beforeFile?.filename}</span>
                {" "}({state.beforeFile?.columns.length} cols, {state.beforeFile?.rowCount.toLocaleString()} rows)
              </p>
              <FileUploadZone
                label="AFTER"
                description="The desired output file after transformations."
                onUpload={(info) => dispatch({ type: "SET_AFTER", payload: info })}
              />
            </div>
          )}

          {/* Step 2: Describe transformation */}
          {state.currentStep === 2 && (
            <div className="space-y-4">
              <p className="label-norse">Step 3 — Describe Transformation</p>
              <p className="text-text-dim text-xs tracking-wide">
                Optionally describe what changes were made. This helps the engine
                resolve ambiguous transformations.
              </p>

              {/* File summary */}
              <div className="flex gap-4 text-xs text-text-dim tracking-wide">
                <span>
                  Before: <span className="text-text">{state.beforeFile?.filename}</span>
                </span>
                <span className="text-gold/30">-&gt;</span>
                <span>
                  After: <span className="text-text">{state.afterFile?.filename}</span>
                </span>
              </div>

              <textarea
                value={state.description}
                onChange={(e) =>
                  dispatch({ type: "SET_DESCRIPTION", payload: e.target.value })
                }
                placeholder="e.g., Remove inactive accounts, rename 'Acct_Num' to 'Account Number', sort by date descending..."
                className="input-norse w-full text-xs resize-none"
                rows={4}
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleAnalyze}
                  className="btn-primary"
                >
                  <span>Analyze</span>
                </button>
                <button
                  onClick={handleAnalyze}
                  className="btn-ghost"
                >
                  <span>Skip Description</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review detected steps */}
          {state.currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="label-norse">Step 4 — Review Detected Steps</p>
                <span className="text-text-dim/80 text-[0.625rem] tracking-wider">
                  {state.steps.length} step{state.steps.length !== 1 ? "s" : ""} detected
                </span>
              </div>

              {/* Diff summary */}
              {state.diff && (
                <div className="flex flex-wrap gap-3 text-xs text-text-dim tracking-wide">
                  {state.diff.removedColumns && state.diff.removedColumns.length > 0 && (
                    <span className="text-ember">
                      -{state.diff.removedColumns.length} columns removed
                    </span>
                  )}
                  {state.diff.addedColumns && state.diff.addedColumns.length > 0 && (
                    <span className="text-frost">
                      +{state.diff.addedColumns.length} columns added
                    </span>
                  )}
                  {state.diff.matchedColumns && (
                    <span>
                      {state.diff.matchedColumns.length} columns matched
                    </span>
                  )}
                  {state.diff.reorderDetected && (
                    <span className="text-gold">columns reordered</span>
                  )}
                  {state.diff.sortDetected && (
                    <span className="text-gold">
                      sorted by {state.diff.sortDetected.column} {state.diff.sortDetected.direction}
                    </span>
                  )}
                  {state.diff.ambiguousCases && state.diff.ambiguousCases.length > 0 && (
                    <span className="text-ember">
                      {state.diff.ambiguousCases.length} ambiguous case{state.diff.ambiguousCases.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}

              {/* Formatting capture indicator */}
              {state.afterFormatting ? (
                <div className="bg-gold/5 border border-gold/20 p-3 flex items-center gap-3">
                  <span className="text-gold text-sm font-cinzel">ᛊ</span>
                  <div>
                    <p className="text-gold text-[0.625rem] tracking-[0.35em] uppercase font-bold">
                      Formatting Captured
                    </p>
                    <p className="text-text-dim text-xs tracking-wide">
                      {state.afterFormatting.columns.length} columns,{" "}
                      {state.afterFormatting.headerRowCount} header row{state.afterFormatting.headerRowCount !== 1 ? "s" : ""},
                      {" "}{Object.keys(state.afterFormatting.headerStyles).length} styled cells,
                      {" "}{state.afterFormatting.merges.length > 0 ? `${state.afterFormatting.merges.length} merge${state.afterFormatting.merges.length !== 1 ? "s" : ""}` : "no merges"},
                      {state.afterFormatting.freeze ? ", freeze panes" : ""}
                    </p>
                  </div>
                </div>
              ) : state.diff ? (
                <div className="bg-ember/5 border border-ember/20 p-3 flex items-center gap-3">
                  <span className="text-ember/60 text-sm font-cinzel">ᛊ</span>
                  <p className="text-ember/80 text-xs tracking-wide">
                    No formatting captured — output will use default styles.
                  </p>
                </div>
              ) : null}

              {/* AI warnings */}
              {state.warnings.length > 0 && (
                <div className="bg-ember/5 border border-ember/30 p-3 space-y-1">
                  <p className="text-ember text-[0.625rem] tracking-[0.35em] uppercase font-bold">
                    AI Inference Warnings
                  </p>
                  {state.warnings.map((w, i) => (
                    <p key={i} className="text-ember/80 text-xs tracking-wide">{w}</p>
                  ))}
                </div>
              )}

              <StepList
                steps={state.steps}
                onChange={(updated) =>
                  dispatch({ type: "SET_STEPS", payload: updated })
                }
              />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleValidate}
                  disabled={state.steps.length === 0}
                  className="btn-primary"
                >
                  <span>Test Run</span>
                </button>
                <button
                  onClick={() => dispatch({ type: "GO_TO_STEP", payload: 5 })}
                  className="btn-ghost"
                >
                  <span>Skip Validation</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Validation results */}
          {state.currentStep === 4 && state.validation && (
            <div className="space-y-4">
              <p className="label-norse">Step 5 — Validation Results</p>
              <ValidationReport result={state.validation} />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => dispatch({ type: "GO_TO_STEP", payload: 5 })}
                  className="btn-primary"
                >
                  <span>Save Blueprint</span>
                </button>
                <button
                  onClick={() => dispatch({ type: "GO_TO_STEP", payload: 3 })}
                  className="btn-ghost"
                >
                  <span>Edit Steps</span>
                </button>
                <button
                  onClick={handleValidate}
                  className="btn-ghost"
                >
                  <span>Re-validate</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Save blueprint */}
          {state.currentStep === 5 && (
            <div className="space-y-4">
              <p className="label-norse">Step 6 — Save Blueprint</p>
              <p className="text-text-dim text-xs tracking-wide">
                Name your blueprint and save it to the forge.
              </p>

              <div className="space-y-3 max-w-md">
                <label className="label-norse">Blueprint Name</label>
                <input
                  type="text"
                  value={state.blueprintName}
                  onChange={(e) =>
                    dispatch({
                      type: "SET_BLUEPRINT_NAME",
                      payload: e.target.value,
                    })
                  }
                  placeholder="e.g., Monthly Account Cleanup"
                  className="input-norse"
                />
              </div>

              {/* Summary */}
              <div className="flex flex-wrap gap-4 text-xs text-text-dim tracking-wide pt-2">
                <span>
                  {state.steps.length} step{state.steps.length !== 1 ? "s" : ""}
                </span>
                {state.beforeFile && (
                  <span>From: {state.beforeFile.filename}</span>
                )}
                {state.afterFile && (
                  <span>To: {state.afterFile.filename}</span>
                )}
                {state.validation && (
                  <span
                    className={
                      state.validation.passed ? "text-green-400" : "text-ember"
                    }
                  >
                    {Math.round(state.validation.overallMatchRate * 100)}% match
                  </span>
                )}
                <span className={state.afterFormatting ? "text-gold" : "text-text-dim/40"}>
                  {state.afterFormatting ? "formatting captured" : "no formatting"}
                </span>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!state.blueprintName.trim()}
                  className="btn-primary"
                >
                  <span>Forge Blueprint</span>
                </button>
                <button
                  onClick={() => dispatch({ type: "GO_TO_STEP", payload: 3 })}
                  className="btn-ghost"
                >
                  <span>Back to Steps</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Start Over button */}
      {state.currentStep > 0 && !state.loading && (
        <div className="flex justify-end">
          <button
            onClick={() => dispatch({ type: "RESET" })}
            className="btn-subtle"
          >
            Start Over
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-gold/30 text-sm font-cinzel">ᛗ</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Blueprint list */}
      <div>
        <h2 className="heading-norse text-sm mb-3">Saved Blueprints</h2>
        <BlueprintList
          blueprints={initialBlueprints}
          onRefresh={() => router.refresh()}
        />
      </div>
    </div>
  );
}
