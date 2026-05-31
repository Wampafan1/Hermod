import { computeBackupCoverage } from "@/lib/backups/coverage";

export interface BackupCoverageRunInput {
  type: string;
  status: string;
  triggeredBy: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  error?: string | null;
}

export interface BackupCoveragePolicyInput {
  id: string;
  name: string;
  enabled: boolean;
  status?: string | null;
  fullFrequency: string;
  walFrequency: string | null;
  walEnabled: boolean;
  lastSuccessfulFullAt: Date | string | null;
  lastSuccessfulWalAt: Date | string | null;
  nextFullRunAt: Date | string | null;
  nextWalRunAt: Date | string | null;
  databaseSelectionMode?: string | null;
  selectedDatabases?: string[] | null;
  databasePattern?: string | null;
  sourceConnection?: {
    name: string;
    type?: string | null;
  } | null;
  storageTarget?: {
    name: string;
    provider: string;
    status?: string | null;
  } | null;
  latestRun?: BackupCoverageRunInput | null;
  latestFailedRun?: BackupCoverageRunInput | null;
  latestPartialRun?: BackupCoverageRunInput | null;
  latestProblemRun?: BackupCoverageRunInput | null;
}

export interface BackupPartialFailures {
  count: number;
  databases: string[];
}

export interface BackupProblemRunSummary {
  status: string;
  type: string;
  startedAt: string;
  error: string | null;
  partialFailures: BackupPartialFailures;
}

export interface BackupCoveragePolicyCard {
  id: string;
  name: string;
  enabled: boolean;
  databaseServer: string;
  storageProvider: string;
  storageTarget: string;
  fullBackupStatus: "HEALTHY" | "WARNING" | "CRITICAL";
  walPitrStatus: "HEALTHY" | "WARNING" | "OFF";
  coverageStatus: string;
  coverageReason: string;
  lastSuccessfulRun: string | null;
  lastSuccessfulFullAt: string | null;
  lastSuccessfulWalAt: string | null;
  lastFailure: {
    status: string;
    type: string;
    startedAt: string;
    error: string | null;
  } | null;
  latestProblemRun: BackupProblemRunSummary | null;
  nextRun: string | null;
  nextRunType: "FULL" | "WAL" | null;
}

export interface BackupCoverageDashboard {
  totalPolicies: number;
  healthyPolicies: number;
  recentFailedPolicies: number;
  recentPartialPolicies: number;
  recentProblemPolicies: number;
  policiesWithNoSuccessfulFullBackup: number;
  walEnabledPolicies: number;
  policiesMissingRecentWalRun: number;
  latestFullBackupAt: string | null;
  latestWalArchiveAt: string | null;
  nextScheduledBackupAt: string | null;
  nextScheduledBackupPolicy: string | null;
  policies: BackupCoveragePolicyCard[];
}

const RECENT_FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PARTIAL_FAILURE_PREFIX = "One or more databases failed to back up:";
const PARTIAL_FAILURE_DATABASE_LIMIT = 6;
const PARTIAL_FAILURE_LABEL_PATTERN = /^([A-Za-z0-9_.-]{1,128}):\s/;

const EMPTY_PARTIAL_FAILURES: BackupPartialFailures = {
  count: 0,
  databases: [],
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateMs(value: Date | string | null | undefined): number | null {
  const iso = toIso(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function latestIso(values: Array<Date | string | null | undefined>): string | null {
  let latest: number | null = null;
  for (const value of values) {
    const ms = dateMs(value);
    if (ms == null) continue;
    latest = latest == null || ms > latest ? ms : latest;
  }
  return latest == null ? null : new Date(latest).toISOString();
}

function databaseLabel(policy: BackupCoveragePolicyInput): string {
  const mode = policy.databaseSelectionMode ?? "SINGLE";
  if (mode === "ALL_USER_DATABASES") return `All user databases on ${policy.sourceConnection?.name ?? "Postgres"}`;
  if (mode === "MULTIPLE") {
    const names = policy.selectedDatabases ?? [];
    return `${names.length > 0 ? names.join(", ") : "Selected databases"} on ${policy.sourceConnection?.name ?? "Postgres"}`;
  }
  if (mode === "PATTERN") {
    return `Pattern ${policy.databasePattern ?? "*"} on ${policy.sourceConnection?.name ?? "Postgres"}`;
  }
  const selected = policy.selectedDatabases?.[0];
  return `${selected ?? policy.sourceConnection?.name ?? "Postgres"} on ${policy.sourceConnection?.name ?? "Postgres"}`;
}

function nextRun(policy: BackupCoveragePolicyInput): { at: string | null; type: "FULL" | "WAL" | null } {
  const fullMs = dateMs(policy.nextFullRunAt);
  const walMs = policy.walEnabled ? dateMs(policy.nextWalRunAt) : null;
  if (fullMs == null && walMs == null) return { at: null, type: null };
  if (walMs != null && (fullMs == null || walMs < fullMs)) {
    return { at: new Date(walMs).toISOString(), type: "WAL" };
  }
  return { at: fullMs == null ? null : new Date(fullMs).toISOString(), type: "FULL" };
}

function lastSuccessfulRun(policy: BackupCoveragePolicyInput): string | null {
  return latestIso([policy.lastSuccessfulFullAt, policy.lastSuccessfulWalAt]);
}

function isRecentFailure(
  run: BackupCoverageRunInput | null | undefined,
  now: Date
): boolean {
  const startedMs = dateMs(run?.startedAt);
  return run?.status === "FAILED" &&
    startedMs != null &&
    now.getTime() - startedMs <= RECENT_FAILURE_WINDOW_MS;
}

function isScheduledPartial(run: BackupCoverageRunInput | null | undefined): run is BackupCoverageRunInput {
  return run?.status === "PARTIAL" && run.triggeredBy === "schedule";
}

function isScheduledPartialFull(run: BackupCoverageRunInput | null | undefined): boolean {
  return isScheduledPartial(run) && run?.type === "FULL_LOGICAL";
}

function isScheduledProblem(run: BackupCoverageRunInput | null | undefined): run is BackupCoverageRunInput {
  return run?.triggeredBy === "schedule" && (run.status === "FAILED" || run.status === "PARTIAL");
}

function isRecentProblem(
  run: BackupCoverageRunInput | null | undefined,
  now: Date
): boolean {
  const startedMs = dateMs(run?.startedAt);
  return isScheduledProblem(run) &&
    startedMs != null &&
    now.getTime() - startedMs <= RECENT_FAILURE_WINDOW_MS;
}

function latestByStartedAt(runs: BackupCoverageRunInput[]): BackupCoverageRunInput | null {
  let latest: BackupCoverageRunInput | null = null;
  let latestMs: number | null = null;
  for (const run of runs) {
    const startedMs = dateMs(run.startedAt);
    if (startedMs == null) continue;
    if (latestMs == null || startedMs > latestMs) {
      latest = run;
      latestMs = startedMs;
    }
  }
  return latest;
}

function latestPartialRun(policy: BackupCoveragePolicyInput): BackupCoverageRunInput | null {
  return latestByStartedAt([
    policy.latestRun,
    policy.latestPartialRun,
    policy.latestProblemRun?.status === "PARTIAL" ? policy.latestProblemRun : null,
  ].filter(isScheduledPartial));
}

function latestProblemRun(policy: BackupCoveragePolicyInput): BackupCoverageRunInput | null {
  return latestByStartedAt([
    policy.latestRun,
    policy.latestFailedRun,
    policy.latestPartialRun,
    policy.latestProblemRun,
  ].filter(isScheduledProblem));
}

export function parsePartialBackupFailures(error: string | null | undefined): BackupPartialFailures {
  if (!error) return EMPTY_PARTIAL_FAILURES;
  const prefixIndex = error.indexOf(PARTIAL_FAILURE_PREFIX);
  if (prefixIndex === -1) return EMPTY_PARTIAL_FAILURES;

  const details = error.slice(prefixIndex + PARTIAL_FAILURE_PREFIX.length);
  const seen = new Set<string>();
  const databases: string[] = [];
  for (const segment of details.split(";")) {
    const match = segment.trim().match(PARTIAL_FAILURE_LABEL_PATTERN);
    if (!match) continue;
    const database = match[1];
    if (seen.has(database)) continue;
    seen.add(database);
    if (databases.length < PARTIAL_FAILURE_DATABASE_LIMIT) {
      databases.push(database);
    }
  }

  return {
    count: seen.size,
    databases,
  };
}

function summarizeProblemRun(run: BackupCoverageRunInput | null): BackupProblemRunSummary | null {
  if (!run) return null;
  return {
    status: run.status,
    type: run.type,
    startedAt: toIso(run.startedAt)!,
    error: run.error ?? null,
    partialFailures: run.status === "PARTIAL"
      ? parsePartialBackupFailures(run.error)
      : EMPTY_PARTIAL_FAILURES,
  };
}

function fullBackupStatus(
  policy: BackupCoveragePolicyInput,
  fullIsCurrent: boolean,
  latestRun?: BackupCoverageRunInput | null
): BackupCoveragePolicyCard["fullBackupStatus"] {
  if (!policy.lastSuccessfulFullAt) return "CRITICAL";
  if (isScheduledPartialFull(latestRun)) return "WARNING";
  return fullIsCurrent ? "HEALTHY" : "WARNING";
}

function walPitrStatus(
  policy: BackupCoveragePolicyInput,
  walIsCurrent: boolean | null
): BackupCoveragePolicyCard["walPitrStatus"] {
  if (!policy.walEnabled) return "OFF";
  return walIsCurrent ? "HEALTHY" : "WARNING";
}

export function buildBackupCoverageDashboard(
  policies: BackupCoveragePolicyInput[],
  now: Date = new Date()
): BackupCoverageDashboard {
  const cards = policies.map((policy) => {
    const coverage = computeBackupCoverage(policy, policy.latestRun ?? null, now);
    const scheduledNextRun = nextRun(policy);
    const latestFailure = policy.latestFailedRun ?? null;
    const problemRun = latestProblemRun(policy);

    return {
      id: policy.id,
      name: policy.name,
      enabled: policy.enabled,
      databaseServer: databaseLabel(policy),
      storageProvider: policy.storageTarget?.provider ?? "Unknown",
      storageTarget: policy.storageTarget?.name ?? "Unassigned",
      fullBackupStatus: fullBackupStatus(policy, coverage.fullIsCurrent, policy.latestRun),
      walPitrStatus: walPitrStatus(policy, coverage.walIsCurrent),
      coverageStatus: coverage.status,
      coverageReason: coverage.reason,
      lastSuccessfulRun: lastSuccessfulRun(policy),
      lastSuccessfulFullAt: toIso(policy.lastSuccessfulFullAt),
      lastSuccessfulWalAt: toIso(policy.lastSuccessfulWalAt),
      lastFailure: latestFailure
        ? {
            status: latestFailure.status,
            type: latestFailure.type,
            startedAt: toIso(latestFailure.startedAt)!,
            error: latestFailure.error ?? null,
          }
        : null,
      latestProblemRun: summarizeProblemRun(problemRun),
      nextRun: scheduledNextRun.at,
      nextRunType: scheduledNextRun.type,
    } satisfies BackupCoveragePolicyCard;
  });

  const nextScheduled = cards
    .filter((policy) => policy.nextRun)
    .sort((a, b) => Date.parse(a.nextRun!) - Date.parse(b.nextRun!))[0] ?? null;

  return {
    totalPolicies: cards.length,
    healthyPolicies: cards.filter((policy) => policy.coverageStatus === "HEALTHY").length,
    recentFailedPolicies: policies.filter((policy) => isRecentFailure(policy.latestFailedRun, now)).length,
    recentPartialPolicies: policies.filter((policy) => isRecentProblem(latestPartialRun(policy), now)).length,
    recentProblemPolicies: policies.filter((policy) => isRecentProblem(latestProblemRun(policy), now)).length,
    policiesWithNoSuccessfulFullBackup: policies.filter((policy) => !policy.lastSuccessfulFullAt).length,
    walEnabledPolicies: policies.filter((policy) => policy.walEnabled).length,
    policiesMissingRecentWalRun: cards.filter((policy) => policy.walPitrStatus === "WARNING").length,
    latestFullBackupAt: latestIso(policies.map((policy) => policy.lastSuccessfulFullAt)),
    latestWalArchiveAt: latestIso(policies.map((policy) => policy.lastSuccessfulWalAt)),
    nextScheduledBackupAt: nextScheduled?.nextRun ?? null,
    nextScheduledBackupPolicy: nextScheduled?.name ?? null,
    policies: cards,
  };
}
