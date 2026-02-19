"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DaySelector } from "./day-selector";
import { RecipientInput } from "./recipient-input";
import { SchedulePreview } from "./schedule-preview";
import { useToast } from "@/components/toast";

type Frequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";

interface Recipient {
  email: string;
  name?: string;
}

interface ScheduleFormProps {
  reportId: string;
  reportName: string;
  existingSchedule?: {
    id: string;
    enabled: boolean;
    frequency: Frequency;
    daysOfWeek: number[];
    dayOfMonth: number | null;
    monthsOfYear: number[];
    timeHour: number;
    timeMinute: number;
    timezone: string;
    emailSubject: string;
    emailBody: string;
    recipients: Recipient[];
  };
}

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ScheduleForm({ reportId, reportName, existingSchedule }: ScheduleFormProps) {
  const router = useRouter();
  const toast = useToast();
  const isEditing = !!existingSchedule;

  const [enabled, setEnabled] = useState(existingSchedule?.enabled ?? true);
  const [frequency, setFrequency] = useState<Frequency>(existingSchedule?.frequency ?? "WEEKLY");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existingSchedule?.daysOfWeek ?? [1]); // Monday
  const [dayOfMonth, setDayOfMonth] = useState<number>(existingSchedule?.dayOfMonth ?? 1);
  const [monthsOfYear, setMonthsOfYear] = useState<number[]>(existingSchedule?.monthsOfYear ?? [1, 4, 7, 10]);
  const [timeHour, setTimeHour] = useState(existingSchedule?.timeHour ?? 8);
  const [timeMinute, setTimeMinute] = useState(existingSchedule?.timeMinute ?? 0);
  const [timezone, setTimezone] = useState(existingSchedule?.timezone ?? "");
  const [recipients, setRecipients] = useState<Recipient[]>(existingSchedule?.recipients ?? []);
  const [emailSubject, setEmailSubject] = useState(existingSchedule?.emailSubject ?? `{report_name} — {date}`);
  const [emailBody, setEmailBody] = useState(existingSchedule?.emailBody ?? "");
  const [previousEmails, setPreviousEmails] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Auto-detect timezone
  useEffect(() => {
    if (!timezone) {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [timezone]);

  // Fetch previous recipient emails
  useEffect(() => {
    fetch("/api/schedules")
      .then((r) => r.json())
      .then((schedules: Array<{ recipients: Recipient[] }>) => {
        const emails = new Set<string>();
        schedules.forEach((s) => s.recipients.forEach((r) => emails.add(r.email)));
        setPreviousEmails(Array.from(emails));
      })
      .catch(() => {});
  }, []);

  // 12-hour display helpers
  const display12Hour = timeHour % 12 || 12;
  const displayAmPm = timeHour < 12 ? "AM" : "PM";

  function setTime12(hour12: number, amPm: string) {
    let h = hour12 % 12;
    if (amPm === "PM") h += 12;
    setTimeHour(h);
  }

  const allTimezones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : COMMON_TIMEZONES;

  async function handleSave() {
    if (recipients.length === 0) {
      toast.error("Add at least one recipient");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        reportId,
        enabled,
        frequency,
        daysOfWeek,
        dayOfMonth: frequency === "MONTHLY" || frequency === "QUARTERLY" ? dayOfMonth : null,
        monthsOfYear: frequency === "QUARTERLY" ? monthsOfYear : [],
        timeHour,
        timeMinute,
        timezone,
        recipients,
        emailSubject,
        emailBody,
      };

      const url = isEditing
        ? `/api/schedules/${existingSchedule!.id}`
        : "/api/schedules";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success(isEditing ? "Schedule updated" : "Schedule created");
      router.push("/schedules");
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isEditing ? "Edit Schedule" : "Schedule Report"}
          </h1>
          <p className="text-gray-400 mt-1">{reportName}</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? "bg-blue-600" : "bg-gray-700"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Frequency */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Biweekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
        </select>
      </div>

      {/* Day selector */}
      {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
        <div>
          <label className="block text-sm text-gray-400 mb-2">Days</label>
          <DaySelector selected={daysOfWeek} onChange={setDaysOfWeek} />
        </div>
      )}

      {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
        <div>
          <label className="block text-sm text-gray-400 mb-2">Day of Month</label>
          <select
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value={0}>Last day</option>
          </select>
        </div>
      )}

      {frequency === "QUARTERLY" && (
        <div>
          <label className="block text-sm text-gray-400 mb-2">Months</label>
          <div className="flex flex-wrap gap-2">
            {MONTH_NAMES.map((name, index) => {
              const month = index + 1;
              const selected = monthsOfYear.includes(month);
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() =>
                    setMonthsOfYear(
                      selected
                        ? monthsOfYear.filter((m) => m !== month)
                        : [...monthsOfYear, month]
                    )
                  }
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Time</label>
        <div className="flex gap-2">
          <select
            value={display12Hour}
            onChange={(e) => setTime12(Number(e.target.value), displayAmPm)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <select
            value={timeMinute}
            onChange={(e) => setTimeMinute(Number(e.target.value))}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {[0, 15, 30, 45].map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
          <select
            value={displayAmPm}
            onChange={(e) => setTime12(display12Hour, e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      </div>

      {/* Timezone */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Timezone</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <optgroup label="Common">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </optgroup>
          <optgroup label="All Timezones">
            {allTimezones
              .filter((tz) => !COMMON_TIMEZONES.includes(tz))
              .map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
          </optgroup>
        </select>
      </div>

      {/* Recipients */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Recipients</label>
        <RecipientInput
          recipients={recipients}
          onChange={setRecipients}
          previousEmails={previousEmails}
        />
      </div>

      {/* Email Subject */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Email Subject</label>
        <input
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="{report_name} — {date}"
        />
        <p className="text-xs text-gray-500 mt-1">
          Variables: {"{report_name}"}, {"{date}"}, {"{day_of_week}"}, {"{row_count}"}, {"{run_time}"}, {"{connection_name}"}
        </p>
      </div>

      {/* Email Body */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">
          Email Body (optional)
        </label>
        <textarea
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
          rows={4}
          placeholder="Please find the attached report."
        />
      </div>

      {/* Preview */}
      <SchedulePreview
        frequency={frequency}
        daysOfWeek={daysOfWeek}
        dayOfMonth={dayOfMonth}
        monthsOfYear={monthsOfYear}
        timeHour={timeHour}
        timeMinute={timeMinute}
        timezone={timezone}
        recipientCount={recipients.length}
        firstRecipient={recipients[0]?.email}
      />

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full px-4 py-3 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Schedule"}
      </button>
    </div>
  );
}
