export const STALE_ROUTE_LOG_MS = 15 * 60_000;
export const STALE_POSTGRES_BACKUP_RUN_MS = 75 * 60_000;
export const STALE_MSSQL_BACKUP_RUN_MS = 125 * 60_000;
export const STALE_POSTGRES_RESTORE_JOB_MS = 75 * 60_000;

export type WorkerJobKind =
  | "report"
  | "route"
  | "postgres-full"
  | "postgres-wal"
  | "postgres-restore"
  | "mssql-full"
  | "mssql-differential"
  | "mssql-log";

export function buildJobSingletonKey(kind: WorkerJobKind, id: string): string {
  switch (kind) {
    case "report":
      return `report-${id}`;
    case "route":
      return id;
    case "postgres-full":
      return `backup-full-${id}`;
    case "postgres-wal":
      return `backup-wal-${id}`;
    case "postgres-restore":
      return `restore-${id}`;
    case "mssql-full":
      return `mssql-full-${id}`;
    case "mssql-differential":
      return `mssql-diff-${id}`;
    case "mssql-log":
      return `mssql-log-${id}`;
  }
}

export function staleStartedBefore(now: Date, thresholdMs: number): Date {
  return new Date(now.getTime() - thresholdMs);
}

export function isStaleRunningLog(startedAt: Date | string, now: Date, thresholdMs: number): boolean {
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(started.getTime())) return false;
  return started.getTime() < staleStartedBefore(now, thresholdMs).getTime();
}

export function dueEnabledWhere<Field extends string>(
  field: Field,
  now: Date
): { enabled: true } & Record<Field, { lte: Date }> {
  return {
    enabled: true,
    [field]: { lte: now },
  } as { enabled: true } & Record<Field, { lte: Date }>;
}
