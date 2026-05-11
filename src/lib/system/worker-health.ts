import { ensureBossStarted } from "@/lib/pg-boss";
import { gateValidationWorkerHealthMessage } from "@/lib/gates/validation-copy";

type WorkerQueueGroup = "gateValidation" | "reports" | "bifrost" | "backups";

interface QueueGroupDefinition {
  label: string;
  queues: string[];
}

export interface WorkerQueueHealth {
  label: string;
  queues: string[];
  pending: number | null;
  active: number | null;
  failedRecently: number | null;
  status: "available" | "unavailable";
}

export interface WorkerHealthPayload {
  ok: boolean;
  workerRequired: true;
  queues: Record<WorkerQueueGroup, WorkerQueueHealth>;
  message: string;
}

interface QueueSizeReader {
  getQueueSize(name: string, options?: object): Promise<number>;
}

const QUEUE_GROUPS: Record<WorkerQueueGroup, QueueGroupDefinition> = {
  gateValidation: {
    label: "Gate validation",
    queues: ["gate-validate-push"],
  },
  reports: {
    label: "Scheduled reports",
    queues: ["send-report"],
  },
  bifrost: {
    label: "Bifrost routes",
    queues: ["run-route", "resume-raven-route"],
  },
  backups: {
    label: "Backups and restores",
    queues: [
      "postgres-backup-full",
      "postgres-backup-wal",
      "postgres-restore",
      "mssql-backup-full",
      "mssql-backup-differential",
      "mssql-backup-log",
    ],
  },
};

export async function buildWorkerHealthPayload(options: {
  nodeEnv?: string;
  includeQueueStats?: boolean;
} = {}): Promise<WorkerHealthPayload> {
  const includeQueueStats = options.includeQueueStats ?? true;

  if (!includeQueueStats) {
    return {
      ok: true,
      workerRequired: true,
      queues: buildUnavailableQueueHealth(),
      message: workerHealthMessage({
        nodeEnv: options.nodeEnv,
        queueStatsAvailable: false,
        staticOnly: true,
      }),
    };
  }

  try {
    const boss = await ensureBossStarted();
    const queues = await buildQueueHealth(boss);
    return {
      ok: true,
      workerRequired: true,
      queues,
      message: workerHealthMessage({
        nodeEnv: options.nodeEnv,
        queueStatsAvailable: true,
      }),
    };
  } catch {
    return {
      ok: false,
      workerRequired: true,
      queues: buildUnavailableQueueHealth(),
      message: workerHealthMessage({
        nodeEnv: options.nodeEnv,
        queueStatsAvailable: false,
      }),
    };
  }
}

export function workerHealthMessage(input: {
  nodeEnv?: string;
  queueStatsAvailable: boolean;
  staticOnly?: boolean;
}): string {
  const isDevelopment = input.nodeEnv === "development";

  if (input.queueStatsAvailable) {
    return isDevelopment
      ? "Worker queues are reachable. Gate validation, reports, Bifrost, and backups require npm run worker in development."
      : "Worker queues are reachable. Gate validation, reports, Bifrost, and backups are processed by the Hermod worker.";
  }

  if (input.staticOnly) {
    return gateValidationWorkerHealthMessage({ nodeEnv: input.nodeEnv });
  }

  return isDevelopment
    ? "Worker queue metrics are unavailable. In development, make sure npm run worker is running in a separate terminal."
    : "Worker queue metrics are unavailable. Check the Hermod worker process and worker logs.";
}

export function scheduledWorkerStuckMessage(): string {
  return process.env.NODE_ENV === "development"
    ? "Scheduled job timed out before the worker finished. In development, make sure npm run worker is running in a separate terminal."
    : "Scheduled job timed out before the worker finished. Check worker health and logs.";
}

export function backupWorkerStuckMessage(): string {
  return process.env.NODE_ENV === "development"
    ? "Backup job timed out before the worker finished. In development, make sure npm run worker is running in a separate terminal."
    : "Backup job timed out before the worker finished. Check worker health and logs.";
}

async function buildQueueHealth(
  boss: QueueSizeReader
): Promise<Record<WorkerQueueGroup, WorkerQueueHealth>> {
  const entries = await Promise.all(
    (Object.entries(QUEUE_GROUPS) as Array<[WorkerQueueGroup, QueueGroupDefinition]>).map(
      async ([key, definition]) => [key, await readQueueGroupHealth(boss, definition)] as const
    )
  );
  return Object.fromEntries(entries) as Record<WorkerQueueGroup, WorkerQueueHealth>;
}

async function readQueueGroupHealth(
  boss: QueueSizeReader,
  definition: QueueGroupDefinition
): Promise<WorkerQueueHealth> {
  let pending = 0;
  let activeAndPending = 0;

  for (const queue of definition.queues) {
    const [queuePending, queueActiveAndPending] = await Promise.all([
      boss.getQueueSize(queue),
      boss.getQueueSize(queue, { before: "completed" }),
    ]);
    pending += queuePending;
    activeAndPending += queueActiveAndPending;
  }

  return {
    label: definition.label,
    queues: definition.queues,
    pending,
    active: Math.max(0, activeAndPending - pending),
    failedRecently: null,
    status: "available",
  };
}

function buildUnavailableQueueHealth(): Record<WorkerQueueGroup, WorkerQueueHealth> {
  return Object.fromEntries(
    (Object.entries(QUEUE_GROUPS) as Array<[WorkerQueueGroup, QueueGroupDefinition]>).map(
      ([key, definition]) => [
        key,
        {
          label: definition.label,
          queues: definition.queues,
          pending: null,
          active: null,
          failedRecently: null,
          status: "unavailable",
        },
      ]
    )
  ) as Record<WorkerQueueGroup, WorkerQueueHealth>;
}
