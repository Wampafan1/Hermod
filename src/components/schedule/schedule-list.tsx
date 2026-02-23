"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

interface Schedule {
  id: string;
  enabled: boolean;
  frequency: string;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  timeHour: number;
  timeMinute: number;
  timezone: string;
  nextRunAt: string | null;
  report: { id: string; name: string };
  recipients: { email: string }[];
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleList({ schedules }: { schedules: Schedule[] }) {
  const router = useRouter();
  const toast = useToast();

  async function handleToggle(id: string) {
    try {
      const res = await fetch(`/api/schedules/${id}/toggle`, { method: "POST" });
      if (!res.ok) {
        toast.error("Toggle failed");
        return;
      }
      const updated = await res.json();
      toast.success(updated.enabled ? "Schedule enabled" : "Schedule paused");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  function formatTime(hour: number, minute: number): string {
    const h = hour % 12 || 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
  }

  function describeFrequency(s: Schedule): string {
    const time = formatTime(s.timeHour, s.timeMinute);
    switch (s.frequency) {
      case "DAILY":
        return `Daily at ${time}`;
      case "WEEKLY":
      case "BIWEEKLY": {
        const days = s.daysOfWeek.sort((a, b) => a - b).map((d) => SHORT_DAYS[d]).join(", ");
        const prefix = s.frequency === "BIWEEKLY" ? "Every other" : "Every";
        return `${prefix} ${days} at ${time}`;
      }
      case "MONTHLY":
        return `Monthly on the ${s.dayOfMonth ?? 1}${ordinalSuffix(s.dayOfMonth ?? 1)} at ${time}`;
      case "QUARTERLY":
        return `Quarterly on the ${s.dayOfMonth ?? 1}${ordinalSuffix(s.dayOfMonth ?? 1)} at ${time}`;
      default:
        return s.frequency;
    }
  }

  if (schedules.length === 0) {
    return (
      <div className="text-center py-16 bg-deep border border-border">
        <span className="text-gold/20 text-3xl font-cinzel block mb-3">ᛏ</span>
        <p className="text-text-dim text-xs tracking-wide">No scheduled reports yet.</p>
        <p className="text-text-dim text-xs tracking-wide mt-1">
          Create a report and add a schedule to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-deep border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="label-norse text-left px-4 py-3">Report</th>
            <th className="label-norse text-left px-4 py-3">Frequency</th>
            <th className="label-norse text-left px-4 py-3">Next Run</th>
            <th className="label-norse text-left px-4 py-3">Recipients</th>
            <th className="label-norse text-center px-4 py-3">Enabled</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id} className="border-b border-border hover:bg-gold/[0.02]">
              <td className="px-4 py-3 text-text">
                {s.report.name}
              </td>
              <td className="px-4 py-3 text-text-dim text-xs tracking-wide">
                {describeFrequency(s)}
              </td>
              <td className="px-4 py-3 text-text-dim text-xs">
                {s.nextRunAt
                  ? new Date(s.nextRunAt).toLocaleString()
                  : "\u2014"}
              </td>
              <td className="px-4 py-3 text-text-dim text-xs">
                {s.recipients.length} recipient{s.recipients.length !== 1 ? "s" : ""}
              </td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => handleToggle(s.id)}
                  className={`relative inline-flex h-5 w-9 items-center transition-colors ${
                    s.enabled
                      ? "bg-gold-dim border border-gold"
                      : "bg-deep border border-border-mid"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full transition-transform ${
                      s.enabled
                        ? "translate-x-[18px] bg-gold-bright"
                        : "translate-x-1 bg-text-dim"
                    }`}
                  />
                </button>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => router.push(`/reports/${s.report.id}/schedule`)}
                  className="btn-subtle"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
