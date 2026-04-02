import { ScheduleFrequency } from "@prisma/client";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  addDays,
  addWeeks,
  addMonths,
  addHours,
  addMinutes,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  getDay,
  getDaysInMonth,
  setDate,
  isAfter,
  startOfDay,
} from "date-fns";

interface ScheduleInput {
  frequency: ScheduleFrequency;
  daysOfWeek: number[]; // 0=Sun, 1=Mon, ... 6=Sat
  dayOfMonth: number | null;
  monthsOfYear?: number[]; // 1-12 for quarterly
  timeHour: number; // 0-23
  timeMinute: number; // 0-59
  timezone: string;
}

/**
 * Calculate the next run date for a schedule, after the given reference time.
 */
export function calculateNextRun(
  schedule: ScheduleInput,
  after: Date = new Date()
): Date {
  const { frequency, timezone, timeHour, timeMinute } = schedule;

  // Work in the schedule's timezone
  const nowInTz = toZonedTime(after, timezone);

  switch (frequency) {
    case "EVERY_15_MIN":
      return nextInterval(nowInTz, 15, timezone);
    case "EVERY_30_MIN":
      return nextInterval(nowInTz, 30, timezone);
    case "HOURLY":
      return nextInterval(nowInTz, 60, timezone);
    case "EVERY_4_HOURS":
      return nextInterval(nowInTz, 240, timezone);
    case "EVERY_12_HOURS":
      return nextInterval(nowInTz, 720, timezone);
    case "DAILY":
      return nextDaily(nowInTz, timeHour, timeMinute, timezone);
    case "WEEKLY":
      return nextWeekly(nowInTz, schedule.daysOfWeek, timeHour, timeMinute, timezone);
    case "BIWEEKLY":
      return nextBiweekly(nowInTz, schedule.daysOfWeek, timeHour, timeMinute, timezone);
    case "MONTHLY":
      return nextMonthly(nowInTz, schedule.dayOfMonth ?? 1, timeHour, timeMinute, timezone);
    case "QUARTERLY":
      return nextQuarterly(
        nowInTz,
        schedule.monthsOfYear ?? [1, 4, 7, 10],
        schedule.dayOfMonth ?? 1,
        timeHour,
        timeMinute,
        timezone
      );
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

/** For sub-daily frequencies: next run is simply now + interval minutes */
function nextInterval(now: Date, intervalMinutes: number, tz: string): Date {
  const candidate = addMinutes(now, intervalMinutes);
  return toUtc(candidate, tz);
}

function setTime(date: Date, hour: number, minute: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(date, hour), minute), 0), 0);
}

function toUtc(zonedDate: Date, timezone: string): Date {
  return fromZonedTime(zonedDate, timezone);
}

function nextDaily(
  now: Date,
  hour: number,
  minute: number,
  tz: string
): Date {
  let candidate = setTime(now, hour, minute);
  if (!isAfter(candidate, now)) {
    candidate = addDays(candidate, 1);
  }
  return toUtc(candidate, tz);
}

function nextWeekly(
  now: Date,
  daysOfWeek: number[],
  hour: number,
  minute: number,
  tz: string
): Date {
  if (daysOfWeek.length === 0) {
    return nextDaily(now, hour, minute, tz);
  }

  const sorted = [...daysOfWeek].sort((a, b) => a - b);
  const currentDay = getDay(now);
  const todayTime = setTime(now, hour, minute);

  // Check today if it's a scheduled day and time hasn't passed
  if (sorted.includes(currentDay) && isAfter(todayTime, now)) {
    return toUtc(todayTime, tz);
  }

  // Find next scheduled day this week or next
  for (let offset = 1; offset <= 7; offset++) {
    const nextDate = addDays(now, offset);
    if (sorted.includes(getDay(nextDate))) {
      return toUtc(setTime(nextDate, hour, minute), tz);
    }
  }

  // Fallback (shouldn't reach here)
  return toUtc(setTime(addDays(now, 1), hour, minute), tz);
}

function nextBiweekly(
  now: Date,
  daysOfWeek: number[],
  hour: number,
  minute: number,
  tz: string
): Date {
  // Find the next weekly occurrence, then add 1 week to ensure biweekly gap.
  // After each run, advanceNextRun() adds 2 weeks for subsequent runs.
  const nextWeeklyRun = nextWeekly(now, daysOfWeek, hour, minute, tz);
  const runInTz = toZonedTime(nextWeeklyRun, tz);
  const biweeklyRun = addWeeks(runInTz, 1);
  return toUtc(setTime(biweeklyRun, hour, minute), tz);
}

/** Resolve dayOfMonth: 0 means "last day of month", otherwise clamp to month's max. */
function resolveDay(dayOfMonth: number, refDate: Date): number {
  const daysInMonth = getDaysInMonth(refDate);
  return dayOfMonth === 0 ? daysInMonth : Math.min(dayOfMonth, daysInMonth);
}

function nextMonthly(
  now: Date,
  dayOfMonth: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  let candidate = startOfDay(now);
  candidate = setDate(candidate, resolveDay(dayOfMonth, candidate));
  candidate = setTime(candidate, hour, minute);

  if (!isAfter(candidate, now)) {
    // Move to next month
    candidate = addMonths(startOfDay(now), 1);
    candidate = setDate(candidate, resolveDay(dayOfMonth, candidate));
    candidate = setTime(candidate, hour, minute);
  }

  return toUtc(candidate, tz);
}

function nextQuarterly(
  now: Date,
  months: number[],
  dayOfMonth: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  const sortedMonths = [...months].sort((a, b) => a - b);
  const currentMonth = now.getMonth() + 1; // 1-based

  // Try current month first
  for (const month of sortedMonths) {
    if (month >= currentMonth) {
      let candidate = new Date(now.getFullYear(), month - 1, 1);
      candidate = setDate(candidate, resolveDay(dayOfMonth, candidate));
      candidate = setTime(candidate, hour, minute);
      if (isAfter(candidate, now)) {
        return toUtc(candidate, tz);
      }
    }
  }

  // Next year
  const firstMonth = sortedMonths[0];
  let candidate = new Date(now.getFullYear() + 1, firstMonth - 1, 1);
  candidate = setDate(candidate, resolveDay(dayOfMonth, candidate));
  candidate = setTime(candidate, hour, minute);
  return toUtc(candidate, tz);
}

/**
 * Advance to the next run after a completed run.
 * For biweekly, adds 2 weeks instead of finding the next weekly occurrence.
 */
export function advanceNextRun(
  schedule: ScheduleInput,
  lastRun: Date
): Date {
  if (schedule.frequency === "BIWEEKLY") {
    const lastInTz = toZonedTime(lastRun, schedule.timezone);
    const next = addWeeks(lastInTz, 2);
    return toUtc(setTime(next, schedule.timeHour, schedule.timeMinute), schedule.timezone);
  }
  return calculateNextRun(schedule, lastRun);
}

