"use client";

import Link from "next/link";
import type {
  BackupCoverageDashboard,
  BackupCoveragePolicyCard,
} from "@/lib/backups/dashboard-coverage";

function formatDate(value: string | null): string {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

function statusTone(status: string): string {
  switch (status) {
    case "HEALTHY":
      return "text-emerald-400 border-emerald-700/20 bg-emerald-900/[0.04]";
    case "WARNING":
    case "DEGRADED":
    case "FAILED":
      return "text-gold-bright border-ember/30 bg-ember/[0.04]";
    case "CRITICAL":
    case "NEVER_RUN":
      return "text-red-400 border-red-700/25 bg-red-900/[0.05]";
    case "OFF":
      return "text-text-dim border-[rgba(201,147,58,0.1)] bg-void/50";
    default:
      return "text-text border-[rgba(201,147,58,0.1)] bg-void/50";
  }
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-deep p-4">
      <p className={`font-cinzel text-xl tracking-wide ${tone ?? "text-gold-bright"}`}>
        {value}
      </p>
      <p className="mt-1 font-inconsolata text-[9px] uppercase tracking-[0.22em] text-text-dim">
        {label}
      </p>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className={`border px-2 py-1 ${statusTone(value)}`}>
      <p className="font-inconsolata text-[8px] uppercase tracking-[0.16em] text-text-dim">
        {label}
      </p>
      <p className="mt-1 font-inconsolata text-[10px] uppercase tracking-[0.14em]">
        {value.replace(/_/g, " ")}
      </p>
    </div>
  );
}

function PolicyCard({ policy }: { policy: BackupCoveragePolicyCard }) {
  return (
    <article className="bg-deep p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-cinzel text-sm uppercase tracking-[0.18em] text-text">
            {policy.name}
          </h3>
          <p className="mt-1 font-inconsolata text-[10px] leading-relaxed text-text-dim">
            {policy.databaseServer}
          </p>
        </div>
        <div className={`border px-2 py-1 font-inconsolata text-[9px] uppercase tracking-[0.14em] ${statusTone(policy.coverageStatus)}`}>
          {policy.coverageStatus.replace(/_/g, " ")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[rgba(201,147,58,0.08)]">
        <StatusPill label="Full" value={policy.fullBackupStatus} />
        <StatusPill label="WAL/PITR" value={policy.walPitrStatus} />
      </div>

      <div className="grid grid-cols-1 gap-2 font-inconsolata text-[10px] text-text-dim sm:grid-cols-2">
        <div>
          <span className="block uppercase tracking-[0.16em] text-text-dim/80">Storage</span>
          <span className="text-text">{policy.storageTarget}</span>
          <span className="block uppercase tracking-[0.12em] text-gold">{policy.storageProvider}</span>
        </div>
        <div>
          <span className="block uppercase tracking-[0.16em] text-text-dim/80">Last Success</span>
          <span className="text-text">{formatDate(policy.lastSuccessfulRun)}</span>
        </div>
        <div>
          <span className="block uppercase tracking-[0.16em] text-text-dim/80">Last Failure</span>
          <span className={policy.lastFailure ? "text-gold-bright" : "text-text"}>
            {policy.lastFailure ? formatDate(policy.lastFailure.startedAt) : "None"}
          </span>
        </div>
        <div>
          <span className="block uppercase tracking-[0.16em] text-text-dim/80">Next Run</span>
          <span className="text-text">
            {policy.nextRun ? `${policy.nextRunType} - ${formatDate(policy.nextRun)}` : "None scheduled"}
          </span>
        </div>
      </div>

      <p className="border-t border-[rgba(201,147,58,0.08)] pt-3 font-inconsolata text-[10px] leading-relaxed text-text-dim">
        {policy.coverageReason}
      </p>
    </article>
  );
}

export function BackupCoverageWidget({ coverage }: { coverage: BackupCoverageDashboard }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="label-norse !mb-0 text-gold">Niflheim Backup Coverage</h2>
        <div className="h-px flex-1 bg-border" />
        <Link href="/backups" className="btn-ghost px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
          Open Niflheim
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        <Metric label="Policies" value={coverage.totalPolicies.toLocaleString()} />
        <Metric label="Healthy" value={coverage.healthyPolicies.toLocaleString()} tone="text-emerald-400" />
        <Metric label="Recent Failures" value={coverage.recentFailedPolicies.toLocaleString()} tone={coverage.recentFailedPolicies > 0 ? "text-gold-bright" : "text-text-dim"} />
        <Metric label="No Full Backup" value={coverage.policiesWithNoSuccessfulFullBackup.toLocaleString()} tone={coverage.policiesWithNoSuccessfulFullBackup > 0 ? "text-red-400" : "text-text-dim"} />
        <Metric label="WAL Enabled" value={coverage.walEnabledPolicies.toLocaleString()} tone="text-frost" />
        <Metric label="Stale WAL" value={coverage.policiesMissingRecentWalRun.toLocaleString()} tone={coverage.policiesMissingRecentWalRun > 0 ? "text-gold-bright" : "text-text-dim"} />
        <Metric label="Latest Full" value={formatDate(coverage.latestFullBackupAt)} tone="text-text" />
        <Metric label="Latest WAL" value={formatDate(coverage.latestWalArchiveAt)} tone="text-text" />
      </div>

      <div className="border border-[rgba(201,147,58,0.1)] bg-void/40 px-4 py-3">
        <p className="font-inconsolata text-[10px] uppercase tracking-[0.18em] text-text-dim">
          Next scheduled backup
        </p>
        <p className="mt-1 font-inconsolata text-xs text-text">
          {coverage.nextScheduledBackupAt
            ? `${coverage.nextScheduledBackupPolicy ?? "Backup policy"} - ${formatDate(coverage.nextScheduledBackupAt)}`
            : "No backup run is scheduled."}
        </p>
      </div>

      {coverage.policies.length > 0 ? (
        <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
          {coverage.policies.map((policy) => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      ) : (
        <div className="border border-border bg-deep p-6 text-center">
          <p className="font-inconsolata text-xs tracking-wide text-text-dim">
            No Niflheim backup policies have been configured.
          </p>
        </div>
      )}
    </section>
  );
}
