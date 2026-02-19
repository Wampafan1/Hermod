import { ScheduleFrequency } from "@prisma/client";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  addDays,
  addWeeks,
  addMonths,
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
  // Find the next matching day, then skip a week
  // Simple approach: find next weekly occurrence, then check if it's on an even/odd week
  // For simplicity, we find the next occurrence and if it's this week, push to next-next week
  const nextWeeklyRun = nextWeekly(now, daysOfWeek, hour, minute, tz);
  const nowInTz = toZonedTime(now, tz);
  const runInTz = toZonedTime(nextWeeklyRun, tz);

  // If the next run is within this week (next 7 days), it's fine for the first occurrence.
  // For true biweekly, the worker will advance by 2 weeks after each run.
  return nextWeeklyRun;
}

function nextMonthly(
  now: Date,
  dayOfMonth: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  let candidate = startOfDay(now);
  const maxDay = Math.min(dayOfMonth, getDaysInMonth(candidate));
  candidate = setDate(candidate, maxDay);
  candidate = setTime(candidate, hour, minute);

  if (!isAfter(candidate, now)) {
    // Move to next month
    candidate = addMonths(startOfDay(now), 1);
    const nextMaxDay = Math.min(dayOfMonth, getDaysInMonth(candidate));
    candidate = setDate(candidate, nextMaxDay);
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
      const maxDay = Math.min(dayOfMonth, getDaysInMonth(candidate));
      candidate = setDate(candidate, maxDay);
      candidate = setTime(candidate, hour, minute);
      if (isAfter(candidate, now)) {
        return toUtc(candidate, tz);
      }
    }
  }

  // Next year
  const firstMonth = sortedMonths[0];
  let candidate = new Date(now.getFullYear() + 1, firstMonth - 1, 1);
  const maxDay = Math.min(dayOfMonth, getDaysInMonth(candidate));
  candidate = setDate(candidate, maxDay);
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

/**
 * Generate a human-readable schedule description.
 */
export function describeSchedule(schedule: ScheduleInput): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour12 = schedule.timeHour % 12 || 12;
  const ampm = schedule.timeHour < 12 ? "AM" : "PM";
  const minute = String(schedule.timeMinute).padStart(2, "0");
  const timeStr = `${hour12}:${minute} ${ampm}`;

  // Short timezone
  const tzShort = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? schedule.timezone;

  switch (schedule.frequency) {
    case "DAILY":
      return `Every day at ${timeStr} ${tzShort}`;
    case "WEEKLY": {
      const days = schedule.daysOfWeek
        .sort((a, b) => a - b)
        .map((d) => shortDays[d])
        .join(", ");
      return `Every ${days} at ${timeStr} ${tzShort}`;
    }
    case "BIWEEKLY": {
      const days = schedule.daysOfWeek
        .sort((a, b) => a - b)
        .map((d) => shortDays[d])
        .join(", ");
      return `Every other ${days} at ${timeStr} ${tzShort}`;
    }
    case "MONTHLY":
      return `Monthly on the ${ordinal(schedule.dayOfMonth ?? 1)} at ${timeStr} ${tzShort}`;
    case "QUARTERLY": {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const months = (schedule.monthsOfYear ?? [])
        .sort((a, b) => a - b)
        .map((m) => monthNames[m - 1])
        .join(", ");
      return `Quarterly (${months}) on the ${ordinal(schedule.dayOfMonth ?? 1)} at ${timeStr} ${tzShort}`;
    }
    default:
      return "Unknown schedule";
  }
}

function ordinal(n: number): string {
  if (n === 0) return "last day";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
