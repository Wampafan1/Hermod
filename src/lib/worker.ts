import { getBoss } from "./pg-boss";
import { PrismaClient } from "@prisma/client";
import { runReport } from "./report-runner";
import { advanceNextRun } from "./schedule-utils";
import { startSftpWatcher } from "./sftp-watcher";

const prisma = new PrismaClient();
const POLL_INTERVAL = 60_000; // 60 seconds

interface SendReportJob {
  reportId: string;
  scheduleId: string;
}

async function main() {
  console.log("[Worker] Starting Hermod worker...");

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

  console.log("[Worker] Job handler registered");

  // Scheduler tick loop
  async function schedulerTick() {
    try {
      const now = new Date();
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

        // Enqueue the job
        await boss.send("send-report", {
          reportId: schedule.reportId,
          scheduleId: schedule.id,
        });

        // Advance nextRunAt
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

        console.log(`[Worker] Next run for ${schedule.report.name}: ${nextRun.toISOString()}`);
      }

      if (dueSchedules.length > 0) {
        console.log(`[Worker] Enqueued ${dueSchedules.length} report(s)`);
      }
    } catch (error) {
      console.error("[Worker] Scheduler tick error:", error);
    }
  }

  // Initial tick
  await schedulerTick();

  // Poll every 60 seconds
  setInterval(schedulerTick, POLL_INTERVAL);
  console.log(`[Worker] Scheduler polling every ${POLL_INTERVAL / 1000}s`);

  // Start SFTP file watcher
  startSftpWatcher(prisma);
}

main().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});
