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
  nextRun: string | null;
  nextRunType: "FULL" | "WAL" | null;
}

export interface BackupCoverageDashboard {
  totalPolicies: number;
  healthyPolicies: number;
  recentFailedPolicies: number;
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

function fullBackupStatus(
  policy: BackupCoveragePolicyInput,
  fullIsCurrent: boolean
): BackupCoveragePolicyCard["fullBackupStatus"] {
  if (!policy.lastSuccessfulFullAt) return "CRITICAL";
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

    return {
      id: policy.id,
      name: policy.name,
      enabled: policy.enabled,
      databaseServer: databaseLabel(policy),
      storageProvider: policy.storageTarget?.provider ?? "Unknown",
      storageTarget: policy.storageTarget?.name ?? "Unassigned",
      fullBackupStatus: fullBackupStatus(policy, coverage.fullIsCurrent),
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
