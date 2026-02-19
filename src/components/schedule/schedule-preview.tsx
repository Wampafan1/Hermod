"use client";

import { describeSchedule } from "@/lib/schedule-utils";
import { ScheduleFrequency } from "@prisma/client";

interface SchedulePreviewProps {
  frequency: ScheduleFrequency;
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
    <div className="px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300">
      This report will send <strong className="text-white">{description}</strong>{" "}
      to <strong className="text-white">{recipientText}</strong>
    </div>
  );
}
