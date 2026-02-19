"use client";

import { useState, useEffect } from "react";
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

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SchedulesPage() {
  const router = useRouter();
  const toast = useToast();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/schedules")
      .then((r) => r.json())
      .then(setSchedules)
      .catch(() => toast.error("Failed to load schedules"))
      .finally(() => setLoading(false));
  }, [toast]);

  async function handleToggle(id: string) {
    try {
      const res = await fetch(`/api/schedules/${id}/toggle`, { method: "POST" });
      if (!res.ok) {
        toast.error("Toggle failed");
        return;
      }
      const updated = await res.json();
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, enabled: updated.enabled, nextRunAt: updated.nextRunAt }
            : s
        )
      );
      toast.success(updated.enabled ? "Schedule enabled" : "Schedule paused");
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schedules</h1>
        <p className="text-gray-400 mt-1">
          View and manage report delivery schedules.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-5 animate-pulse h-20" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">No scheduled reports yet.</p>
          <p className="text-gray-600 text-sm mt-1">
            Create a report and add a schedule to get started.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Report</th>
                <th className="text-left px-4 py-3 font-medium">Frequency</th>
                <th className="text-left px-4 py-3 font-medium">Next Run</th>
                <th className="text-left px-4 py-3 font-medium">Recipients</th>
                <th className="text-center px-4 py-3 font-medium">Enabled</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-white">
                    {s.report.name}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {describeFrequency(s)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {s.nextRunAt
                      ? new Date(s.nextRunAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {s.recipients.length} recipient{s.recipients.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggle(s.id)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        s.enabled ? "bg-blue-600" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          s.enabled ? "translate-x-4" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => router.push(`/reports/${s.report.id}/schedule`)}
                      className="text-gray-400 hover:text-white text-sm transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
