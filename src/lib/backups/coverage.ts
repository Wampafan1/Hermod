import { frequencyWindowMs, graceWindowMs } from "./schedule";

export type BackupCoverageStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "NEVER_RUN";

export interface BackupCoveragePolicy {
  fullFrequency: string;
  walFrequency: string | null;
  walEnabled: boolean;
  lastSuccessfulFullAt: Date | string | null;
  lastSuccessfulWalAt: Date | string | null;
}

export interface BackupCoverageRun {
  status: string;
  triggeredBy: string;
  startedAt: Date | string;
}

export interface BackupCoverageResult {
  status: BackupCoverageStatus;
  reason: string;
  fullIsCurrent: boolean;
  walIsCurrent: boolean | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCurrent(
  value: Date | string | null | undefined,
  frequency: string | null | undefined,
  now: Date
): boolean {
  const date = asDate(value);
  if (!date) return false;
  const allowedAge = frequencyWindowMs(frequency) + graceWindowMs(frequency);
  return now.getTime() - date.getTime() <= allowedAge;
}

export function computeBackupCoverage(
  policy: BackupCoveragePolicy,
  latestRun?: BackupCoverageRun | null,
  now: Date = new Date()
): BackupCoverageResult {
  if (latestRun?.status === "FAILED" && latestRun.triggeredBy === "schedule") {
    return {
      status: "FAILED",
      reason: "Latest scheduled backup run failed",
      fullIsCurrent: isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now),
      walIsCurrent: policy.walEnabled
        ? isCurrent(policy.lastSuccessfulWalAt, policy.walFrequency, now)
        : null,
    };
  }

  if (latestRun?.status === "PARTIAL" && latestRun.triggeredBy === "schedule") {
    return {
      status: "DEGRADED",
      reason: "Latest scheduled backup run was partial",
      fullIsCurrent: isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now),
      walIsCurrent: policy.walEnabled
        ? isCurrent(policy.lastSuccessfulWalAt, policy.walFrequency, now)
        : null,
    };
  }

  if (!policy.lastSuccessfulFullAt) {
    return {
      status: "NEVER_RUN",
      reason: "No successful full backup has been recorded",
      fullIsCurrent: false,
      walIsCurrent: policy.walEnabled ? false : null,
    };
  }

  const fullIsCurrent = isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now);
  if (!fullIsCurrent) {
    return {
      status: "DEGRADED",
      reason: "Last successful full backup is outside the configured coverage window",
      fullIsCurrent,
      walIsCurrent: policy.walEnabled
        ? isCurrent(policy.lastSuccessfulWalAt, policy.walFrequency, now)
        : null,
    };
  }

  if (policy.walEnabled) {
    const walIsCurrent = isCurrent(policy.lastSuccessfulWalAt, policy.walFrequency, now);
    if (!walIsCurrent) {
      return {
        status: "DEGRADED",
        reason: "Full backup is current, but WAL/PITR coverage is stale or missing",
        fullIsCurrent,
        walIsCurrent,
      };
    }
  }

  return {
    status: "HEALTHY",
    reason: policy.walEnabled
      ? "Full backup and WAL/PITR coverage are current"
      : "Full backup coverage is current",
    fullIsCurrent,
    walIsCurrent: policy.walEnabled ? true : null,
  };
}
