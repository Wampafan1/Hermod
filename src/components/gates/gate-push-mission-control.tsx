"use client";

import type { KeyDriftDetails } from "@/components/gates/key-drift-review-panel";

export type MissionStageState = "complete" | "active" | "pending" | "review" | "failed";

export interface MissionControlPush {
  id: string;
  fileName?: string | null;
  fileSize?: number | null;
  status: string;
  rowCount?: number | null;
  rowsInserted?: number | null;
  rowsUpdated?: number | null;
  rowsErrored?: number | null;
  blankRowsSkipped?: number | null;
  keyDrift?: KeyDriftDetails | null;
  duration?: number | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  validationStage?: string | null;
  validationStartedAt?: string | null;
  validationHeartbeatAt?: string | null;
  validationTimeoutAt?: string | null;
}

export interface MissionTimelineStage {
  id: string;
  label: string;
  state: MissionStageState;
  icon: string;
  detail?: string;
  timestamp?: string | null;
  durationMs?: number | null;
}

export interface MissionSummaryCard {
  label: string;
  value: string;
  tone: "neutral" | "good" | "info" | "warn" | "danger";
}

const VALIDATION_STAGE_ORDER = [
  "RECEIVED",
  "READING_FILE",
  "ANALYZING_FILE",
  "VALIDATING_SCHEMA",
  "CHECKING_KEY",
  "DISCOVERING_KEY",
  "READY",
  "FAILED",
] as const;

const TERMINAL_STATUSES = new Set(["SUCCESS", "PARTIAL", "FAILED", "CANCELLED"]);

function validationStageRank(stage?: string | null): number {
  if (!stage) return -1;
  return VALIDATION_STAGE_ORDER.indexOf(stage as (typeof VALIDATION_STAGE_ORDER)[number]);
}

function hasReachedValidationStage(
  currentStage: string | null | undefined,
  targetStage: (typeof VALIDATION_STAGE_ORDER)[number]
): boolean {
  const currentRank = validationStageRank(currentStage);
  const targetRank = validationStageRank(targetStage);
  return currentRank >= targetRank;
}

function formatNumber(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "0";
}

export function formatMissionDuration(durationMs?: number | null): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return "Pending";
  }
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatMissionTimestamp(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMissionValidationStage(stage?: string | null): string {
  switch (stage) {
    case "RECEIVED":
      return "Upload staged";
    case "READING_FILE":
      return "Reading staged file";
    case "ANALYZING_FILE":
      return "Analyzing file";
    case "VALIDATING_SCHEMA":
      return "Validating schema";
    case "CHECKING_KEY":
      return "Checking UPSERT key";
    case "DISCOVERING_KEY":
      return "Finding stronger key";
    case "READY":
      return "Ready";
    case "FAILED":
      return "Validation failed";
    default:
      return "Waiting for worker";
  }
}

function stageIcon(state: MissionStageState): string {
  switch (state) {
    case "complete":
      return "+";
    case "active":
      return ">";
    case "review":
      return "!";
    case "failed":
      return "x";
    default:
      return ".";
  }
}

function isReviewStatus(status: string): boolean {
  return status === "KEY_DRIFT" || status === "SCHEMA_DRIFT";
}

function finalStageLabel(status: string): string {
  if (status === "SUCCESS") return "Push complete";
  if (status === "PARTIAL") return "Partial push";
  if (status === "FAILED") return "Push failed";
  if (status === "CANCELLED") return "Cancelled";
  return "Final result";
}

function reviewStageLabel(status: string): string {
  if (status === "KEY_DRIFT" || status === "SCHEMA_DRIFT") return "Review needed";
  if (status === "VALIDATED") return "Ready to push";
  if (status === "PUSHING") return "Pushing";
  if (TERMINAL_STATUSES.has(status)) return "Pushed";
  return "Review or ready";
}

function activeElapsedMs(push: MissionControlPush, now: number): number | null {
  const started = push.validationStartedAt ?? push.createdAt;
  if (!started) return null;
  const startedMs = Date.parse(started);
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, now - startedMs);
}

export function buildGatePushTimeline(
  push: MissionControlPush | null,
  now = Date.now()
): MissionTimelineStage[] {
  if (!push) {
    return [
      { id: "upload", label: "Upload staged", state: "pending", icon: "." },
      { id: "file", label: "File analyzed", state: "pending", icon: "." },
      { id: "schema", label: "Schema checked", state: "pending", icon: "." },
      { id: "key", label: "Key checked", state: "pending", icon: "." },
      { id: "review", label: "Review or ready", state: "pending", icon: "." },
      { id: "final", label: "Final result", state: "pending", icon: "." },
    ];
  }

  const status = push.status;
  const validationStage = push.validationStage;
  const validating = status === "VALIDATING";
  const terminal = TERMINAL_STATUSES.has(status);
  const failed = status === "FAILED";
  const review = isReviewStatus(status);
  const readyOrPushing = status === "VALIDATED" || status === "PUSHING";
  const activeElapsed = validating ? activeElapsedMs(push, now) : null;

  const fileState: MissionStageState = validating && validationStage === "ANALYZING_FILE"
    ? "active"
    : !validating || hasReachedValidationStage(validationStage, "VALIDATING_SCHEMA")
      ? "complete"
      : "pending";
  const schemaState: MissionStageState = validating && validationStage === "VALIDATING_SCHEMA"
    ? "active"
    : status === "SCHEMA_DRIFT" || review || readyOrPushing || terminal || hasReachedValidationStage(validationStage, "CHECKING_KEY")
      ? "complete"
      : "pending";
  const keyState: MissionStageState =
    validating && (validationStage === "CHECKING_KEY" || validationStage === "DISCOVERING_KEY")
      ? "active"
      : status === "KEY_DRIFT" || readyOrPushing || terminal
        ? "complete"
        : "pending";
  const reviewState: MissionStageState = failed
    ? "failed"
    : review
      ? "review"
      : readyOrPushing
        ? "active"
        : terminal
          ? "complete"
          : "pending";
  const finalState: MissionStageState = failed
    ? "failed"
    : status === "PARTIAL"
      ? "review"
      : status === "SUCCESS" || status === "CANCELLED"
        ? "complete"
        : status === "PUSHING"
          ? "active"
          : "pending";

  const stages: MissionTimelineStage[] = [
    {
      id: "upload",
      label: "Upload staged",
      state: "complete",
      icon: "+",
      detail: push.fileName ?? "Staged file",
      timestamp: push.createdAt,
    },
    {
      id: "file",
      label: "File analyzed",
      state: fileState,
      icon: stageIcon(fileState),
      detail: validating && validationStage === "ANALYZING_FILE"
        ? "Worker is profiling the staged file"
        : undefined,
      timestamp: validationStage === "ANALYZING_FILE" ? push.validationHeartbeatAt : undefined,
      durationMs: validationStage === "ANALYZING_FILE" ? activeElapsed : undefined,
    },
    {
      id: "schema",
      label: "Schema checked",
      state: schemaState,
      icon: stageIcon(schemaState),
      detail: validating && validationStage === "VALIDATING_SCHEMA"
        ? "Comparing file schema to destination"
        : undefined,
      timestamp: validationStage === "VALIDATING_SCHEMA" ? push.validationHeartbeatAt : undefined,
      durationMs: validationStage === "VALIDATING_SCHEMA" ? activeElapsed : undefined,
    },
    {
      id: "key",
      label: "Key checked",
      state: keyState,
      icon: stageIcon(keyState),
      detail: validating && (validationStage === "CHECKING_KEY" || validationStage === "DISCOVERING_KEY")
        ? formatMissionValidationStage(validationStage)
        : undefined,
      timestamp: validationStage === "CHECKING_KEY" || validationStage === "DISCOVERING_KEY"
        ? push.validationHeartbeatAt
        : undefined,
      durationMs: validationStage === "CHECKING_KEY" || validationStage === "DISCOVERING_KEY"
        ? activeElapsed
        : undefined,
    },
    {
      id: "review",
      label: reviewStageLabel(status),
      state: reviewState,
      icon: stageIcon(reviewState),
      detail: status === "KEY_DRIFT"
        ? "Key review is holding the upload"
        : status === "SCHEMA_DRIFT"
          ? "Schema review is holding the upload"
          : status === "VALIDATED"
            ? "Ready for reviewed execution"
            : undefined,
    },
    {
      id: "final",
      label: finalStageLabel(status),
      state: finalState,
      icon: stageIcon(finalState),
      detail: push.errorMessage ?? undefined,
      timestamp: push.completedAt,
      durationMs: push.duration,
    },
  ];

  if (validating) {
    const activeStage = stages.find((stage) => stage.state === "active");
    if (activeStage) {
      activeStage.detail = `${activeStage.detail ?? "Validation running"} - Current stage: ${formatMissionValidationStage(validationStage)}`;
    }
  }

  return stages;
}

function formatDriftType(driftType?: string): string {
  if (!driftType) return "Key review";
  return driftType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRecommendedAction(keyDrift: KeyDriftDetails): string {
  if (keyDrift.recommendedAction === "REVIEW_INCOMPLETE_ROWS") {
    return "Review incomplete rows";
  }
  if (keyDrift.recommendedAction === "HARDEN_KEY") {
    return "Harden destination key";
  }
  if (isBlankOnlyCurrentKeyDrift(keyDrift)) return "Review incomplete rows";
  if ((keyDrift.duplicateExamples?.length ?? 0) > 0) return "Harden destination key";
  return keyDrift.recommendation ? "Review recommended key" : "Review required";
}

function isBlankOnlyCurrentKeyDrift(keyDrift: KeyDriftDetails): boolean {
  return (
    keyDrift.driftType === "BLANK_KEY" &&
    (keyDrift.duplicateExamples?.length ?? 0) === 0
  );
}

function incompleteRowsHeld(keyDrift: KeyDriftDetails): number {
  if (typeof keyDrift.incompleteRowsHeld === "number") return keyDrift.incompleteRowsHeld;
  if (Array.isArray(keyDrift.incompleteRowExamples)) return keyDrift.incompleteRowExamples.length;
  return keyDrift.nullKeyExamples?.length ?? 0;
}

export function buildKeyDriftMissionSummary(
  keyDrift: KeyDriftDetails,
  blankRowsSkipped?: number | null
): MissionSummaryCard[] {
  const currentKeyCanBeKept = Boolean(keyDrift.currentKeyStillUniqueForBusinessRows) || isBlankOnlyCurrentKeyDrift(keyDrift);
  const ddlRequired = !currentKeyCanBeKept && (
    keyDrift.recommendedAction === "HARDEN_KEY" ||
    (keyDrift.duplicateExamples?.length ?? 0) > 0 ||
    (keyDrift.candidateKeys?.length ?? 0) > 0
  );

  return [
    {
      label: "Drift type",
      value: formatDriftType(keyDrift.driftType),
      tone: "warn",
    },
    {
      label: "Current key",
      value: keyDrift.oldKey?.length ? keyDrift.oldKey.join(" + ") : "Not configured",
      tone: "neutral",
    },
    {
      label: "Recommended action",
      value: formatRecommendedAction(keyDrift),
      tone: ddlRequired ? "warn" : "info",
    },
    {
      label: "Candidate count",
      value: formatNumber(keyDrift.candidateKeys?.length ?? 0),
      tone: "info",
    },
    {
      label: "Incomplete rows held",
      value: formatNumber(incompleteRowsHeld(keyDrift)),
      tone: incompleteRowsHeld(keyDrift) > 0 ? "warn" : "good",
    },
    {
      label: "Blank rows skipped",
      value: formatNumber(blankRowsSkipped ?? 0),
      tone: (blankRowsSkipped ?? 0) > 0 ? "info" : "neutral",
    },
    {
      label: "DDL required",
      value: ddlRequired ? "Yes" : "No",
      tone: ddlRequired ? "warn" : "good",
    },
    {
      label: "Current key can be kept",
      value: currentKeyCanBeKept ? "Yes" : "No",
      tone: currentKeyCanBeKept ? "good" : "warn",
    },
  ];
}

function keyDriftReviewNumber(
  keyDrift: (KeyDriftDetails & { incompleteRowsExcluded?: number }) | null | undefined
): number {
  return typeof keyDrift?.incompleteRowsExcluded === "number"
    ? keyDrift.incompleteRowsExcluded
    : 0;
}

export function buildFinalPushMissionSummary(push: MissionControlPush): MissionSummaryCard[] {
  return [
    {
      label: "Rows inserted",
      value: formatNumber(push.rowsInserted),
      tone: "good",
    },
    {
      label: "Rows updated",
      value: formatNumber(push.rowsUpdated),
      tone: "info",
    },
    {
      label: "Rows errored",
      value: formatNumber(push.rowsErrored),
      tone: (push.rowsErrored ?? 0) > 0 ? "danger" : "good",
    },
    {
      label: "Blank rows skipped",
      value: formatNumber(push.blankRowsSkipped),
      tone: (push.blankRowsSkipped ?? 0) > 0 ? "info" : "neutral",
    },
    {
      label: "Incomplete rows excluded",
      value: formatNumber(keyDriftReviewNumber(push.keyDrift)),
      tone: keyDriftReviewNumber(push.keyDrift) > 0 ? "warn" : "neutral",
    },
    {
      label: "Duration",
      value: formatMissionDuration(push.duration),
      tone: "neutral",
    },
    ...(push.status === "FAILED" && push.errorMessage
      ? [{
          label: "Failure",
          value: push.errorMessage,
          tone: "danger" as const,
        }]
      : []),
  ];
}

function toneClasses(tone: MissionSummaryCard["tone"]): string {
  switch (tone) {
    case "good":
      return "text-emerald-400 border-emerald-700/20 bg-emerald-900/[0.05]";
    case "info":
      return "text-frost border-frost/20 bg-frost/[0.04]";
    case "warn":
      return "text-gold-bright border-ember/30 bg-ember/[0.04]";
    case "danger":
      return "text-red-400 border-red-700/25 bg-red-900/[0.05]";
    default:
      return "text-text border-[rgba(201,147,58,0.1)] bg-void/50";
  }
}

function stageClasses(state: MissionStageState): string {
  switch (state) {
    case "complete":
      return "text-emerald-400 border-emerald-700/25 bg-emerald-900/[0.04]";
    case "active":
      return "text-frost border-frost/30 bg-frost/[0.05]";
    case "review":
      return "text-gold-bright border-ember/30 bg-ember/[0.05]";
    case "failed":
      return "text-red-400 border-red-700/30 bg-red-900/[0.05]";
    default:
      return "text-text-dim border-[rgba(201,147,58,0.1)] bg-void/50";
  }
}

function shouldShowFinalSummary(status: string): boolean {
  return status === "SUCCESS" || status === "PARTIAL" || status === "FAILED";
}

export function GatePushMissionControl({
  push,
  now = Date.now(),
}: {
  push: MissionControlPush | null;
  now?: number;
}) {
  const timeline = buildGatePushTimeline(push, now);
  const keySummary = push?.keyDrift ? buildKeyDriftMissionSummary(push.keyDrift, push.blankRowsSkipped) : [];
  const finalSummary = push && shouldShowFinalSummary(push.status)
    ? buildFinalPushMissionSummary(push)
    : [];
  const activeValidationStage = push?.status === "VALIDATING"
    ? formatMissionValidationStage(push.validationStage)
    : null;

  return (
    <section className="card-norse p-5 space-y-5" aria-label="Push Mission Control">
      <div className="flex flex-col gap-2 border-b border-[rgba(201,147,58,0.1)] pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="label-norse text-[9px]">Push Mission Control</p>
          <h2 className="heading-norse text-sm mt-1">Upload telemetry</h2>
        </div>
        {push ? (
          <div className="text-left md:text-right">
            <p className="font-inconsolata text-text text-xs">{push.fileName ?? "Staged upload"}</p>
            <p className="font-inconsolata text-text-dim text-[10px]">
              {activeValidationStage ? `Current stage: ${activeValidationStage}` : push.status.replace(/_/g, " ")}
            </p>
          </div>
        ) : (
          <p className="font-inconsolata text-text-dim text-[10px]">
            No upload has been staged yet.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-px bg-[rgba(201,147,58,0.08)] md:grid-cols-6">
        {timeline.map((stage) => (
          <div key={stage.id} className="bg-deep/95 p-3 min-h-[126px]">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center border font-inconsolata text-[10px] ${stageClasses(stage.state)}`}
                aria-label={`${stage.label} ${stage.state}`}
              >
                {stage.icon}
              </span>
              <span className="font-inconsolata text-[10px] uppercase tracking-[0.18em] text-text">
                {stage.label}
              </span>
            </div>
            {stage.detail && (
              <p className="mt-3 font-inconsolata text-[10px] leading-relaxed text-text-dim">
                {stage.detail}
              </p>
            )}
            <div className="mt-3 space-y-1 font-inconsolata text-[9px] uppercase tracking-[0.12em] text-text-dim">
              {stage.timestamp && <p>{formatMissionTimestamp(stage.timestamp)}</p>}
              {stage.durationMs != null && <p>{formatMissionDuration(stage.durationMs)}</p>}
            </div>
          </div>
        ))}
      </div>

      {keySummary.length > 0 && (
        <div className="space-y-3">
          <p className="label-norse text-[9px]">Key Review Summary</p>
          <div className="grid grid-cols-1 gap-px bg-[rgba(201,147,58,0.08)] sm:grid-cols-2 lg:grid-cols-4">
            {keySummary.map((card) => (
              <div key={card.label} className={`border px-3 py-3 ${toneClasses(card.tone)}`}>
                <p className="font-inconsolata text-[9px] uppercase tracking-[0.18em] text-text-dim">
                  {card.label}
                </p>
                <p className="mt-2 break-words font-inconsolata text-xs leading-relaxed">
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {finalSummary.length > 0 && (
        <div className="space-y-3">
          <p className="label-norse text-[9px]">Final Result</p>
          <div className="grid grid-cols-1 gap-px bg-[rgba(201,147,58,0.08)] sm:grid-cols-2 lg:grid-cols-4">
            {finalSummary.map((card) => (
              <div key={card.label} className={`border px-3 py-3 ${toneClasses(card.tone)}`}>
                <p className="font-inconsolata text-[9px] uppercase tracking-[0.18em] text-text-dim">
                  {card.label}
                </p>
                <p className="mt-2 break-words font-inconsolata text-xs leading-relaxed">
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
