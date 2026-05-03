"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { formatBytes } from "./coverage-card";

interface BackupPolicy {
  id: string;
  name: string;
  sourceConnectionId: string;
  sourceConnection: { id: string; name: string; config: Record<string, unknown> };
  storageTarget: { id: string; name: string; provider: string; config: Record<string, unknown> };
}

interface ConnectionOption {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

interface RestorePoint {
  id: string;
  type: string;
  status: string;
  objectKeys: unknown;
  bytesWritten: string | null;
  checksumSha256: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface RestorePointsResponse {
  policy: {
    id: string;
    name: string;
    sourceConnection: { id: string; name: string; database: string };
    storageTarget: { id: string; name: string; provider: string; config: Record<string, unknown> };
  };
  items: RestorePoint[];
}

interface BackupArtifact {
  key: string;
  database?: string;
  bytes?: number;
  checksumSha256?: string;
}

function connectionScope(connection: ConnectionOption | null): "DATABASE" | "SERVER" {
  return connection?.config?.scope === "SERVER" ? "SERVER" : "DATABASE";
}

function databaseName(connection: ConnectionOption | null): string {
  return String(connection?.config?.database ?? "postgres");
}

function objectArtifacts(value: unknown): BackupArtifact[] {
  if (!Array.isArray(value)) return typeof value === "string" ? [{ key: value }] : [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ key: item }];
    if (item && typeof item === "object" && "key" in item) {
      const record = item as { key?: unknown; database?: unknown; bytes?: unknown; checksumSha256?: unknown };
      if (typeof record.key !== "string") return [];
      return [{
        key: record.key,
        database: typeof record.database === "string" ? record.database : undefined,
        bytes: typeof record.bytes === "number" ? record.bytes : undefined,
        checksumSha256: typeof record.checksumSha256 === "string" ? record.checksumSha256 : undefined,
      }];
    }
    return [];
  });
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function RestoreForm({ initialPolicyId }: { initialPolicyId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [policies, setPolicies] = useState<BackupPolicy[]>([]);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [policyId, setPolicyId] = useState(initialPolicyId ?? "");
  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedObjectKey, setSelectedObjectKey] = useState("");
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState("");
  const [targetDatabases, setTargetDatabases] = useState<Array<{ name: string }>>([]);
  const [loadingTargetDatabases, setLoadingTargetDatabases] = useState(false);
  const [clean, setClean] = useState(true);
  const [ifExists, setIfExists] = useState(true);
  const [noOwner, setNoOwner] = useState(true);
  const [noPrivileges, setNoPrivileges] = useState(true);
  const [allowSameSourceRestore, setAllowSameSourceRestore] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === policyId) ?? null,
    [policies, policyId]
  );
  const targetConnection = useMemo(
    () => connections.find((connection) => connection.id === targetConnectionId) ?? null,
    [connections, targetConnectionId]
  );
  const selectedPoint = useMemo(
    () => restorePoints.find((point) => point.id === selectedRunId) ?? null,
    [restorePoints, selectedRunId]
  );
  const artifacts = useMemo(
    () => objectArtifacts(selectedPoint?.objectKeys),
    [selectedPoint]
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.key === selectedObjectKey) ?? artifacts[0] ?? null,
    [artifacts, selectedObjectKey]
  );
  const sameSourceTarget = !!selectedPolicy && selectedPolicy.sourceConnectionId === targetConnectionId;
  const targetScope = connectionScope(targetConnection);
  const resolvedTargetDatabase = targetScope === "SERVER" ? targetDatabase : databaseName(targetConnection);
  const expectedConfirmation = sameSourceTarget
    ? `RESTORE SOURCE DATABASE ${resolvedTargetDatabase}`
    : `RESTORE ${resolvedTargetDatabase}`;
  const confirmationMatches = confirmation === expectedConfirmation;
  const canSubmit = !!policyId &&
    !!selectedRunId &&
    !!selectedArtifact?.key &&
    !!targetConnectionId &&
    !!resolvedTargetDatabase &&
    confirmationMatches &&
    (!sameSourceTarget || allowSameSourceRestore);

  useEffect(() => {
    Promise.all([
      fetch("/api/backups/policies").then((res) => res.json()),
      fetch("/api/connections").then((res) => res.json()),
    ])
      .then(([policyData, connectionData]) => {
        const backupPolicies = policyData as BackupPolicy[];
        setPolicies(backupPolicies);
        setConnections((connectionData as ConnectionOption[]).filter((conn) => conn.type === "POSTGRES"));
        if (!policyId && backupPolicies[0]) setPolicyId(backupPolicies[0].id);
      })
      .catch(() => toast.error("Failed to load restore form data"))
      .finally(() => setLoading(false));
  }, [policyId, toast]);

  const loadRestorePoints = useCallback(async () => {
    if (!policyId) {
      setRestorePoints([]);
      setSelectedRunId("");
      return;
    }
    setLoadingPoints(true);
    try {
      const res = await fetch(`/api/backups/restore-points?policyId=${encodeURIComponent(policyId)}`);
      const data = await res.json() as RestorePointsResponse | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "Failed to load restore points");
      const items = (data as RestorePointsResponse).items ?? [];
      setRestorePoints(items);
      setSelectedRunId(items[0]?.id ?? "");
      setSelectedObjectKey(objectArtifacts(items[0]?.objectKeys).at(0)?.key ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load restore points");
      setRestorePoints([]);
      setSelectedRunId("");
      setSelectedObjectKey("");
    } finally {
      setLoadingPoints(false);
    }
  }, [policyId, toast]);

  useEffect(() => {
    loadRestorePoints();
  }, [loadRestorePoints]);

  useEffect(() => {
    setTargetDatabases([]);
    setTargetDatabase("");
    setConfirmation("");
    if (!targetConnection || connectionScope(targetConnection) !== "SERVER") return;

    let cancelled = false;
    setLoadingTargetDatabases(true);
    fetch(`/api/connections/${targetConnection.id}/postgres/databases`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load target databases");
        if (!cancelled) {
          const databases = data.databases ?? [];
          setTargetDatabases(databases);
          setTargetDatabase(databases[0]?.name ?? "");
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Failed to load target databases");
      })
      .finally(() => {
        if (!cancelled) setLoadingTargetDatabases(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetConnection, toast]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/backups/restores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId,
          backupRunId: selectedRunId,
          targetConnectionId,
          mode: "LOGICAL_PG_RESTORE",
          objectKey: selectedArtifact?.key,
          options: {
            clean,
            ifExists,
            noOwner,
            noPrivileges,
            confirmation,
            allowSameSourceRestore,
            targetDatabase: targetScope === "SERVER" ? resolvedTargetDatabase : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue restore");
      toast.success("Restore queued");
      router.push(`/backups/restores/${data.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue restore");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading restore form...</span>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/backups" className="text-text-dim text-xs tracking-wider hover:text-gold">
              &larr; Backups
            </Link>
            <h1 className="heading-norse text-lg mt-3">Restore PostgreSQL Backup</h1>
            <div className="realm-line mt-2 w-44" />
          </div>
          <Link href="/backups/restores" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
            History
          </Link>
        </div>

        <div className="border border-ember/30 bg-ember/10 p-4 mb-6 text-ember text-xs tracking-wide leading-6">
          This can overwrite data in the target database. WAL/PITR restore is physical recovery and is not applied with pg_restore.
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Restore Source</h2>
          <div className="space-y-4">
            <div>
              <label className="label-norse">Backup Policy</label>
              <select
                value={policyId}
                onChange={(event) => setPolicyId(event.target.value)}
                className="select-norse"
              >
                <option value="">Select policy...</option>
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>{policy.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-norse">Restore Point</label>
              <select
                value={selectedRunId}
                onChange={(event) => {
                  const runId = event.target.value;
                  setSelectedRunId(runId);
                  const point = restorePoints.find((item) => item.id === runId);
                  setSelectedObjectKey(objectArtifacts(point?.objectKeys).at(0)?.key ?? "");
                }}
                className="select-norse"
                disabled={!policyId || loadingPoints}
              >
                <option value="">{loadingPoints ? "Loading restore points..." : "Select successful full backup..."}</option>
                {restorePoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    {formatDate(point.startedAt)} ({formatBytes(point.bytesWritten)})
                  </option>
                ))}
              </select>
            </div>

            {selectedPoint && (
              <div className="border border-border bg-void/40 p-4">
                {artifacts.length > 1 && (
                  <div className="mb-4">
                    <label className="label-norse">Backup Artifact</label>
                    <select
                      value={selectedObjectKey}
                      onChange={(event) => setSelectedObjectKey(event.target.value)}
                      className="select-norse"
                    >
                      {artifacts.map((artifact) => (
                        <option key={artifact.key} value={artifact.key}>
                          {artifact.database ?? artifact.key} {artifact.bytes ? `(${formatBytes(artifact.bytes)})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs tracking-wide">
                  <Meta label="Timestamp" value={formatDate(selectedPoint.startedAt)} />
                  <Meta label="Database" value={selectedArtifact?.database ?? "-"} />
                  <Meta label="Bytes" value={selectedArtifact?.bytes ? formatBytes(selectedArtifact.bytes) : formatBytes(selectedPoint.bytesWritten)} />
                  <Meta label="Checksum" value={(selectedArtifact?.checksumSha256 ?? selectedPoint.checksumSha256) ? `${(selectedArtifact?.checksumSha256 ?? selectedPoint.checksumSha256)!.slice(0, 18)}...` : "-"} />
                  <Meta label="Storage" value={selectedPolicy?.storageTarget.provider ?? "-"} />
                </div>
                <p className="font-mono text-text-dim text-[0.68rem] tracking-wide break-all mt-4">
                  {selectedArtifact?.key ?? "-"}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Target Database</h2>
          <div className="space-y-4">
            <div>
              <label className="label-norse">PostgreSQL Connection</label>
              <select
                value={targetConnectionId}
                onChange={(event) => {
                  setTargetConnectionId(event.target.value);
                  setTargetDatabase("");
                  setConfirmation("");
                  setAllowSameSourceRestore(false);
                }}
                className="select-norse"
              >
                <option value="">Select target...</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.config?.scope === "SERVER"
                      ? `${connection.name} (server)`
                      : `${connection.name} (${String(connection.config?.database ?? "postgres")})`}
                  </option>
                ))}
              </select>
            </div>

            {targetConnection && targetScope === "SERVER" && (
              <div>
                <label className="label-norse">Target Database</label>
                <select
                  value={targetDatabase}
                  onChange={(event) => {
                    setTargetDatabase(event.target.value);
                    setConfirmation("");
                  }}
                  className="select-norse"
                  disabled={loadingTargetDatabases}
                >
                  <option value="">{loadingTargetDatabases ? "Discovering databases..." : "Select database..."}</option>
                  {targetDatabases.map((database) => (
                    <option key={database.name} value={database.name}>{database.name}</option>
                  ))}
                </select>
              </div>
            )}

            {sameSourceTarget && (
              <label className="flex items-start gap-3 border border-ember/30 bg-ember/10 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSameSourceRestore}
                  onChange={(event) => setAllowSameSourceRestore(event.target.checked)}
                  className="accent-gold mt-1"
                />
                <span className="text-ember text-xs tracking-wide leading-6">
                  Restore into the source database connection.
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Restore Options</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Check label="Clean existing objects" checked={clean} onChange={setClean} />
            <Check label="If exists" checked={ifExists} onChange={setIfExists} />
            <Check label="No owner" checked={noOwner} onChange={setNoOwner} />
            <Check label="No privileges" checked={noPrivileges} onChange={setNoPrivileges} />
          </div>
        </div>

        <div className="border border-border bg-deep p-5 mb-6">
          <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Confirmation</h2>
          <label className="label-norse">Type Exactly</label>
          <p className="font-mono text-gold text-xs tracking-wide my-2">{expectedConfirmation}</p>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="input-norse font-mono"
            placeholder={expectedConfirmation}
          />
        </div>

        <div className="flex justify-end gap-3 mb-12">
          <button onClick={() => router.push("/backups")} className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase"
          >
            {submitting ? "Queueing..." : "Queue Restore"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="border border-border bg-deep p-5">
          <h2 className="heading-norse text-xs mb-3 pb-2 border-b border-border">Guardrails</h2>
          <ul className="space-y-2 text-text-dim text-xs tracking-wide leading-6">
            <li>Logical restores use successful FULL_LOGICAL artifacts only.</li>
            <li>Checksum verification runs before pg_restore.</li>
            <li>The target database must already exist.</li>
            <li>Passwords stay in environment variables, never command args.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label-norse">{label}</span>
      <p className="text-text-dim mt-1">{value}</p>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 border border-border bg-void/30 p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-gold"
      />
      <span className="text-text-dim text-xs tracking-wider">{label}</span>
    </label>
  );
}
