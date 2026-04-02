"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { PROVIDER_CAPABILITIES } from "@/lib/providers/capabilities";
import type { ConnectionType } from "@/lib/providers/types";

/* ───────────────────────── Types ───────────────────────── */

export interface DestinationConfig {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  dataset?: string;
  tablePrefix: string;
  writeDisposition: "WRITE_APPEND" | "WRITE_TRUNCATE";
  incrementalSync: boolean;
}

interface SelectedObject {
  slug: string;
  name: string;
  incrementalKey?: string | null;
}

interface WizardDestinationProps {
  selectedObjects: SelectedObject[];
  onComplete: (config: DestinationConfig) => void;
  onBack: () => void;
}

interface ConnectionRow {
  id: string;
  name: string;
  type: ConnectionType;
  status: string;
}

/* ────────────────── Destination-capable types ──────────── */

const DESTINATION_TYPES = new Set<ConnectionType>(
  (Object.entries(PROVIDER_CAPABILITIES) as [ConnectionType, { canBeDestination: boolean }][])
    .filter(([, caps]) => caps.canBeDestination)
    .map(([type]) => type),
);

/* ─────────────────────── Component ────────────────────── */

export function WizardDestination({
  selectedObjects,
  onComplete,
  onBack,
}: WizardDestinationProps) {
  /* ── Connection fetch state ── */
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /* ── Form state ── */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dataset, setDataset] = useState("");
  const [tablePrefix, setTablePrefix] = useState("");
  const [writeDisposition, setWriteDisposition] = useState<
    "WRITE_APPEND" | "WRITE_TRUNCATE"
  >("WRITE_TRUNCATE");
  const [incrementalSync, setIncrementalSync] = useState(false);

  /* ── Fetch connections on mount ── */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/connections");
        if (!res.ok) {
          throw new Error(`Failed to fetch connections (${res.status})`);
        }
        const data: ConnectionRow[] = await res.json();
        if (!cancelled) {
          setConnections(data.filter((c) => DESTINATION_TYPES.has(c.type)));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Failed to load connections",
          );
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Derived values ── */
  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  const hasIncrementalCandidates = useMemo(
    () => selectedObjects.some((o) => o.incrementalKey),
    [selectedObjects],
  );

  const isValid = useMemo(
    () =>
      selectedId !== null &&
      dataset.trim().length > 0 &&
      tablePrefix.trim().length > 0,
    [selectedId, dataset, tablePrefix],
  );

  /* ── Example table names ── */
  const exampleTables = useMemo(() => {
    const prefix = tablePrefix.trim() || "prefix";
    return selectedObjects
      .slice(0, 3)
      .map((o) => `${prefix}_${o.slug}`)
      .join(", ");
  }, [tablePrefix, selectedObjects]);

  /* ── Handlers ── */
  const handleSelectConnection = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleNext = useCallback(() => {
    if (!selectedConnection || !isValid) return;

    onComplete({
      connectionId: selectedConnection.id,
      connectionName: selectedConnection.name,
      connectionType: selectedConnection.type,
      dataset: dataset.trim(),
      tablePrefix: tablePrefix.trim(),
      writeDisposition,
      incrementalSync,
    });
  }, [
    selectedConnection,
    isValid,
    dataset,
    tablePrefix,
    writeDisposition,
    incrementalSync,
    onComplete,
  ]);

  /* ── Render ── */
  return (
    <div>
      {/* Header */}
      <h2 className="heading-norse text-lg">Choose Destination</h2>
      <p className="text-text-dim text-xs tracking-wide mt-1">
        Where should the data be delivered?
      </p>

      {/* Connection picker */}
      <div className="mt-6">
        <span className="label-norse block mb-2">Destination Connection</span>

        {loading && (
          <p className="text-text-dim text-xs flex items-center gap-2">
            <span
              className="spinner-norse"
              style={{ width: 14, height: 14 }}
            />
            Loading connections...
          </p>
        )}

        {fetchError && (
          <p className="text-sm text-red-400">
            {fetchError}
          </p>
        )}

        {!loading && !fetchError && connections.length === 0 && (
          <p className="text-text-dim text-xs">
            No destination-capable connections found. Create a BigQuery or SFTP
            connection first.
          </p>
        )}

        {!loading && connections.length > 0 && (
          <div className="space-y-2">
            {connections.map((conn) => {
              const isSelected = conn.id === selectedId;
              return (
                <button
                  key={conn.id}
                  type="button"
                  onClick={() => handleSelectConnection(conn.id)}
                  className={`card-norse w-full text-left flex items-center gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? "border-l-2 border-l-gold bg-gold/[0.04]"
                      : ""
                  }`}
                >
                  <span className="font-cinzel text-sm text-text uppercase tracking-[0.06em]">
                    {conn.name}
                  </span>
                  <span className="badge-neutral">{conn.type}</span>
                  {conn.status === "ACTIVE" && (
                    <span className="text-[10px] tracking-wide font-space-grotesk uppercase px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-700/30">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Config fields — shown after selecting a connection */}
      {selectedConnection && (
        <div className="mt-6 space-y-5">
          {/* Dataset / Schema */}
          <div>
            <label htmlFor="dest-dataset" className="label-norse block mb-1">
              {selectedConnection.type === "BIGQUERY"
                ? "Dataset"
                : "Schema"}
              <span className="text-gold ml-1">*</span>
            </label>
            <input
              id="dest-dataset"
              type="text"
              className="input-norse w-full"
              placeholder={
                selectedConnection.type === "BIGQUERY"
                  ? "my_dataset"
                  : "public"
              }
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            />
          </div>

          {/* Table Prefix */}
          <div>
            <label
              htmlFor="dest-table-prefix"
              className="label-norse block mb-1"
            >
              Table Prefix
              <span className="text-gold ml-1">*</span>
            </label>
            <input
              id="dest-table-prefix"
              type="text"
              className="input-norse w-full"
              placeholder="netsuite"
              value={tablePrefix}
              onChange={(e) => setTablePrefix(e.target.value)}
            />
            <p className="text-text-dim text-[11px] mt-1 tracking-wide leading-relaxed">
              Tables will be created as{" "}
              <span className="text-gold font-inconsolata">{exampleTables}</span>
              {selectedObjects.length > 3 ? ", ..." : ""}
            </p>
          </div>

          {/* Write Disposition */}
          <div>
            <label
              htmlFor="dest-write-disposition"
              className="label-norse block mb-1"
            >
              Write Disposition
            </label>
            <select
              id="dest-write-disposition"
              className="select-norse w-full"
              value={writeDisposition}
              onChange={(e) =>
                setWriteDisposition(
                  e.target.value as "WRITE_APPEND" | "WRITE_TRUNCATE",
                )
              }
            >
              <option value="WRITE_TRUNCATE">
                Truncate &amp; Reload (replace all data)
              </option>
              <option value="WRITE_APPEND">
                Append (add new rows)
              </option>
            </select>
          </div>

          {/* Incremental Sync — only if any selected object has an incrementalKey */}
          {hasIncrementalCandidates && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={incrementalSync}
                onChange={(e) => setIncrementalSync(e.target.checked)}
                className="accent-gold w-4 h-4"
              />
              <span className="text-text text-xs tracking-wide">
                Enable incremental sync — only fetch records updated since last
                run
              </span>
            </label>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <button type="button" onClick={onBack} className="btn-ghost">
          &#8592; Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!isValid}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next &#8594;
        </button>
      </div>
    </div>
  );
}
