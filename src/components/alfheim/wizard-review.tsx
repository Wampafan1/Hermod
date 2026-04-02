"use client";

import { useState, useMemo, useCallback } from "react";

/* ───────────────────────── Types ───────────────────────── */

interface SelectedObject {
  slug: string;
  name: string;
  endpoint: string;
  schema: { columns: { jsonPath: string; columnName: string; dataType: string; nullable: boolean }[] };
  incrementalKey?: string | null;
}

interface DestinationConfig {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  dataset?: string;
  tablePrefix: string;
  writeDisposition: "WRITE_APPEND" | "WRITE_TRUNCATE";
  incrementalSync: boolean;
}

interface VariantInfo {
  key: string;
  label: string;
  objectPrefix: string;
  authType: string;
  baseUrl: string;
  pagination: Record<string, unknown>;
  headerName?: string;
  tokenPrefix?: string;
}

interface WizardReviewProps {
  connector: {
    slug: string;
    name: string;
    authType: string;
    authConfig: Record<string, unknown>;
    baseUrl: string;
  };
  credentials: Record<string, string>;
  resolvedBaseUrl: string;
  selectedObjects: SelectedObject[];
  destinationConfig: DestinationConfig;
  selectedVariant?: VariantInfo;
  onComplete: () => void;
  onBack: () => void;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving"; message: string }
  | { status: "success" }
  | { status: "error"; message: string };

const FREQUENCY_OPTIONS = [
  { value: "", label: "No schedule (manual only)" },
  { value: "EVERY_15_MIN", label: "Every 15 minutes" },
  { value: "EVERY_30_MIN", label: "Every 30 minutes" },
  { value: "HOURLY", label: "Every hour" },
  { value: "EVERY_4_HOURS", label: "Every 4 hours" },
  { value: "EVERY_12_HOURS", label: "Every 12 hours" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
] as const;

function to24Hour(hour12: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

/** Frequencies that show the time picker (daily+) */
const TIME_FREQUENCIES = new Set(["DAILY", "WEEKLY"]);

/* ───────────────────────── Helpers ─────────────────────── */

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return "****" + value.slice(-4);
}

/** Sanitize table name: lowercase, replace hyphens/spaces with underscores */
function sanitizeTableName(name: string): string {
  return name.toLowerCase().replace(/[-\s]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function writeDispositionLabel(wd: string): string {
  switch (wd) {
    case "WRITE_TRUNCATE":
      return "Truncate & Reload";
    case "WRITE_APPEND":
      return "Append";
    default:
      return wd;
  }
}

/* ───────────────────────── Component ──────────────────── */

export function WizardReview({
  connector,
  credentials,
  resolvedBaseUrl,
  selectedObjects,
  destinationConfig,
  selectedVariant,
  onComplete,
  onBack,
}: WizardReviewProps) {
  // Resolve effective auth/pagination from variant or connector-level
  const effectiveAuthType = selectedVariant?.authType ?? connector.authType;
  const effectiveAuthConfig = selectedVariant
    ? { headerName: selectedVariant.headerName, tokenPrefix: selectedVariant.tokenPrefix }
    : (connector.authConfig ?? {});
  const effectivePagination = selectedVariant?.pagination
    ?? (connector.authConfig as Record<string, unknown>)?.pagination
    ?? {};

  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [frequency, setFrequency] = useState("");
  const [hour12, setHour12] = useState(7);
  const [minute, setMinute] = useState(0);
  const [ampm, setAmpm] = useState<"AM" | "PM">("AM");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Monday
  const [timezone] = useState("America/Chicago");

  const showTimePicker = TIME_FREQUENCIES.has(frequency);
  const showDayPicker = frequency === "WEEKLY";

  const tableNames = useMemo(
    () =>
      selectedObjects.map(
        (o) => sanitizeTableName(`${destinationConfig.tablePrefix}_${o.slug}`),
      ),
    [selectedObjects, destinationConfig.tablePrefix],
  );

  const syncMode = destinationConfig.incrementalSync
    ? "Incremental"
    : "Full Reload";

  const handleCreate = useCallback(async () => {
    setSaveState({ status: "saving", message: "Creating connection..." });

    try {
      /* ── Step 1: Create the REST_API connection ── */
      const connRes = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${connector.name} API`,
          type: "REST_API",
          config: {
            catalogSlug: connector.slug,
            baseUrl: resolvedBaseUrl,
            authType: effectiveAuthType,
            authConfig: effectiveAuthConfig,
            pagination: effectivePagination,
            selectedObjects: selectedObjects.map((o) => o.slug),
          },
          credentials,
        }),
      });

      if (!connRes.ok) {
        const err = await connRes.json().catch(() => ({}));
        throw new Error(
          err.error ?? `Failed to create connection (${connRes.status})`,
        );
      }

      const newConnection = await connRes.json();
      const sourceId: string = newConnection.id;

      /* ── Step 2: Create a BifrostRoute for each object ── */
      setSaveState({
        status: "saving",
        message: `Creating routes (0/${selectedObjects.length})...`,
      });

      for (let i = 0; i < selectedObjects.length; i++) {
        const obj = selectedObjects[i];

        setSaveState({
          status: "saving",
          message: `Creating routes (${i + 1}/${selectedObjects.length})...`,
        });

        const routeBody = {
          name: `${connector.name} \u2014 ${obj.name}`,
          sourceId,
          sourceConfig: {
            query: obj.endpoint,
            dataset: "",
            objectSlug: obj.slug,
            incrementalKey: obj.incrementalKey ?? undefined,
          },
          destId: destinationConfig.connectionId,
          destConfig: {
            dataset: destinationConfig.dataset ?? "",
            table: sanitizeTableName(`${destinationConfig.tablePrefix}_${obj.slug}`),
            writeDisposition: destinationConfig.writeDisposition,
            autoCreateTable: true,
          },
          transformEnabled: false,
          blueprintId: null,
          frequency: frequency || null,
          daysOfWeek: showDayPicker ? daysOfWeek : [],
          dayOfMonth: null,
          timeHour: showTimePicker ? to24Hour(hour12, ampm) : 7,
          timeMinute: showTimePicker ? minute : 0,
          timezone,
          cursorConfig: null,
        };

        const routeRes = await fetch("/api/bifrost/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(routeBody),
        });

        if (!routeRes.ok) {
          const err = await routeRes.json().catch(() => ({}));
          throw new Error(
            err.error ??
              `Failed to create route for ${obj.name} (${routeRes.status})`,
          );
        }
      }

      /* ── Step 3: Done ── */
      setSaveState({ status: "success" });
      // Small delay so the user sees the success state
      setTimeout(() => onComplete(), 800);
    } catch (err) {
      setSaveState({
        status: "error",
        message: err instanceof Error ? err.message : "An error occurred",
      });
    }
  }, [
    connector,
    credentials,
    resolvedBaseUrl,
    selectedObjects,
    destinationConfig,
    onComplete,
  ]);

  const isSaving = saveState.status === "saving";

  return (
    <div>
      {/* Header */}
      <h2 className="heading-norse text-lg">Review &amp; Create</h2>
      <p className="text-text-dim text-xs tracking-wide mt-1">
        Confirm your configuration before creating the routes
      </p>

      {/* Summary sections */}
      <div className="mt-6 space-y-5">
        {/* Source */}
        <section className="card-norse">
          <h3 className="label-norse mb-2">Source</h3>
          <div className="flex items-center gap-2">
            <span className="text-text text-sm font-cinzel uppercase tracking-[0.06em]">
              {connector.name}
            </span>
            <span className="badge-neutral">{connector.authType}</span>
          </div>
        </section>

        {/* Credentials */}
        <section className="card-norse">
          <h3 className="label-norse mb-2">Credentials</h3>
          <div className="space-y-1">
            {Object.entries(credentials).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="text-text-dim font-space-grotesk uppercase tracking-wide">
                  {key}:
                </span>
                <span className="text-text font-inconsolata">
                  {maskValue(value)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Objects */}
        <section className="card-norse">
          <h3 className="label-norse mb-2">
            Objects ({selectedObjects.length})
          </h3>
          <div className="space-y-1">
            {selectedObjects.map((obj) => (
              <div key={obj.slug} className="flex items-center gap-2 text-xs">
                <span className="text-text font-cinzel uppercase tracking-[0.04em]">
                  {obj.name}
                </span>
                <span className="badge-neutral">
                  {obj.schema.columns.length} col
                  {obj.schema.columns.length !== 1 ? "s" : ""}
                </span>
                {obj.incrementalKey && (
                  <span className="text-[10px] tracking-wide font-space-grotesk uppercase px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-700/30">
                    &#x27F3; Incremental
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Destination */}
        <section className="card-norse">
          <h3 className="label-norse mb-2">Destination</h3>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-text font-cinzel uppercase tracking-[0.06em]">
                {destinationConfig.connectionName}
              </span>
              <span className="badge-neutral">
                {destinationConfig.connectionType}
              </span>
            </div>
            {destinationConfig.dataset && (
              <p className="text-text-dim">
                Dataset:{" "}
                <span className="text-text font-inconsolata">
                  {destinationConfig.dataset}
                </span>
              </p>
            )}
            <p className="text-text-dim">
              Table prefix:{" "}
              <span className="text-text font-inconsolata">
                {destinationConfig.tablePrefix}
              </span>
            </p>
            <p className="text-text-dim">
              Write mode:{" "}
              <span className="text-text">
                {writeDispositionLabel(destinationConfig.writeDisposition)}
              </span>
            </p>
            <p className="text-text-dim">
              Sync mode:{" "}
              <span className="text-text">{syncMode}</span>
            </p>
          </div>
        </section>

        {/* Schedule */}
        <section className="card-norse" aria-labelledby="schedule-heading">
          <h3 id="schedule-heading" className="label-norse mb-3">Schedule</h3>
          <div className="space-y-3">
            {/* Frequency */}
            <div>
              <label htmlFor="sched-frequency" className="sr-only">Frequency</label>
              <select
                id="sched-frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="input-norse w-full"
              >
                {FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Time picker (daily / weekly) */}
            {showTimePicker && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-text-dim text-xs tracking-wide">at</span>
                <select
                  value={hour12}
                  onChange={(e) => setHour12(Number(e.target.value))}
                  className="input-norse w-20"
                  aria-label="Hour"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <span className="text-text-dim" aria-hidden="true">:</span>
                <select
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                  className="input-norse w-20"
                  aria-label="Minute"
                >
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                  ))}
                </select>
                <select
                  value={ampm}
                  onChange={(e) => setAmpm(e.target.value as "AM" | "PM")}
                  className="input-norse w-20"
                  aria-label="AM or PM"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            )}

            {/* Day of week picker (weekly) */}
            {showDayPicker && (
              <div className="flex flex-wrap gap-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => (
                  <button
                    key={day}
                    type="button"
                    className={`px-2.5 py-1 text-xs border transition-colors ${
                      daysOfWeek.includes(idx)
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border text-text-dim hover:border-gold-dim"
                    }`}
                    onClick={() =>
                      setDaysOfWeek((prev) =>
                        prev.includes(idx)
                          ? prev.filter((d) => d !== idx)
                          : [...prev, idx].sort(),
                      )
                    }
                  >
                    {day}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Table Preview */}
        <section className="card-norse">
          <h3 className="label-norse mb-2">
            Tables to Create ({tableNames.length})
          </h3>
          <div className="space-y-0.5">
            {tableNames.map((name) => (
              <p
                key={name}
                className="text-xs text-gold font-inconsolata tracking-wide"
              >
                {name}
              </p>
            ))}
          </div>
        </section>
      </div>

      {/* Status messages */}
      {saveState.status === "saving" && (
        <div className="mt-4 flex items-center gap-2 text-text-dim text-xs">
          <span
            className="spinner-norse"
            style={{ width: 14, height: 14 }}
          />
          {saveState.message}
        </div>
      )}

      {saveState.status === "success" && (
        <p className="mt-4 text-sm text-emerald-400">
          &#10003; Routes created successfully
        </p>
      )}

      {saveState.status === "error" && (
        <p className="mt-4 text-sm text-red-400">
          {saveState.message}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
        >
          &#8592; Back
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isSaving || saveState.status === "success"}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <span
                className="spinner-norse"
                style={{ width: 14, height: 14 }}
              />
              Creating routes...
            </span>
          ) : saveState.status === "success" ? (
            "Routes created!"
          ) : (
            "Create Routes"
          )}
        </button>
      </div>
    </div>
  );
}
