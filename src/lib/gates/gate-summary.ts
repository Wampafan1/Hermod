import type { KeyDriftDetails } from "@/lib/gates/push-executor";

export interface GateSummaryPush {
  status: string;
  rowCount?: number | null;
  rowsInserted?: number | null;
  rowsUpdated?: number | null;
  rowsErrored?: number | null;
  blankRowsSkipped?: number | null;
  errorMessage?: string | null;
  keyDrift?: Partial<KeyDriftDetails> | null;
}

export interface GateSummaryInput {
  targetSchema?: string | null;
  targetTable: string;
  mergeStrategy: string;
  primaryKeyColumns?: unknown;
  latestPush?: GateSummaryPush | null;
}

export interface GateSummary {
  overview: string;
  target: string;
  currentKey: string;
  mergeStrategy: string;
  latestPushResult: string;
  recommendedNextAction: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function humanizeGateColumnName(column: string): string {
  return column
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (part.length === 0) return part;
      if (/^\d+$/.test(part)) return part;
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function formatGateTarget(input: Pick<GateSummaryInput, "targetSchema" | "targetTable">): string {
  return input.targetSchema ? `${input.targetSchema}.${input.targetTable}` : input.targetTable;
}

export function formatGateMergeStrategy(strategy: string): string {
  return strategy.replace(/_/g, " ").toUpperCase();
}

export function formatGateKey(primaryKeyColumns: unknown): string {
  const columns = asStringArray(primaryKeyColumns);
  if (columns.length === 0) return "No key configured";
  return columns.map(humanizeGateColumnName).join(" + ");
}

function formatRows(count?: number | null): string {
  const safeCount = typeof count === "number" && Number.isFinite(count) ? count : 0;
  return `${safeCount.toLocaleString()} ${safeCount === 1 ? "row" : "rows"}`;
}

function incompleteRowsExcluded(keyDrift?: Partial<KeyDriftDetails> | null): number {
  return typeof keyDrift?.incompleteRowsExcluded === "number"
    ? keyDrift.incompleteRowsExcluded
    : 0;
}

function blankOnlyKeyDrift(keyDrift?: Partial<KeyDriftDetails> | null): boolean {
  return (
    keyDrift?.driftType === "BLANK_KEY" &&
    (keyDrift.duplicateExamples?.length ?? 0) === 0
  );
}

function duplicateKeyDrift(keyDrift?: Partial<KeyDriftDetails> | null): boolean {
  return (
    keyDrift?.driftType === "DUPLICATE_KEY" ||
    keyDrift?.driftType === "DUPLICATE_AND_BLANK_KEY" ||
    (keyDrift?.duplicateExamples?.length ?? 0) > 0
  );
}

function buildPushSummary(push?: GateSummaryPush | null): Pick<GateSummary, "latestPushResult" | "recommendedNextAction" | "tone"> {
  if (!push) {
    return {
      latestPushResult: "No pushes have run yet.",
      recommendedNextAction: "Upload a file when you are ready to push updates.",
      tone: "neutral",
    };
  }

  switch (push.status) {
    case "SUCCESS": {
      const excluded = incompleteRowsExcluded(push.keyDrift);
      const excludedCopy = excluded > 0
        ? ` ${excluded.toLocaleString()} incomplete ${excluded === 1 ? "row was" : "rows were"} excluded after review.`
        : "";
      return {
        latestPushResult: `The latest push loaded ${formatRows(push.rowCount)} successfully.${excludedCopy}`,
        recommendedNextAction: "No review is needed for the latest push.",
        tone: "success",
      };
    }
    case "PARTIAL":
      return {
        latestPushResult: "The latest push partially loaded. Some rows failed and Hermod did not mark it as successful.",
        recommendedNextAction: "Review the failed row count and destination error before uploading again.",
        tone: "warning",
      };
    case "FAILED":
      return {
        latestPushResult: push.errorMessage
          ? `The latest push failed. ${push.errorMessage}`
          : "The latest push failed.",
        recommendedNextAction: "Review the failure and retry with a corrected file or destination.",
        tone: "danger",
      };
    case "KEY_DRIFT":
      if (blankOnlyKeyDrift(push.keyDrift)) {
        return {
          latestPushResult: "The current key is still unique for business rows, but some rows are missing key values. Review and exclude those rows, or fix the file.",
          recommendedNextAction: "Approve reviewed incomplete-row exclusion, or cancel and upload a corrected file.",
          tone: "warning",
        };
      }
      if (duplicateKeyDrift(push.keyDrift)) {
        return {
          latestPushResult: "Hermod found duplicate rows under the current key. A stronger key is required before this file can be loaded.",
          recommendedNextAction: "Review the recommended key and DDL preview before approving key hardening.",
          tone: "warning",
        };
      }
      return {
        latestPushResult: "The latest upload needs key review before it can be loaded.",
        recommendedNextAction: "Review the key drift evidence before approving or cancelling the staged upload.",
        tone: "warning",
      };
    case "SCHEMA_DRIFT":
      return {
        latestPushResult: "The latest upload needs schema review before it can be loaded.",
        recommendedNextAction: "Choose whether to adjust the file or update the destination schema.",
        tone: "warning",
      };
    case "VALIDATED":
      return {
        latestPushResult: `The latest upload is validated and ready to push ${formatRows(push.rowCount)}.`,
        recommendedNextAction: "Push the staged upload when you are ready.",
        tone: "info",
      };
    case "VALIDATING":
      return {
        latestPushResult: "The latest upload is still being validated.",
        recommendedNextAction: "Wait for validation to finish, or clear the staged upload if it is no longer needed.",
        tone: "info",
      };
    case "CANCELLED":
      return {
        latestPushResult: "The latest staged upload was cancelled.",
        recommendedNextAction: "Upload a corrected file when ready.",
        tone: "neutral",
      };
    default:
      return {
        latestPushResult: `The latest push is ${push.status.replace(/_/g, " ").toLowerCase()}.`,
        recommendedNextAction: "Review the latest push status before continuing.",
        tone: "neutral",
      };
  }
}

export function buildGateSummary(input: GateSummaryInput): GateSummary {
  const target = formatGateTarget(input);
  const currentKey = formatGateKey(input.primaryKeyColumns);
  const mergeStrategy = formatGateMergeStrategy(input.mergeStrategy);
  const pushSummary = buildPushSummary(input.latestPush);

  return {
    overview: `This gate loads updated files into ${target} using ${mergeStrategy}. Rows are matched by ${currentKey}.`,
    target,
    currentKey,
    mergeStrategy,
    latestPushResult: pushSummary.latestPushResult,
    recommendedNextAction: pushSummary.recommendedNextAction,
    tone: pushSummary.tone,
  };
}
