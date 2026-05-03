import { calculateNextRun } from "@/lib/schedule-utils";
import type { ScheduleFrequency } from "@prisma/client";

export type FullBackupFrequency = "DAILY" | "WEEKLY" | "MONTHLY";
export type WalBackupFrequency = "EVERY_15_MIN" | "EVERY_30_MIN" | "HOURLY" | "EVERY_4_HOURS" | "EVERY_6_HOURS" | "EVERY_12_HOURS" | "DAILY";

interface BackupScheduleInput {
  frequency: FullBackupFrequency | WalBackupFrequency;
  timeHour: number;
  timeMinute: number;
  timezone: string;
}

export function calculateNextBackupRun(
  schedule: BackupScheduleInput,
  after: Date = new Date()
): Date {
  return calculateNextRun(
    {
      frequency: schedule.frequency as ScheduleFrequency,
      daysOfWeek: [1],
      dayOfMonth: 1,
      monthsOfYear: [1, 4, 7, 10],
      timeHour: schedule.timeHour,
      timeMinute: schedule.timeMinute,
      timezone: schedule.timezone,
    },
    after
  );
}

export function advanceBackupRun(
  schedule: BackupScheduleInput,
  after: Date = new Date()
): Date {
  return calculateNextBackupRun(schedule, after);
}

export function frequencyWindowMs(frequency: string | null | undefined): number {
  switch (frequency) {
    case "EVERY_15_MIN":
      return 15 * 60_000;
    case "EVERY_30_MIN":
      return 30 * 60_000;
    case "HOURLY":
      return 60 * 60_000;
    case "EVERY_4_HOURS":
      return 4 * 60 * 60_000;
    case "EVERY_6_HOURS":
      return 6 * 60 * 60_000;
    case "EVERY_12_HOURS":
      return 12 * 60 * 60_000;
    case "DAILY":
      return 24 * 60 * 60_000;
    case "WEEKLY":
      return 7 * 24 * 60 * 60_000;
    case "MONTHLY":
      return 31 * 24 * 60 * 60_000;
    default:
      return 24 * 60 * 60_000;
  }
}

export function graceWindowMs(frequency: string | null | undefined): number {
  return Math.max(60 * 60_000, Math.ceil(frequencyWindowMs(frequency) * 0.25));
}
