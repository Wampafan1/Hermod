import { getBoss } from "./pg-boss";
import { PrismaClient } from "@prisma/client";
import { runReport } from "./report-runner";
import { advanceNextRun } from "./schedule-utils";
import { startSftpWatcher } from "./sftp-watcher";
import { handleRouteJob } from "./bifrost/jobs/route-job.handler";
import { handleRavenResume } from "./bifrost/jobs/raven-resume.handler";
import { advanceRouteNextRun } from "./bifrost/engine";
import { advanceBackupRun } from "./backups/schedule";
import { handleFullBackupJob } from "./backups/jobs/full-backup.handler";
import { handleWalBackupJob } from "./backups/jobs/wal-backup.handler";
import { handlePostgresRestoreJob } from "./backups/jobs/postgres-restore.handler";
import { handleMssqlFullBackupJob } from "./backups/jobs/mssql-full-backup.handler";
import { handleMssqlDifferentialBackupJob } from "./backups/jobs/mssql-differential-backup.handler";
import { handleMssqlLogBackupJob } from "./backups/jobs/mssql-log-backup.handler";
import {
  getDueRetries,
  decompressPayload,
  claimRetry,
  markRecovered,
  markRetryFailed,
} from "./bifrost/helheim/dead-letter";
import { inferSchemaFromRows, normalizeRowDates, getDateColumns } from "./bifrost/engine";
import { getProvider, toConnectionLike } from "./providers";
import { mapWithConcurrency, withTimeout, safeErrorMessage } from "./async-utils";

const prisma = new PrismaClient();
const POLL_INTERVAL = 60_000; // 60 seconds
const TICK_TIMEOUT_MS = 5 * 60_000; // 5 minutes — max time for a scheduler tick
const DUE_WORK_BATCH_SIZE = 100;
const ENQUEUE_CONCURRENCY = 10;

interface SendReportJob {
  reportId: string;
  scheduleId: string;
}

async function main() {
  console.log("[Worker] Starting Hermod worker...");

  // Clean up stale "running" route logs from previous crashed runs
  const staleResult = await prisma.routeLog.updateMany({
    where: {
      status: "running",
      startedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: {
      status: "failed",
      error: "Timed out — process crashed or hung before completion",
      completedAt: new Date(),
    },
  });
  if (staleResult.count > 0) {
    console.log(`[Worker] Cleaned up ${staleResult.count} stale "running" route log(s)`);
  }

  // Clean up stale backup runs from previous crashed workers.
  const staleBackups = await prisma.postgresBackupRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 75 * 60_000) },
    },
    data: {
      status: "FAILED",
      error: "Timed out - worker crashed or hung before completion",
      completedAt: new Date(),
    },
  });
  if (staleBackups.count > 0) {
    console.log(`[Worker] Cleaned up ${staleBackups.count} stale backup run(s)`);
  }

  const staleMssqlBackups = await prisma.mssqlBackupRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 125 * 60_000) },
    },
    data: {
      status: "FAILED",
      error: "Timed out - worker crashed or hung before completion",
      completedAt: new Date(),
    },
  });
  if (staleMssqlBackups.count > 0) {
    console.log(`[Worker] Cleaned up ${staleMssqlBackups.count} stale SQL Server backup run(s)`);
  }

  const staleRestores = await prisma.postgresRestoreJob.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 75 * 60_000) },
    },
    data: {
      status: "FAILED",
      error: "Timed out - worker crashed or hung before completion",
      completedAt: new Date(),
    },
  });
  if (staleRestores.count > 0) {
    console.log(`[Worker] Cleaned up ${staleRestores.count} stale restore job(s)`);
  }

  const boss = getBoss();
  await boss.start();
  console.log("[Worker] pg-boss connected");

  // Register job handler
  await boss.work<SendReportJob>("send-report", async (job) => {
    const { reportId, scheduleId } = job.data;
    console.log(`[Worker] Processing send-report: report=${reportId} schedule=${scheduleId}`);

    try {
      const result = await runReport(reportId, scheduleId);
      console.log(`[Worker] Report ${reportId} completed: ${result.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Worker] Report ${reportId} failed: ${message}`);
      throw error; // Let pg-boss handle retries
    }
  });

  // Register Bifrost route handler
  await boss.work("run-route", { teamSize: 2, teamConcurrency: 1 }, handleRouteJob as any);

  // Register Raven pipeline resumption handler
  await boss.work("resume-raven-route", { teamSize: 2, teamConcurrency: 1 }, handleRavenResume as any);

  // Register Niflheim backup handlers
  await boss.work("postgres-backup-full", { teamSize: 1, teamConcurrency: 1 }, handleFullBackupJob as any);
  await boss.work("postgres-backup-wal", { teamSize: 1, teamConcurrency: 1 }, handleWalBackupJob as any);
  await boss.work("postgres-restore", { teamSize: 1, teamConcurrency: 1 }, handlePostgresRestoreJob as any);
  await boss.work("mssql-backup-full", { teamSize: 1, teamConcurrency: 1 }, handleMssqlFullBackupJob as any);
  await boss.work("mssql-backup-differential", { teamSize: 1, teamConcurrency: 1 }, handleMssqlDifferentialBackupJob as any);
  await boss.work("mssql-backup-log", { teamSize: 1, teamConcurrency: 1 }, handleMssqlLogBackupJob as any);

  // Blueprint version pruning — runs asynchronously after new versions are created
  await boss.work("prune-blueprint-versions", async (job: { data: { blueprintId: string } }) => {
    const { enforceRetentionPolicy } = await import("@/lib/mjolnir/blueprint-versioning");
    const pruned = await enforceRetentionPolicy(job.data.blueprintId);
    if (pruned > 0) {
      console.log(`[Worker] Pruned ${pruned} old blueprint version(s) for ${job.data.blueprintId}`);
    }
  });

  console.log("[Worker] Job handlers registered");

  let schedulerTickRunning = false;

  // Scheduler tick loop
  async function schedulerTick() {
    try {
      const now = new Date();

      // ─── Report Schedules ───────────────────────────
      const dueSchedules = await prisma.schedule.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        include: {
          report: { select: { id: true, name: true } },
        },
      });

      for (const schedule of dueSchedules) {
        console.log(
          `[Worker] Enqueuing report: ${schedule.report.name} (schedule=${schedule.id})`
        );

        const nextRun = advanceNextRun(
          {
            frequency: schedule.frequency,
            daysOfWeek: schedule.daysOfWeek,
            dayOfMonth: schedule.dayOfMonth,
            monthsOfYear: schedule.monthsOfYear,
            timeHour: schedule.timeHour,
            timeMinute: schedule.timeMinute,
            timezone: schedule.timezone,
          },
          now
        );

        // Enqueue before advancing nextRunAt so send failures leave the schedule due for retry.
        await boss.send("send-report", {
          reportId: schedule.reportId,
          scheduleId: schedule.id,
        }, {
          singletonKey: `report-${schedule.reportId}`,
        });

        await prisma.schedule.update({
          where: { id: schedule.id },
          data: { nextRunAt: nextRun },
        });

        console.log(`[Worker] Next run for ${schedule.report.name}: ${nextRun.toISOString()}`);
      }

      if (dueSchedules.length > 0) {
        console.log(`[Worker] Enqueued ${dueSchedules.length} report(s)`);
      }

      // ─── Bifrost Routes ──────────────────────────────
      const dueRoutes = await prisma.bifrostRoute.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          frequency: true,
          daysOfWeek: true,
          dayOfMonth: true,
          monthsOfYear: true,
          timeHour: true,
          timeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueRoutes,
        ENQUEUE_CONCURRENCY,
        async (route) => {
          console.log(`[Worker] Enqueuing Bifrost route: ${route.name} (route=${route.id})`);
          await boss.send("run-route", { routeId: route.id, triggeredBy: "schedule" }, {
            singletonKey: route.id,
          });
          await advanceRouteNextRun(route);
        }
      );

      if (dueRoutes.length > 0) {
        console.log(`[Worker] Enqueued ${dueRoutes.length} Bifrost route(s)`);
      }

      // ─── Helheim Retries (batched by destination) ────
      // Niflheim full PostgreSQL backups
      const dueFullBackups = await prisma.postgresBackupPolicy.findMany({
        where: {
          enabled: true,
          nextFullRunAt: { lte: now },
        },
        orderBy: { nextFullRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          fullFrequency: true,
          timeHour: true,
          timeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueFullBackups,
        ENQUEUE_CONCURRENCY,
        async (policy) => {
          console.log(`[Worker] Enqueuing Niflheim full backup: ${policy.name} (policy=${policy.id})`);
          const nextFullRunAt = advanceBackupRun(
            {
              frequency: policy.fullFrequency as any,
              timeHour: policy.timeHour,
              timeMinute: policy.timeMinute,
              timezone: policy.timezone,
            },
            now
          );
          await boss.send(
            "postgres-backup-full",
            { policyId: policy.id, triggeredBy: "schedule" },
            { singletonKey: `backup-full-${policy.id}` }
          );
          await prisma.postgresBackupPolicy.update({
            where: { id: policy.id },
            data: { nextFullRunAt },
          });
        }
      );

      if (dueFullBackups.length > 0) {
        console.log(`[Worker] Enqueued ${dueFullBackups.length} full backup(s)`);
      }

      // Niflheim WAL/PITR archives
      const dueWalBackups = await prisma.postgresBackupPolicy.findMany({
        where: {
          enabled: true,
          walEnabled: true,
          nextWalRunAt: { lte: now },
        },
        orderBy: { nextWalRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          walFrequency: true,
          timeHour: true,
          timeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueWalBackups,
        ENQUEUE_CONCURRENCY,
        async (policy) => {
          console.log(`[Worker] Enqueuing Niflheim WAL archive: ${policy.name} (policy=${policy.id})`);
          const nextWalRunAt = advanceBackupRun(
            {
              frequency: (policy.walFrequency ?? "HOURLY") as any,
              timeHour: policy.timeHour,
              timeMinute: policy.timeMinute,
              timezone: policy.timezone,
            },
            now
          );
          await boss.send(
            "postgres-backup-wal",
            { policyId: policy.id, triggeredBy: "schedule" },
            { singletonKey: `backup-wal-${policy.id}` }
          );
          await prisma.postgresBackupPolicy.update({
            where: { id: policy.id },
            data: { nextWalRunAt },
          });
        }
      );

      if (dueWalBackups.length > 0) {
        console.log(`[Worker] Enqueued ${dueWalBackups.length} WAL archive(s)`);
      }

      // Niflheim SQL Server full backups
      const dueMssqlFullBackups = await prisma.mssqlBackupPolicy.findMany({
        where: {
          enabled: true,
          nextFullRunAt: { lte: now },
        },
        orderBy: { nextFullRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          fullFrequency: true,
          fullTimeHour: true,
          fullTimeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueMssqlFullBackups,
        ENQUEUE_CONCURRENCY,
        async (policy) => {
          console.log(`[Worker] Enqueuing SQL Server full backup: ${policy.name} (policy=${policy.id})`);
          const nextFullRunAt = advanceBackupRun(
            {
              frequency: policy.fullFrequency as any,
              timeHour: policy.fullTimeHour,
              timeMinute: policy.fullTimeMinute,
              timezone: policy.timezone,
            },
            now
          );
          await boss.send(
            "mssql-backup-full",
            { policyId: policy.id, triggeredBy: "schedule" },
            { singletonKey: `mssql-full-${policy.id}` }
          );
          await prisma.mssqlBackupPolicy.update({
            where: { id: policy.id },
            data: { nextFullRunAt },
          });
        }
      );

      if (dueMssqlFullBackups.length > 0) {
        console.log(`[Worker] Enqueued ${dueMssqlFullBackups.length} SQL Server full backup(s)`);
      }

      // Niflheim SQL Server differential backups
      const dueMssqlDiffBackups = await prisma.mssqlBackupPolicy.findMany({
        where: {
          enabled: true,
          differentialFrequency: { not: null },
          nextDifferentialRunAt: { lte: now },
        },
        orderBy: { nextDifferentialRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          differentialFrequency: true,
          fullTimeHour: true,
          fullTimeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueMssqlDiffBackups,
        ENQUEUE_CONCURRENCY,
        async (policy) => {
          console.log(`[Worker] Enqueuing SQL Server differential backup: ${policy.name} (policy=${policy.id})`);
          const nextDifferentialRunAt = advanceBackupRun(
            {
              frequency: (policy.differentialFrequency ?? "EVERY_6_HOURS") as any,
              timeHour: policy.fullTimeHour,
              timeMinute: policy.fullTimeMinute,
              timezone: policy.timezone,
            },
            now
          );
          await boss.send(
            "mssql-backup-differential",
            { policyId: policy.id, triggeredBy: "schedule" },
            { singletonKey: `mssql-diff-${policy.id}` }
          );
          await prisma.mssqlBackupPolicy.update({
            where: { id: policy.id },
            data: { nextDifferentialRunAt },
          });
        }
      );

      if (dueMssqlDiffBackups.length > 0) {
        console.log(`[Worker] Enqueued ${dueMssqlDiffBackups.length} SQL Server differential backup(s)`);
      }

      // Niflheim SQL Server transaction log backups
      const dueMssqlLogBackups = await prisma.mssqlBackupPolicy.findMany({
        where: {
          enabled: true,
          logFrequency: { not: null },
          nextLogRunAt: { lte: now },
        },
        orderBy: { nextLogRunAt: "asc" },
        take: DUE_WORK_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          logFrequency: true,
          fullTimeHour: true,
          fullTimeMinute: true,
          timezone: true,
        },
      });

      await mapWithConcurrency(
        dueMssqlLogBackups,
        ENQUEUE_CONCURRENCY,
        async (policy) => {
          console.log(`[Worker] Enqueuing SQL Server transaction log backup: ${policy.name} (policy=${policy.id})`);
          const nextLogRunAt = advanceBackupRun(
            {
              frequency: (policy.logFrequency ?? "HOURLY") as any,
              timeHour: policy.fullTimeHour,
              timeMinute: policy.fullTimeMinute,
              timezone: policy.timezone,
            },
            now
          );
          await boss.send(
            "mssql-backup-log",
            { policyId: policy.id, triggeredBy: "schedule" },
            { singletonKey: `mssql-log-${policy.id}` }
          );
          await prisma.mssqlBackupPolicy.update({
            where: { id: policy.id },
            data: { nextLogRunAt },
          });
        }
      );

      if (dueMssqlLogBackups.length > 0) {
        console.log(`[Worker] Enqueued ${dueMssqlLogBackups.length} SQL Server transaction log backup(s)`);
      }

      await processHelheimRetries();
    } catch (error) {
      console.error("[Worker] Scheduler tick error:", safeErrorMessage(error));
    }
  }

  async function runSchedulerTickWithGuard(label: string) {
    if (schedulerTickRunning) {
      console.warn(`[Worker] Skipping ${label}; previous scheduler tick is still running`);
      return;
    }

    schedulerTickRunning = true;
    try {
      await withTimeout(schedulerTick(), TICK_TIMEOUT_MS, label);
    } finally {
      schedulerTickRunning = false;
    }
  }

  /**
   * Process due Helheim retries, batching by routeId to reuse
   * a single destination connection per route.
   */
  async function processHelheimRetries() {
    const dueRetries = await getDueRetries();
    if (dueRetries.length === 0) return;

    // Group retries by routeId to batch connection usage
    const byRoute = new Map<string, typeof dueRetries>();
    for (const entry of dueRetries) {
      const group = byRoute.get(entry.routeId) ?? [];
      group.push(entry);
      byRoute.set(entry.routeId, group);
    }

    for (const [routeId, entries] of byRoute) {
      try {
        // Skip retries if the route is currently executing — avoid
        // concurrent load jobs that cause duplicates and rate-limit cascades.
        const activeRun = await prisma.routeLog.findFirst({
          where: { routeId, status: "running" },
          select: { id: true },
        });
        if (activeRun) {
          console.log(`[Worker] Skipping Helheim retries for route ${routeId} — route is currently running`);
          continue;
        }

        const route = await prisma.bifrostRoute.findUniqueOrThrow({
          where: { id: routeId },
          include: {
            dest: { select: { id: true, type: true, config: true, credentials: true } },
          },
        });

        const destProvider = getProvider(route.dest.type);
        const destConnLike = toConnectionLike(route.dest);
        const conn = await destProvider.connect(destConnLike);
        // NEVER use the route's original writeDisposition for retries —
        // WRITE_TRUNCATE would wipe all previously loaded data.
        const destConfig = {
          ...(route.destConfig as any),
          writeDisposition: "WRITE_APPEND",
        };

        // Process all entries for this route on one connection
        for (const entry of entries) {
          try {
            console.log(`[Worker] Retrying Helheim entry ${entry.id}`);
            const claimed = await claimRetry(entry.id);
            if (!claimed) {
              console.log(`[Worker] Helheim entry ${entry.id} already claimed by another worker`);
              continue;
            }

            const rows = await decompressPayload(entry.payload);
            // Infer explicit schema from the chunk data to prevent BigQuery
            // autodetect from guessing wrong types (same as engine first-batch path).
            const schema = inferSchemaFromRows(rows);
            const dateCols = getDateColumns(schema);
            if (dateCols.size > 0) normalizeRowDates(rows, dateCols);
            await destProvider.load!(conn, rows, { ...destConfig, schema });
            await markRecovered(entry.id);
            console.log(`[Worker] Helheim entry ${entry.id} recovered`);
          } catch (retryErr) {
            await markRetryFailed(entry.id, entry.retryCount, entry.maxRetries, retryErr);
            console.error(`[Worker] Helheim retry failed for ${entry.id}:`, safeErrorMessage(retryErr));
          }
        }

        await conn.close();
      } catch (err) {
        console.error(`[Worker] Helheim batch error for route ${routeId}:`, safeErrorMessage(err));
      }
    }
  }

  // Initial tick (with timeout protection)
  try {
    await runSchedulerTickWithGuard("Initial scheduler tick");
  } catch (err) {
    console.error("[Worker] Initial tick error:", safeErrorMessage(err));
  }

  // Poll every 60 seconds (with timeout per tick)
  setInterval(async () => {
    try {
      await runSchedulerTickWithGuard("Scheduler tick");
    } catch (err) {
      console.error("[Worker] Tick error:", safeErrorMessage(err));
    }
  }, POLL_INTERVAL);
  console.log(`[Worker] Scheduler polling every ${POLL_INTERVAL / 1000}s`);

  // ─── Graceful Shutdown ─────────────────────────
  async function shutdown(signal: string) {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    try {
      const { markInFlightJobsFailed } = await import("./worker-shutdown");
      await markInFlightJobsFailed(prisma);
    } catch (err) {
      console.error("[Worker] Shutdown cleanup error:", safeErrorMessage(err));
    }
    await boss.stop({ graceful: true, timeout: 10_000 });
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Start SFTP file watcher
  startSftpWatcher(prisma);
}

main().catch((error) => {
  console.error("[Worker] Fatal error:", safeErrorMessage(error));
  process.exit(1);
});
