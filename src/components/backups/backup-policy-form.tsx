"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { COMMON_TIMEZONES, OTHER_TIMEZONES } from "@/lib/timezones";
import { StorageTargetForm } from "./storage-target-form";

interface ConnectionOption {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

interface StorageTargetOption {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
}

interface DatabaseInfo {
  name: string;
  owner?: string;
  sizeBytes?: string;
  canConnect?: boolean;
}

interface BackupPolicyFormProps {
  policyId?: string;
}

const FULL_FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const WAL_FREQUENCIES = [
  { value: "HOURLY", label: "Hourly" },
  { value: "EVERY_4_HOURS", label: "Every 4 hours" },
  { value: "EVERY_12_HOURS", label: "Every 12 hours" },
  { value: "DAILY", label: "Daily" },
];

function cleanPrefix(value: unknown, fallback = "niflheim"): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().replace(/^\/+|\/+$/g, "") || fallback;
}

function connectionScope(connection: ConnectionOption | null): "DATABASE" | "SERVER" {
  return connection?.config?.scope === "SERVER" ? "SERVER" : "DATABASE";
}

function configuredDatabase(connection: ConnectionOption | null): string {
  const database = connection?.config?.database;
  return typeof database === "string" && database.trim() ? database.trim() : "postgres";
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function BackupPolicyForm({ policyId }: BackupPolicyFormProps) {
  const isEdit = !!policyId;
  const router = useRouter();
  const toast = useToast();
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [targets, setTargets] = useState<StorageTargetOption[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [storageTargetId, setStorageTargetId] = useState("");
  const [fullFrequency, setFullFrequency] = useState("DAILY");
  const [walFrequency, setWalFrequency] = useState("HOURLY");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [timeHour, setTimeHour] = useState(2);
  const [timeMinute, setTimeMinute] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [storagePrefix, setStoragePrefix] = useState("");
  const [databaseSelectionMode, setDatabaseSelectionMode] = useState("SINGLE");
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [excludedDatabases, setExcludedDatabases] = useState<string[]>([]);
  const [databasePattern, setDatabasePattern] = useState("");
  const [discoveredDatabases, setDiscoveredDatabases] = useState<DatabaseInfo[]>([]);
  const [discoveringDatabases, setDiscoveringDatabases] = useState(false);
  const [walEnabled, setWalEnabled] = useState(false);
  const [replicationSlot, setReplicationSlot] = useState("");
  const [enabled, setEnabled] = useState(true);

  const selectedSource = connections.find((connection) => connection.id === sourceConnectionId) ?? null;
  const sourceScope = connectionScope(selectedSource);
  const sourceDatabase = configuredDatabase(selectedSource);

  const loadTargets = useCallback(async () => {
    const res = await fetch("/api/backups/storage-targets");
    if (!res.ok) throw new Error("Failed to load storage targets");
    setTargets(await res.json());
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/connections").then((res) => res.json()),
      fetch("/api/backups/storage-targets").then((res) => res.json()),
    ])
      .then(([connectionData, targetData]) => {
        setConnections((connectionData as ConnectionOption[]).filter((conn) => conn.type === "POSTGRES"));
        setTargets(targetData as StorageTargetOption[]);
      })
      .catch(() => toast.error("Failed to load backup form data"));
  }, [toast]);

  useEffect(() => {
    if (!policyId) return;
    fetch(`/api/backups/policies/${policyId}`)
      .then((res) => res.json())
      .then((policy) => {
        setName(policy.name ?? "");
        setSourceConnectionId(policy.sourceConnectionId ?? "");
        setStorageTargetId(policy.storageTargetId ?? "");
        setFullFrequency(policy.fullFrequency ?? "DAILY");
        setWalFrequency(policy.walFrequency ?? "HOURLY");
        setTimezone(policy.timezone ?? "America/Chicago");
        setTimeHour(policy.timeHour ?? 2);
        setTimeMinute(policy.timeMinute ?? 0);
        setRetentionDays(policy.retentionDays ?? 30);
        setStoragePrefix(policy.storagePrefix ?? "");
        setDatabaseSelectionMode(policy.databaseSelectionMode ?? "SINGLE");
        setSelectedDatabases(Array.isArray(policy.selectedDatabases) ? policy.selectedDatabases : []);
        setExcludedDatabases(Array.isArray(policy.excludedDatabases) ? policy.excludedDatabases : []);
        setDatabasePattern(policy.databasePattern ?? "");
        setWalEnabled(!!policy.walEnabled);
        setReplicationSlot(policy.replicationSlot ?? "");
        setEnabled(policy.enabled ?? true);
      })
      .catch(() => toast.error("Failed to load backup policy"))
      .finally(() => setLoading(false));
  }, [policyId, toast]);

  useEffect(() => {
    setDiscoveredDatabases([]);
    if (!selectedSource) return;
    if (sourceScope === "DATABASE") {
      setDatabaseSelectionMode("SINGLE");
      setSelectedDatabases([sourceDatabase]);
      setExcludedDatabases([]);
      setDatabasePattern("");
    }
  }, [selectedSource, sourceScope, sourceDatabase]);

  async function discoverDatabases() {
    if (!sourceConnectionId) return;
    setDiscoveringDatabases(true);
    try {
      const res = await fetch(`/api/connections/${sourceConnectionId}/postgres/databases`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to discover databases");
      const databases = (data.databases ?? []) as DatabaseInfo[];
      setDiscoveredDatabases(databases);
      if (sourceScope === "SERVER" && databaseSelectionMode === "SINGLE" && selectedDatabases.length === 0 && databases[0]) {
        setSelectedDatabases([databases[0].name]);
      }
      toast.success("Databases discovered");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to discover databases");
    } finally {
      setDiscoveringDatabases(false);
    }
  }

  function toggleSelectedDatabase(database: string) {
    setSelectedDatabases((current) => {
      if (databaseSelectionMode === "SINGLE") return [database];
      return current.includes(database)
        ? current.filter((item) => item !== database)
        : [...current, database];
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name,
        sourceConnectionId,
        storageTargetId,
        fullFrequency,
        walFrequency,
        timezone,
        timeHour,
        timeMinute,
        retentionDays,
        storagePrefix: storagePrefix || undefined,
        databaseSelectionMode,
        selectedDatabases,
        excludedDatabases,
        databasePattern: databasePattern || undefined,
        walEnabled,
        replicationSlot: walEnabled ? replicationSlot : undefined,
        enabled,
      };
      const res = await fetch(isEdit ? `/api/backups/policies/${policyId}` : "/api/backups/policies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save backup policy");
      toast.success(isEdit ? "Backup policy updated" : "Backup policy created");
      router.push(isEdit ? `/backups/${policyId}` : "/backups");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save backup policy");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading backup policy...</span>
      </div>
    );
  }

  const databaseSelectionValid = sourceScope === "DATABASE" ||
    databaseSelectionMode === "ALL_NON_TEMPLATE" ||
    (databaseSelectionMode === "PATTERN" && !!databasePattern.trim()) ||
    (databaseSelectionMode === "SINGLE" && selectedDatabases.length === 1) ||
    (databaseSelectionMode === "MULTIPLE" && selectedDatabases.length > 0);
  const canSave = !!name &&
    !!sourceConnectionId &&
    !!storageTargetId &&
    databaseSelectionValid &&
    (!walEnabled || (sourceScope === "SERVER" && !!replicationSlot));
  const artifactPrefix = cleanPrefix(storagePrefix, "niflheim");

  return (
    <div className="max-w-5xl mx-auto grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="heading-norse text-lg">
            {isEdit ? "Niflheim Policy" : "Forge Niflheim Policy"}
          </h1>
          {isEdit && (
            <button
              onClick={() => router.push(`/backups/${policyId}/history`)}
              className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase"
            >
              History
            </button>
          )}
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Policy</h2>
          <div className="space-y-4">
            <div>
              <label className="label-norse">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="input-norse"
                placeholder="Production PostgreSQL Backups"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="accent-gold"
              />
              <span className="text-text-dim text-xs tracking-wider">Policy enabled</span>
            </label>
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Source And Storage</h2>
          <div className="space-y-4">
            <div>
              <label className="label-norse">PostgreSQL Connection</label>
              <select
                value={sourceConnectionId}
                onChange={(event) => {
                  setSourceConnectionId(event.target.value);
                  setSelectedDatabases([]);
                  setExcludedDatabases([]);
                  setDatabasePattern("");
                }}
                className="select-norse"
              >
                <option value="">Select PostgreSQL source...</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.config?.scope === "SERVER"
                      ? `${connection.name} (server via ${String(connection.config?.maintenanceDatabase ?? "postgres")})`
                      : `${connection.name} (${String(connection.config?.database ?? "postgres")})`}
                  </option>
                ))}
              </select>
            </div>

            {selectedSource && (
              <div className="border border-border bg-void/30 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="label-norse">Database Coverage</p>
                    <p className="text-text-dim text-xs tracking-wide leading-5 mt-1">
                      {sourceScope === "SERVER"
                        ? "Full logical backups run once per selected database. WAL archives are server-level for the PostgreSQL cluster."
                        : `This database-scoped connection backs up ${sourceDatabase}.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={discoverDatabases}
                    disabled={discoveringDatabases}
                    className="btn-ghost px-3 py-2 text-[0.65rem] tracking-[0.15em] uppercase whitespace-nowrap"
                  >
                    {discoveringDatabases ? "Discovering..." : "Discover Databases"}
                  </button>
                </div>

                {sourceScope === "SERVER" && (
                  <>
                    <div>
                      <label className="label-norse">Selection Mode</label>
                      <select
                        value={databaseSelectionMode}
                        onChange={(event) => {
                          setDatabaseSelectionMode(event.target.value);
                          setSelectedDatabases([]);
                        }}
                        className="select-norse"
                      >
                        <option value="SINGLE">Single database</option>
                        <option value="MULTIPLE">Multiple databases</option>
                        <option value="ALL_NON_TEMPLATE">All non-template databases</option>
                        <option value="PATTERN">Pattern</option>
                      </select>
                    </div>

                    {databaseSelectionMode === "PATTERN" && (
                      <div>
                        <label className="label-norse">Database Pattern</label>
                        <input
                          value={databasePattern}
                          onChange={(event) => setDatabasePattern(event.target.value)}
                          className="input-norse font-mono text-xs"
                          placeholder="^(prod|app)_"
                        />
                        <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
                          Hermod treats this as a regular expression matched against discovered database names.
                        </p>
                      </div>
                    )}

                    {databaseSelectionMode !== "PATTERN" && databaseSelectionMode !== "ALL_NON_TEMPLATE" && (
                      <div>
                        <label className="label-norse">Selected Databases</label>
                        {discoveredDatabases.length === 0 ? (
                          <p className="text-text-dim text-xs tracking-wide leading-5">
                            Run discovery to choose databases from this server.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {discoveredDatabases.map((database) => (
                              <label key={database.name} className="flex items-center gap-2 border border-border bg-deep/60 p-2 cursor-pointer">
                                <input
                                  type={databaseSelectionMode === "SINGLE" ? "radio" : "checkbox"}
                                  checked={selectedDatabases.includes(database.name)}
                                  onChange={() => toggleSelectedDatabase(database.name)}
                                  className="accent-gold"
                                />
                                <span className="text-text-dim text-xs tracking-wide">{database.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {(databaseSelectionMode === "ALL_NON_TEMPLATE" || databaseSelectionMode === "PATTERN") && (
                      <div>
                        <label className="label-norse">Excluded Databases</label>
                        <input
                          value={excludedDatabases.join(", ")}
                          onChange={(event) => setExcludedDatabases(commaList(event.target.value))}
                          className="input-norse font-mono text-xs"
                          placeholder="postgres, analytics_tmp"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div>
              <label className="label-norse">Storage Target</label>
              <select
                value={storageTargetId}
                onChange={(event) => setStorageTargetId(event.target.value)}
                className="select-norse"
              >
                <option value="">Select storage target...</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.provider})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-norse">Prefix</label>
              <input
                value={storagePrefix}
                onChange={(event) => setStoragePrefix(event.target.value)}
                className="input-norse"
                placeholder="niflheim/prod"
              />
              <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
                Backups will write under <span className="text-gold font-mono">{artifactPrefix}</span>. S3 storage targets use
                bucket-wide object access, so this path can be chosen per policy.
              </p>
            </div>
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Schedule</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-norse">Full Backup Frequency</label>
              <select
                value={fullFrequency}
                onChange={(event) => setFullFrequency(event.target.value)}
                className="select-norse"
              >
                {FULL_FREQUENCIES.map((freq) => (
                  <option key={freq.value} value={freq.value}>{freq.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-norse">Hour</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={timeHour}
                onChange={(event) => setTimeHour(Number(event.target.value))}
                className="input-norse"
              />
            </div>
            <div>
              <label className="label-norse">Minute</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={timeMinute}
                onChange={(event) => setTimeMinute(Number(event.target.value))}
                className="input-norse"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label-norse">Timezone</label>
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="select-norse"
              >
                <optgroup label="Common">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </optgroup>
                <optgroup label="All Timezones">
                  {OTHER_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Retention And WAL</h2>
          <div className="space-y-4">
            <div>
              <label className="label-norse">Retention Days</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.target.value))}
                className="input-norse"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={walEnabled}
                onChange={(event) => setWalEnabled(event.target.checked)}
                className="accent-gold"
              />
              <span className="text-text-dim text-xs tracking-wider">Enable WAL/PITR coverage</span>
            </label>
            {walEnabled && sourceScope !== "SERVER" && (
              <div className="border border-ember/30 bg-ember/10 p-3 text-ember text-xs tracking-wide leading-6">
                WAL transaction logs are server-level. Choose a SERVER-scoped PostgreSQL connection to enable PITR coverage.
              </div>
            )}
            {walEnabled && (
              <>
                <div>
                  <label className="label-norse">WAL Frequency</label>
                  <select
                    value={walFrequency}
                    onChange={(event) => setWalFrequency(event.target.value)}
                    className="select-norse"
                  >
                    {WAL_FREQUENCIES.map((freq) => (
                      <option key={freq.value} value={freq.value}>{freq.label}</option>
                    ))}
                  </select>
                  <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
                    WAL archives are scheduled only when WAL/PITR coverage is enabled.
                  </p>
                </div>
                <div>
                  <label className="label-norse">Replication Slot</label>
                  <input
                    value={replicationSlot}
                    onChange={(event) => setReplicationSlot(event.target.value)}
                    className="input-norse font-mono text-xs"
                    placeholder="hermod_niflheim_slot"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mb-12">
          <button
            onClick={() => router.push("/backups")}
            className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase"
          >
            {saving ? "Saving..." : isEdit ? "Update Policy" : "Create Policy"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <StorageTargetForm
          onCreated={() => {
            loadTargets().catch(() => toast.error("Failed to refresh storage targets"));
          }}
        />
      </div>
    </div>
  );
}
