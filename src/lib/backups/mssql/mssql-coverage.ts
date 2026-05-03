import { frequencyWindowMs, graceWindowMs } from "@/lib/backups/schedule";

export type MssqlCoverageStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "NEVER_RUN" | "UNSUPPORTED";

export interface MssqlCoveragePolicy {
  fullFrequency: string;
  differentialFrequency: string | null;
  logFrequency: string | null;
  lastSuccessfulFullAt: Date | string | null;
  lastSuccessfulDiffAt: Date | string | null;
  lastSuccessfulLogAt: Date | string | null;
}

export interface MssqlCoverageRun {
  status: string;
  triggeredBy: string;
  startedAt: Date | string;
  type?: string;
}

export interface MssqlCoverageResult {
  status: MssqlCoverageStatus;
  reason: string;
  fullIsCurrent: boolean;
  differentialIsCurrent: boolean | null;
  logIsCurrent: boolean | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCurrent(value: Date | string | null | undefined, frequency: string | null | undefined, now: Date): boolean {
  const date = asDate(value);
  if (!date || !frequency) return false;
  const allowedAge = frequencyWindowMs(frequency) + graceWindowMs(frequency);
  return now.getTime() - date.getTime() <= allowedAge;
}

export function computeMssqlBackupCoverage(
  policy: MssqlCoveragePolicy,
  latestRun?: MssqlCoverageRun | null,
  options: { logUnsupported?: boolean } = {},
  now: Date = new Date()
): MssqlCoverageResult {
  if (options.logUnsupported) {
    return {
      status: "UNSUPPORTED",
      reason: "Transaction log backups require FULL or BULK_LOGGED recovery model",
      fullIsCurrent: isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now),
      differentialIsCurrent: policy.differentialFrequency
        ? isCurrent(policy.lastSuccessfulDiffAt, policy.differentialFrequency, now)
        : null,
      logIsCurrent: false,
    };
  }

  if (latestRun?.status === "FAILED" && latestRun.triggeredBy === "schedule") {
    return {
      status: "FAILED",
      reason: "Latest scheduled SQL Server backup run failed",
      fullIsCurrent: isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now),
      differentialIsCurrent: policy.differentialFrequency
        ? isCurrent(policy.lastSuccessfulDiffAt, policy.differentialFrequency, now)
        : null,
      logIsCurrent: policy.logFrequency ? isCurrent(policy.lastSuccessfulLogAt, policy.logFrequency, now) : null,
    };
  }

  if (!policy.lastSuccessfulFullAt) {
    return {
      status: "NEVER_RUN",
      reason: "No successful full SQL Server backup has been recorded",
      fullIsCurrent: false,
      differentialIsCurrent: policy.differentialFrequency ? false : null,
      logIsCurrent: policy.logFrequency ? false : null,
    };
  }

  const fullIsCurrent = isCurrent(policy.lastSuccessfulFullAt, policy.fullFrequency, now);
  if (!fullIsCurrent) {
    return {
      status: "DEGRADED",
      reason: "Last successful full backup is outside the configured coverage window",
      fullIsCurrent,
      differentialIsCurrent: policy.differentialFrequency
        ? isCurrent(policy.lastSuccessfulDiffAt, policy.differentialFrequency, now)
        : null,
      logIsCurrent: policy.logFrequency ? isCurrent(policy.lastSuccessfulLogAt, policy.logFrequency, now) : null,
    };
  }

  if (policy.differentialFrequency && !isCurrent(policy.lastSuccessfulDiffAt, policy.differentialFrequency, now)) {
    return {
      status: "DEGRADED",
      reason: "Full backup is current, but differential backup coverage is stale or missing",
      fullIsCurrent,
      differentialIsCurrent: false,
      logIsCurrent: policy.logFrequency ? isCurrent(policy.lastSuccessfulLogAt, policy.logFrequency, now) : null,
    };
  }

  if (policy.logFrequency && !isCurrent(policy.lastSuccessfulLogAt, policy.logFrequency, now)) {
    return {
      status: "DEGRADED",
      reason: "Full backup is current, but transaction log backup coverage is stale or missing",
      fullIsCurrent,
      differentialIsCurrent: policy.differentialFrequency ? true : null,
      logIsCurrent: false,
    };
  }

  return {
    status: "HEALTHY",
    reason: "SQL Server backup coverage is current",
    fullIsCurrent,
    differentialIsCurrent: policy.differentialFrequency ? true : null,
    logIsCurrent: policy.logFrequency ? true : null,
  };
}
