"use client";

import { describeSchedule } from "@/lib/schedule-describe";

interface SchedulePreviewProps {
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
  daysOfWeek: number[];
  dayOfMonth: number | null;
  monthsOfYear: number[];
  timeHour: number;
  timeMinute: number;
  timezone: string;
  recipientCount: number;
  firstRecipient?: string;
}

export function SchedulePreview(props: SchedulePreviewProps) {
  const description = describeSchedule({
    frequency: props.frequency,
    daysOfWeek: props.daysOfWeek,
    dayOfMonth: props.dayOfMonth,
    monthsOfYear: props.monthsOfYear,
    timeHour: props.timeHour,
    timeMinute: props.timeMinute,
    timezone: props.timezone,
  });

  const recipientText =
    props.recipientCount === 0
      ? "no recipients"
      : props.recipientCount === 1
        ? props.firstRecipient ?? "1 recipient"
        : `${props.firstRecipient} and ${props.recipientCount - 1} other${props.recipientCount > 2 ? "s" : ""}`;

  return (
    <div className="px-4 py-3 bg-void border border-border text-xs text-text-dim tracking-wide leading-relaxed">
      This report will send{" "}
      <strong className="text-gold-bright">{description}</strong> to{" "}
      <strong className="text-gold-bright">{recipientText}</strong>
    </div>
  );
}
