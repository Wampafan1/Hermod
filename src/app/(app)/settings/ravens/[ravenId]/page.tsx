"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

interface RavenConnection {
  id: string;
  name: string;
  driver: string;
  database?: string;
  status?: string;
  lastTestedAt?: string;
}

interface RavenJob {
  id: string;
  connectionId: string;
  query: string;
  status: string;
  priority: number;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: {
    rowCount?: number;
    durationMs?: number;
    error?: string;
  } | null;
  createdAt: string;
}

interface RavenDetail {
  id: string;
  name: string;
  status: string;
  version: string | null;
  hostname: string | null;
  platform: string | null;
  lastHeartbeatAt: string | null;
  metadata: Record<string, unknown> | null;
  connections: RavenConnection[] | null;
  jobs: RavenJob[];
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  success: "#66bb6a",
  running: "#42a5f5",
  claimed: "#42a5f5",
  pending: "#ffb74d",
  error: "#ef5350",
  partial: "#ffb74d",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncateQuery(sql: string, max = 80): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "..." : oneLine;
}

export default function RavenDetailPage() {
  const params = useParams<{ ravenId: string }>();
  const router = useRouter();
  const toast = useToast();

  const [raven, setRaven] = useState<RavenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRaven = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/ravens/${params.ravenId}`);
      if (!res.ok) throw new Error("Raven not found");
      const data = await res.json();
      setRaven(data);
      setNameInput(data.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Raven");
    } finally {
      setLoading(false);
    }
  }, [params.ravenId, toast]);

  useEffect(() => {
    fetchRaven();
  }, [fetchRaven]);

  const handleRename = async () => {
    if (!nameInput.trim() || nameInput === raven?.name) {
      setEditingName(false);
      return;
    }
    try {
      const res = await fetch(`/api/settings/ravens/${params.ravenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      setRaven((prev) => (prev ? { ...prev, name: nameInput.trim() } : prev));
      setEditingName(false);
      toast.success("Raven renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke this Raven? It will disconnect on its next heartbeat and can no longer execute jobs.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/settings/ravens/${params.ravenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "revoked" }),
      });
      if (!res.ok) throw new Error("Failed to revoke");
      toast.success("Raven revoked");
      fetchRaven();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Permanently delete this Raven and all its job history? This cannot be undone.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/settings/ravens/${params.ravenId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Raven deleted");
      router.push("/settings/ravens");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-text-dim text-xs tracking-wide text-center py-16">
        Loading Raven details...
      </div>
    );
  }

  if (!raven) {
    return (
      <div className="text-text-dim text-xs tracking-wide text-center py-16">
        Raven not found
      </div>
    );
  }

  const connections: RavenConnection[] = Array.isArray(raven.connections)
    ? (raven.connections as RavenConnection[])
    : [];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={() => router.push("/settings/ravens")}
        className="text-text-dim text-xs tracking-wide hover:text-gold transition-colors"
      >
        &larr; Back to Ravens
      </button>

      {/* Header */}
      <div
        className="border border-gold-dim/20 p-6"
        style={{ background: "rgba(4,6,15,0.9)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") {
                      setEditingName(false);
                      setNameInput(raven.name);
                    }
                  }}
                  className="bg-transparent border border-gold-dim/30 px-2 py-1 text-text text-sm tracking-wide focus:outline-none focus:border-gold"
                  autoFocus
                />
                <button onClick={handleRename} className="text-gold text-xs">
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingName(false);
                    setNameInput(raven.name);
                  }}
                  className="text-text-dim text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h1
                className="font-cinzel text-gold-bright uppercase tracking-[0.25em] text-lg cursor-pointer hover:text-gold transition-colors"
                onClick={() => setEditingName(true)}
                title="Click to rename"
              >
                {raven.name}
              </h1>
            )}

            <div className="flex items-center gap-4 mt-2 text-text-dim text-xs tracking-wide">
              {raven.hostname && (
                <span className="font-mono">{raven.hostname}</span>
              )}
              {raven.platform && <span>{raven.platform}</span>}
              {raven.version && <span>v{raven.version}</span>}
              <span>Heartbeat {relativeTime(raven.lastHeartbeatAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {raven.status !== "revoked" && (
              <button
                onClick={handleRevoke}
                disabled={actionLoading}
                className="btn-ghost text-xs text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
              >
                Revoke
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="btn-ghost text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Metadata from heartbeat */}
        {raven.metadata && (
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gold-dim/10 text-text-dim text-xs tracking-wide">
            {typeof raven.metadata === "object" && "uptime" in raven.metadata && (
              <span>
                Uptime:{" "}
                {Math.floor(
                  (raven.metadata.uptime as number) / 3600
                )}
                h
              </span>
            )}
            {typeof raven.metadata === "object" &&
              "memoryUsage" in raven.metadata && (
                <span>
                  Memory:{" "}
                  {Math.round(
                    (raven.metadata.memoryUsage as number) / 1_048_576
                  )}
                  MB
                </span>
              )}
            {typeof raven.metadata === "object" &&
              "cpuUsage" in raven.metadata && (
                <span>CPU: {(raven.metadata.cpuUsage as number).toFixed(1)}%</span>
              )}
          </div>
        )}
      </div>

      {/* Connections */}
      <div>
        <h2 className="text-text-dim text-[10px] uppercase tracking-[0.5em] mb-3">
          Connections
        </h2>
        {connections.length === 0 ? (
          <div
            className="border border-gold-dim/10 p-6 text-center text-text-dim text-xs tracking-wide"
            style={{ background: "rgba(4,6,15,0.9)" }}
          >
            No connections reported by this Raven
          </div>
        ) : (
          <div
            className="border border-gold-dim/10 overflow-hidden"
            style={{ background: "rgba(4,6,15,0.9)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gold-dim/10">
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Name
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Driver
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Database
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {connections.map((conn) => (
                  <tr
                    key={conn.id}
                    className="border-b border-gold-dim/5 last:border-0"
                  >
                    <td className="px-4 py-2 text-text tracking-wide">
                      {conn.name}
                    </td>
                    <td className="px-4 py-2 text-text-dim font-mono">
                      {conn.driver}
                    </td>
                    <td className="px-4 py-2 text-text-dim font-mono">
                      {conn.database ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                        style={{
                          backgroundColor:
                            conn.status === "connected"
                              ? "#66bb6a"
                              : "#ef5350",
                        }}
                      />
                      <span className="text-text-dim">
                        {conn.status ?? "unknown"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Jobs */}
      <div>
        <h2 className="text-text-dim text-[10px] uppercase tracking-[0.5em] mb-3">
          Recent Jobs
        </h2>
        {raven.jobs.length === 0 ? (
          <div
            className="border border-gold-dim/10 p-6 text-center text-text-dim text-xs tracking-wide"
            style={{ background: "rgba(4,6,15,0.9)" }}
          >
            No jobs dispatched to this Raven yet
          </div>
        ) : (
          <div
            className="border border-gold-dim/10 overflow-hidden"
            style={{ background: "rgba(4,6,15,0.9)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gold-dim/10">
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Created
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Query
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Rows
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Duration
                  </th>
                  <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {raven.jobs.map((job) => {
                  const isExpanded = expandedJob === job.id;
                  return (
                    <tr
                      key={job.id}
                      className="border-b border-gold-dim/5 last:border-0 cursor-pointer hover:bg-gold-dim/5 transition-colors"
                      onClick={() =>
                        setExpandedJob(isExpanded ? null : job.id)
                      }
                    >
                      <td className="px-4 py-2 text-text-dim whitespace-nowrap">
                        {relativeTime(job.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-text-dim font-mono max-w-xs">
                        {isExpanded ? (
                          <div className="whitespace-pre-wrap break-all py-1">
                            {job.query}
                            {job.result?.error && (
                              <div className="mt-2 text-red-400 border-t border-red-400/20 pt-2">
                                {job.result.error}
                              </div>
                            )}
                          </div>
                        ) : (
                          truncateQuery(job.query)
                        )}
                      </td>
                      <td className="px-4 py-2 text-text-dim whitespace-nowrap">
                        {job.result?.rowCount?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-text-dim whitespace-nowrap">
                        {job.result?.durationMs != null
                          ? `${(job.result.durationMs / 1000).toFixed(1)}s`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                          style={{
                            backgroundColor:
                              STATUS_COLORS[job.status] ?? "rgba(232,224,208,0.3)",
                          }}
                        />
                        <span className="text-text-dim">{job.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
