"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { COMMON_TIMEZONES, OTHER_TIMEZONES } from "@/lib/timezones";
import { MssqlDatabaseSelector } from "./mssql-database-selector";
import { MssqlDestinationModePanel } from "./mssql-destination-mode-panel";
import { MssqlPreflightPanel } from "./mssql-preflight-panel";

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

interface MssqlDatabaseInfo {
  name: string;
  state?: string;
  recoveryModel?: string;
  sizeBytes?: string | number | null;
  canConnect?: boolean;
}

interface MssqlBackupPolicyFormProps {
  policyId?: string;
}

const FULL_FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const DIFFERENTIAL_FREQUENCIES = [
  { value: "", label: "Disabled" },
  { value: "EVERY_4_HOURS", label: "Every 4 hours" },
  { value: "EVERY_6_HOURS", label: "Every 6 hours" },
  { value: "EVERY_12_HOURS", label: "Every 12 hours" },
  { value: "DAILY", label: "Daily" },
];

const LOG_FREQUENCIES = [
  { value: "", label: "Disabled" },
  { value: "EVERY_15_MIN", label: "Every 15 minutes" },
  { value: "EVERY_30_MIN", label: "Every 30 minutes" },
  { value: "HOURLY", label: "Hourly" },
  { value: "EVERY_4_HOURS", label: "Every 4 hours" },
];

function sourceScope(connection: ConnectionOption | null): "DATABASE" | "SERVER" {
  return connection?.config?.scope === "SERVER" ? "SERVER" : "DATABASE";
}

function configuredDatabase(connection: ConnectionOption | null): string {
  const database = connection?.config?.database;
  return typeof database === "string" && database.trim() ? database.trim() : "";
}

export function MssqlBackupPolicyForm({ policyId }: MssqlBackupPolicyFormProps) {
  const isEdit = !!policyId;
  const router = useRouter();
  const toast = useToast();
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [targets, setTargets] = useState<StorageTargetOption[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const [name, setName] = useState("");
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [destinationMode, setDestinationMode] = useState("BACKUP_TO_DISK_SHARED_PATH");
  const [databaseSelectionMode, setDatabaseSelectionMode] = useState("SINGLE");
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [excludedDatabases, setExcludedDatabases] = useState<string[]>([]);
  const [databasePattern, setDatabasePattern] = useState("");
  const [discoveredDatabases, setDiscoveredDatabases] = useState<MssqlDatabaseInfo[]>([]);
  const [storageTargetId, setStorageTargetId] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const [hermodReadablePath, setHermodReadablePath] = useState("");
  const [urlBase, setUrlBase] = useState("");
  const [urlCredentialName, setUrlCredentialName] = useState("");
  const [fullFrequency, setFullFrequency] = useState("DAILY");
  const [differentialFrequency, setDifferentialFrequency] = useState("EVERY_6_HOURS");
  const [logFrequency, setLogFrequency] = useState("HOURLY");
  const [fullTimeHour, setFullTimeHour] = useState(2);
  const [fullTimeMinute, setFullTimeMinute] = useState(0);
  const [timezone, setTimezone] = useState("America/Chicago");
  const [compressionEnabled, setCompressionEnabled] = useState(true);
  const [checksumEnabled, setChecksumEnabled] = useState(true);
  const [copyOnly, setCopyOnly] = useState(false);
  const [verifyAfterBackup, setVerifyAfterBackup] = useState(true);
  const [retentionDays, setRetentionDays] = useState(30);
  const [enabled, setEnabled] = useState(true);

  const selectedSource = connections.find((connection) => connection.id === sourceConnectionId) ?? null;
  const scope = sourceScope(selectedSource);
  const database = configuredDatabase(selectedSource);

  useEffect(() => {
    Promise.all([
      fetch("/api/connections").then((res) => res.json()),
      fetch("/api/backups/storage-targets").then((res) => res.json()),
    ])
      .then(([connectionData, targetData]) => {
        const mssqlConnections = (connectionData as ConnectionOption[]).filter((connection) => connection.type === "MSSQL");
        setConnections(mssqlConnections);
        setTargets(targetData as StorageTargetOption[]);
        if (!sourceConnectionId && mssqlConnections[0]) setSourceConnectionId(mssqlConnections[0].id);
      })
      .catch(() => toast.error("Failed to load SQL Server backup form data"));
  }, [sourceConnectionId, toast]);

  useEffect(() => {
    if (!policyId) return;
    fetch(`/api/backups/mssql/policies/${policyId}`)
      .then((res) => res.json())
      .then((policy) => {
        setName(policy.name ?? "");
        setSourceConnectionId(policy.sourceConnectionId ?? "");
        setDestinationMode(policy.destinationMode ?? "BACKUP_TO_DISK_SHARED_PATH");
        setDatabaseSelectionMode(policy.databaseSelectionMode ?? "SINGLE");
        setSelectedDatabases(Array.isArray(policy.selectedDatabases) ? policy.selectedDatabases : []);
        setExcludedDatabases(Array.isArray(policy.excludedDatabases) ? policy.excludedDatabases : []);
        setDatabasePattern(policy.databasePattern ?? "");
        setStorageTargetId(policy.storageTargetId ?? "");
        setBackupPath(policy.backupPath ?? "");
        setHermodReadablePath(policy.hermodReadablePath ?? "");
        setUrlBase(policy.urlBase ?? "");
        setUrlCredentialName(policy.urlCredentialName ?? "");
        setFullFrequency(policy.fullFrequency ?? "DAILY");
        setDifferentialFrequency(policy.differentialFrequency ?? "");
        setLogFrequency(policy.logFrequency ?? "");
        setFullTimeHour(policy.fullTimeHour ?? 2);
        setFullTimeMinute(policy.fullTimeMinute ?? 0);
        setTimezone(policy.timezone ?? "America/Chicago");
        setCompressionEnabled(policy.compressionEnabled ?? true);
        setChecksumEnabled(policy.checksumEnabled ?? true);
        setCopyOnly(policy.copyOnly ?? false);
        setVerifyAfterBackup(policy.verifyAfterBackup ?? true);
        setRetentionDays(policy.retentionDays ?? 30);
        setEnabled(policy.enabled ?? true);
      })
      .catch(() => toast.error("Failed to load SQL Server backup policy"))
      .finally(() => setLoading(false));
  }, [policyId, toast]);

  useEffect(() => {
    setDiscoveredDatabases([]);
    if (!selectedSource) return;
    if (scope === "DATABASE") {
      setDatabaseSelectionMode("SINGLE");
      setSelectedDatabases(database ? [database] : []);
      setExcludedDatabases([]);
      setDatabasePattern("");
    }
  }, [selectedSource, scope, database]);

  const payload = useMemo(() => ({
    name,
    sourceConnectionId,
    storageTargetId: storageTargetId || undefined,
    destinationMode,
    databaseSelectionMode,
    selectedDatabases,
    excludedDatabases,
    databasePattern: databasePattern || undefined,
    fullFrequency,
    differentialFrequency: differentialFrequency || null,
    logFrequency: logFrequency || null,
    fullTimeHour,
    fullTimeMinute,
    timezone,
    backupPath: backupPath || undefined,
    hermodReadablePath: hermodReadablePath || undefined,
    urlBase: urlBase || undefined,
    urlCredentialName: urlCredentialName || undefined,
    compressionEnabled,
    checksumEnabled,
    copyOnly,
    verifyAfterBackup,
    retentionDays,
    enabled,
  }), [
    name,
    sourceConnectionId,
    storageTargetId,
    destinationMode,
    databaseSelectionMode,
    selectedDatabases,
    excludedDatabases,
    databasePattern,
    fullFrequency,
    differentialFrequency,
    logFrequency,
    fullTimeHour,
    fullTimeMinute,
    timezone,
    backupPath,
    hermodReadablePath,
    urlBase,
    urlCredentialName,
    compressionEnabled,
    checksumEnabled,
    copyOnly,
    verifyAfterBackup,
    retentionDays,
    enabled,
  ]);

  async function discoverDatabases() {
    if (!sourceConnectionId) return;
    setDiscovering(true);
    try {
      const res = await fetch(`/api/connections/${sourceConnectionId}/mssql/databases`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to discover SQL Server databases");
      const databases = (result.databases ?? []) as MssqlDatabaseInfo[];
      setDiscoveredDatabases(databases);
      if (scope === "SERVER" && databaseSelectionMode === "SINGLE" && selectedDatabases.length === 0 && databases[0]) {
        setSelectedDatabases([databases[0].name]);
      }
      toast.success("SQL Server databases discovered");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to discover SQL Server databases");
    } finally {
      setDiscovering(false);
    }
  }

  function toggleDatabase(name: string) {
    setSelectedDatabases((current) => {
      if (databaseSelectionMode === "SINGLE") return [name];
      return current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    });
  }

  const destinationReady =
    (destinationMode === "BACKUP_TO_URL" && urlBase.trim() && urlCredentialName.trim()) ||
    ((destinationMode === "BACKUP_TO_DISK_SHARED_PATH" || destinationMode === "BACKUP_TO_DISK_SERVER_ONLY") && backupPath.trim());
  const selectionReady =
    scope === "DATABASE" ||
    databaseSelectionMode === "ALL_USER_DATABASES" ||
    (databaseSelectionMode === "PATTERN" && databasePattern.trim()) ||
    (databaseSelectionMode === "MULTIPLE" && selectedDatabases.length > 0) ||
    (databaseSelectionMode === "SINGLE" && selectedDatabases.length === 1);
  const canSave = !!name.trim() && !!sourceConnectionId && !!destinationReady && !!selectionReady;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/backups/mssql/policies/${policyId}` : "/api/backups/mssql/policies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save SQL Server backup policy");
      toast.success(isEdit ? "SQL Server backup policy updated" : "SQL Server backup policy created");
      router.push(isEdit ? `/backups/mssql/${policyId}` : "/backups/mssql");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save SQL Server backup policy");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-text-dim tracking-widest uppercase">Loading SQL Server backup policy...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="heading-norse text-xl">{isEdit ? "Edit SQL Server Backup" : "Forge SQL Server Backup"}</h1>
          <div className="realm-line mt-2 w-52" />
        </div>
        <Link href="/backups/mssql" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
          SQL Server Backups
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-6">
          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Source</h2>
            <div className="space-y-4">
              <div>
                <label className="label-norse">Policy Name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="input-norse"
                  placeholder="Production SQL Server"
                />
              </div>
              <div>
                <label className="label-norse">SQL Server Connection</label>
                <select
                  value={sourceConnectionId}
                  onChange={(event) => setSourceConnectionId(event.target.value)}
                  className="select-norse"
                >
                  <option value="">Select SQL Server connection...</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} ({connection.config?.scope === "SERVER" ? "server" : String(connection.config?.database ?? "database")})
                    </option>
                  ))}
                </select>
                <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
                  Server-scoped connections can protect one, selected, all, or patterned user databases from the same SQL Server instance.
                </p>
              </div>

              <MssqlDatabaseSelector
                sourceScope={scope}
                configuredDatabase={database}
                mode={databaseSelectionMode}
                selectedDatabases={selectedDatabases}
                excludedDatabases={excludedDatabases}
                databasePattern={databasePattern}
                discoveredDatabases={discoveredDatabases}
                discovering={discovering}
                onModeChange={(mode) => {
                  setDatabaseSelectionMode(mode);
                  setSelectedDatabases([]);
                }}
                onDiscover={discoverDatabases}
                onToggleDatabase={toggleDatabase}
                onExcludedChange={setExcludedDatabases}
                onPatternChange={setDatabasePattern}
              />
            </div>
          </div>

          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Schedule</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label-norse">Full Backup</label>
                <select value={fullFrequency} onChange={(event) => setFullFrequency(event.target.value)} className="select-norse">
                  {FULL_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-norse">Differential Backup</label>
                <select value={differentialFrequency} onChange={(event) => setDifferentialFrequency(event.target.value)} className="select-norse">
                  {DIFFERENTIAL_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-norse">Transaction Log Backup</label>
                <select value={logFrequency} onChange={(event) => setLogFrequency(event.target.value)} className="select-norse">
                  {LOG_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                  ))}
                </select>
                <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
                  Log backups require FULL or BULK_LOGGED recovery model. SIMPLE databases will fail preflight and run-time checks.
                </p>
              </div>
              <div>
                <label className="label-norse">Timezone</label>
                <select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="select-norse">
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
              <div>
                <label className="label-norse">Full Backup Hour</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={23}
                  value={fullTimeHour}
                  onChange={(event) => setFullTimeHour(Number(event.target.value))}
                  className="input-norse"
                />
              </div>
              <div>
                <label className="label-norse">Full Backup Minute</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  value={fullTimeMinute}
                  onChange={(event) => setFullTimeMinute(Number(event.target.value))}
                  className="input-norse"
                />
              </div>
            </div>
          </div>

          <MssqlDestinationModePanel
            mode={destinationMode}
            backupPath={backupPath}
            hermodReadablePath={hermodReadablePath}
            urlBase={urlBase}
            urlCredentialName={urlCredentialName}
            storageTargetId={storageTargetId}
            targets={targets}
            onModeChange={setDestinationMode}
            onBackupPathChange={setBackupPath}
            onHermodReadablePathChange={setHermodReadablePath}
            onUrlBaseChange={setUrlBase}
            onUrlCredentialNameChange={setUrlCredentialName}
            onStorageTargetChange={setStorageTargetId}
          />

          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Options</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="space-y-3">
                {[
                  ["compressionEnabled", "Compression", compressionEnabled, setCompressionEnabled],
                  ["checksumEnabled", "Checksum", checksumEnabled, setChecksumEnabled],
                  ["copyOnly", "Copy-only full backups", copyOnly, setCopyOnly],
                  ["verifyAfterBackup", "RESTORE VERIFYONLY after backup", verifyAfterBackup, setVerifyAfterBackup],
                  ["enabled", "Policy enabled", enabled, setEnabled],
                ].map(([key, label, checked, setter]) => (
                  <label key={String(key)} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(checked)}
                      onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)}
                      className="accent-gold"
                    />
                    <span className="text-text-dim text-xs tracking-wider">{String(label)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mb-12">
            <button
              type="button"
              onClick={() => router.push("/backups/mssql")}
              className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase"
            >
              {saving ? "Saving..." : isEdit ? "Update Policy" : "Create Policy"}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <MssqlPreflightPanel policyId={policyId} payload={payload} />
          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-3">Restore Note</h2>
            <p className="text-text-dim text-xs tracking-wide leading-6">
              SQL Server restore is intentionally a separate workflow. Hermod records the full, differential, and log chain so restore
              can preserve order and recovery semantics later.
            </p>
          </div>
          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-3">Storage</h2>
            <p className="text-text-dim text-xs tracking-wide leading-6 mb-4">
              For S3 or GCS uploads, use shared-path mode so Hermod can read the file SQL Server created.
            </p>
            <Link href="/backups/storage" className="btn-subtle px-3 py-2 text-xs tracking-[0.15em] uppercase">
              Manage Storage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
