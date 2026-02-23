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

interface EmailConnection {
  id: string;
  name: string;
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
    emailConnectionId: string | null;
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
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existingSchedule?.daysOfWeek ?? [1]);
  const [dayOfMonth, setDayOfMonth] = useState<number>(existingSchedule?.dayOfMonth ?? 1);
  const [monthsOfYear, setMonthsOfYear] = useState<number[]>(existingSchedule?.monthsOfYear ?? [1, 4, 7, 10]);
  const [timeHour, setTimeHour] = useState(existingSchedule?.timeHour ?? 8);
  const [timeMinute, setTimeMinute] = useState(existingSchedule?.timeMinute ?? 0);
  const [timezone, setTimezone] = useState(existingSchedule?.timezone ?? "");
  const [recipients, setRecipients] = useState<Recipient[]>(existingSchedule?.recipients ?? []);
  const [emailSubject, setEmailSubject] = useState(existingSchedule?.emailSubject ?? `{report_name} — {date}`);
  const [emailBody, setEmailBody] = useState(existingSchedule?.emailBody ?? "");
  const [emailConnectionId, setEmailConnectionId] = useState(existingSchedule?.emailConnectionId ?? "");
  const [emailConnections, setEmailConnections] = useState<EmailConnection[]>([]);
  const [previousEmails, setPreviousEmails] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!timezone) {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [timezone]);

  useEffect(() => {
    fetch("/api/email-connections")
      .then((r) => r.json())
      .then((conns: EmailConnection[]) => {
        setEmailConnections(conns);
        // Auto-select if only one and none pre-selected
        if (!emailConnectionId && conns.length === 1) {
          setEmailConnectionId(conns[0].id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!emailConnectionId) {
      toast.error("Select an email connection");
      return;
    }
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
        emailConnectionId,
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
          <h1 className="heading-norse text-xl">
            {isEditing ? "Edit Schedule" : "Schedule Report"}
          </h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">{reportName}</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center transition-colors ${
            enabled
              ? "bg-gold-dim border border-gold"
              : "bg-deep border border-border-mid"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full transition-transform ${
              enabled
                ? "translate-x-[22px] bg-gold-bright"
                : "translate-x-1 bg-text-dim"
            }`}
          />
        </button>
      </div>

      {/* Frequency */}
      <div>
        <label className="label-norse">Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          className="select-norse"
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
          <label className="label-norse">Days</label>
          <DaySelector selected={daysOfWeek} onChange={setDaysOfWeek} />
        </div>
      )}

      {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
        <div>
          <label className="label-norse">Day of Month</label>
          <select
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            className="select-norse"
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
          <label className="label-norse">Months</label>
          <div className="flex flex-wrap gap-1">
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
                  className={`px-3 py-1 text-xs tracking-widest uppercase transition-colors ${
                    selected
                      ? "bg-gold-dim border border-gold text-gold-bright"
                      : "bg-surface-raised border border-border text-text-dim hover:text-text"
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
        <label className="label-norse">Time</label>
        <div className="flex gap-2">
          <select
            value={display12Hour}
            onChange={(e) => setTime12(Number(e.target.value), displayAmPm)}
            className="select-norse w-auto"
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
            className="select-norse w-auto"
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
            className="select-norse w-auto"
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      </div>

      {/* Timezone */}
      <div>
        <label className="label-norse">Timezone</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="select-norse"
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

      {/* Email Connection */}
      <div>
        <label className="label-norse">Email Connection</label>
        {emailConnections.length === 0 ? (
          <p className="text-xs text-text-dim tracking-wide">
            No email connections configured.{" "}
            <a href="/connections/new" className="text-gold hover:text-gold-bright underline">
              Add one
            </a>
          </p>
        ) : (
          <select
            value={emailConnectionId}
            onChange={(e) => setEmailConnectionId(e.target.value)}
            className="select-norse"
          >
            <option value="">Select email connection...</option>
            {emailConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Recipients */}
      <div>
        <label className="label-norse">Recipients</label>
        <RecipientInput
          recipients={recipients}
          onChange={setRecipients}
          previousEmails={previousEmails}
        />
      </div>

      {/* Email Subject */}
      <div>
        <label className="label-norse">Email Subject</label>
        <input
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          className="input-norse"
          placeholder="{report_name} — {date}"
        />
        <p className="text-[0.625rem] text-text-dim mt-1 tracking-wide">
          Variables: {"{report_name}"}, {"{date}"}, {"{day_of_week}"}, {"{row_count}"}, {"{run_time}"}, {"{connection_name}"}
        </p>
      </div>

      {/* Email Body */}
      <div>
        <label className="label-norse">Email Body (optional)</label>
        <textarea
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          className="input-norse resize-none"
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
        className="btn-primary w-full py-3"
      >
        <span>{saving ? "Saving..." : "Save Schedule"}</span>
      </button>
    </div>
  );
}
