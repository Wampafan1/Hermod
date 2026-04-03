import { getBoss } from "./pg-boss";
import { PrismaClient } from "@prisma/client";
import { runReport } from "./report-runner";
import { advanceNextRun } from "./schedule-utils";
import { startSftpWatcher } from "./sftp-watcher";
import { handleRouteJob } from "./bifrost/jobs/route-job.handler";
import { advanceRouteNextRun } from "./bifrost/engine";
import {
  getDueRetries,
  decompressPayload,
  claimRetry,
  markRecovered,
  markRetryFailed,
} from "./bifrost/helheim/dead-letter";
import { inferSchemaFromRows, normalizeRowDates, getDateColumns } from "./bifrost/engine";
import { getProvider, toConnectionLike } from "./providers";
import { withTimeout, safeErrorMessage } from "./async-utils";

const prisma = new PrismaClient();
const POLL_INTERVAL = 60_000; // 60 seconds
const TICK_TIMEOUT_MS = 5 * 60_000; // 5 minutes — max time for a scheduler tick

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

  // Blueprint version pruning — runs asynchronously after new versions are created
  await boss.work("prune-blueprint-versions", async (job: { data: { blueprintId: string } }) => {
    const { enforceRetentionPolicy } = await import("@/lib/mjolnir/blueprint-versioning");
    const pruned = await enforceRetentionPolicy(job.data.blueprintId);
    if (pruned > 0) {
      console.log(`[Worker] Pruned ${pruned} old blueprint version(s) for ${job.data.blueprintId}`);
    }
  });

  console.log("[Worker] Job handlers registered");

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
        include: {
          report: { select: { id: true, name: true } },
        },
      });

      for (const schedule of dueSchedules) {
        console.log(
          `[Worker] Enqueuing report: ${schedule.report.name} (schedule=${schedule.id})`
        );

        // Advance nextRunAt FIRST to prevent re-enqueue on crash
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

        await prisma.schedule.update({
          where: { id: schedule.id },
          data: { nextRunAt: nextRun },
        });

        // THEN enqueue the job (if crash here, we miss one run — safer than duplicate)
        await boss.send("send-report", {
          reportId: schedule.reportId,
          scheduleId: schedule.id,
        }, {
          singletonKey: `report-${schedule.reportId}`,
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

      await Promise.all(
        dueRoutes.map(async (route) => {
          console.log(`[Worker] Enqueuing Bifrost route: ${route.name} (route=${route.id})`);
          // Advance nextRunAt FIRST to prevent re-enqueue on crash
          await advanceRouteNextRun(route);
          await boss.send("run-route", { routeId: route.id, triggeredBy: "schedule" }, {
            singletonKey: route.id,
          });
        })
      );

      if (dueRoutes.length > 0) {
        console.log(`[Worker] Enqueued ${dueRoutes.length} Bifrost route(s)`);
      }

      // ─── Helheim Retries (batched by destination) ────
      await processHelheimRetries();
    } catch (error) {
      console.error("[Worker] Scheduler tick error:", safeErrorMessage(error));
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
    await withTimeout(schedulerTick(), TICK_TIMEOUT_MS, "Initial scheduler tick");
  } catch (err) {
    console.error("[Worker] Initial tick error:", safeErrorMessage(err));
  }

  // Poll every 60 seconds (with timeout per tick)
  setInterval(async () => {
    try {
      await withTimeout(schedulerTick(), TICK_TIMEOUT_MS, "Scheduler tick");
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
