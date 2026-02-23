/**
 * Client-safe schedule description utility.
 * Extracted from schedule-utils.ts to avoid bundling date-fns client-side.
 */

type ScheduleFrequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";

export interface ScheduleDescribeInput {
  frequency: ScheduleFrequency;
  daysOfWeek: number[]; // 0=Sun, 1=Mon, ... 6=Sat
  dayOfMonth: number | null;
  monthsOfYear?: number[]; // 1-12 for quarterly
  timeHour: number; // 0-23
  timeMinute: number; // 0-59
  timezone: string;
}

/**
 * Generate a human-readable schedule description.
 */
export function describeSchedule(schedule: ScheduleDescribeInput): string {
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
