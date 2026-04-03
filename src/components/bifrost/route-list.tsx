"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import Image from "next/image";
import { REALM_ILLUSTRATIONS } from "@/lib/constants";

interface RouteListItem {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: string | null;
  source: { name: string; type: string };
  dest: { name: string; type: string };
  routeLogs: Array<{
    status: string;
    startedAt: string;
    rowsLoaded: number | null;
    errorCount: number;
  }>;
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-success",
  partial: "bg-warning status-pulse-amber",
  failed: "bg-error status-pulse-red",
  running: "bg-warning animate-pip-pulse",
};

const REALM_TYPE_COLOR: Record<string, string> = {
  POSTGRES: "#d4af37",
  MSSQL: "#d4af37",
  MYSQL: "#d4af37",
  BIGQUERY: "#d4af37",
  NETSUITE: "#ce93d8",
  SFTP: "#66bb6a",
};

export function RouteList() {
  const [routes, setRoutes] = useState<RouteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningRouteId, setRunningRouteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const toast = useToast();
  const router = useRouter();

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch("/api/bifrost/routes");
      if (!res.ok) throw new Error("Failed to fetch routes");
      setRoutes(await res.json());
    } catch (err) {
      toast.error("Failed to load routes");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  async function toggleEnabled(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/bifrost/routes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle route");
      fetchRoutes();
    } catch {
      toast.error("Failed to toggle route");
    }
  }

  async function runNow(id: string, name: string) {
    setRunningRouteId(id);
    toast.success(`Running ${name}...`);
    try {
      const res = await fetch(`/api/bifrost/routes/${id}/run`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Run failed");
      const msg = `${name}: ${result.status} — ${result.totalLoaded}/${result.totalExtracted} rows`;
      if (result.status === "completed") {
        toast.success(msg);
      } else {
        toast.error(msg);
      }
      fetchRoutes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Run failed";
      toast.error(msg);
    } finally {
      setRunningRouteId(null);
    }
  }

  function deleteRoute(id: string, name: string) {
    setDeleteTarget({ id, name });
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/bifrost/routes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete route");
      toast.success(`Route "${name}" deleted`);
      fetchRoutes();
    } catch {
      toast.error("Failed to delete route");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading routes...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header Banner */}
      <div className="relative overflow-hidden animate-fade-up -mx-6 -mt-6 mb-6" style={{ height: "180px" }}>
        <Image
          src={REALM_ILLUSTRATIONS.bifrost}
          alt="Bifrost realm"
          fill
          sizes="100vw"
          style={{ objectFit: "cover", objectPosition: "center" }}
          priority={false}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg,
              rgba(244,236,216,0.95) 0%,
              rgba(244,236,216,0.85) 35%,
              rgba(244,236,216,0.5) 65%,
              rgba(244,236,216,0.2) 100%)`,
          }}
        />
        <div className="relative h-full flex items-center justify-between px-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="text-2xl font-cinzel select-none"
                style={{
                  background: "linear-gradient(135deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                ᛒ
              </span>
              <h1 className="heading-norse text-xl">Bifrost</h1>
            </div>
            <div
              className="realm-line mt-1.5 mb-1 w-32"
              style={{
                background: "linear-gradient(90deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
              }}
            />
            <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
              The rainbow bridge between all realms
            </p>
          </div>
          <Link
            href="/bifrost/new"
            className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase"
          >
            Forge New Route
          </Link>
        </div>
      </div>

      {/* Table */}
      {routes.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <span
            className="text-4xl font-cinzel block mb-3 animate-rune-float"
            style={{
              background: "linear-gradient(135deg, rgba(255,107,107,0.3), rgba(255,167,38,0.3), rgba(255,238,88,0.3), rgba(102,187,106,0.3), rgba(66,165,245,0.3), rgba(126,87,194,0.3))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >ᛒ</span>
          <p className="text-text-dim text-sm tracking-wide">The Bifrost awaits its first crossing.</p>
          <p className="text-text-muted text-xs tracking-wide mt-1">Create a route to begin.</p>
          <Link
            href="/bifrost/new"
            className="btn-ghost mt-4 inline-block"
          >
            Forge New Route
          </Link>
        </div>
      ) : (
        <div className="border border-border bg-deep">
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                <th scope="col" className="px-4 py-3 text-left font-normal">Status</th>
                <th scope="col" className="px-4 py-3 text-left font-normal">Name</th>
                <th scope="col" className="px-4 py-3 text-left font-normal">Source</th>
                <th scope="col" className="px-4 py-3 text-left font-normal">Destination</th>
                <th scope="col" className="px-4 py-3 text-left font-normal">Last Run</th>
                <th scope="col" className="px-4 py-3 text-left font-normal">Next Run</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const lastLog = route.routeLogs[0];
                const statusColor = lastLog
                  ? STATUS_DOT[lastLog.status] ?? "bg-gray-500"
                  : "bg-gray-600";

                return (
                  <tr
                    key={route.id}
                    className="border-b border-border/50 hover:bg-gold/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                        <button
                          onClick={() => toggleEnabled(route.id, route.enabled)}
                          aria-pressed={route.enabled}
                          aria-label={`Route ${route.name} is ${route.enabled ? "enabled" : "disabled"}`}
                          className={`text-[0.6rem] tracking-wider uppercase px-3 py-2 sm:px-2 sm:py-0.5 border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold ${
                            route.enabled
                              ? "border-emerald-500/30 text-emerald-400"
                              : "border-border text-text-dim"
                          }`}
                        >
                          {route.enabled ? "On" : "Off"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/bifrost/${route.id}`}
                        className="text-text hover:text-gold-bright tracking-wider"
                      >
                        {route.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tracking-wider">
                      <span className="text-text-dim">{route.source.name}</span>
                      <span
                        className="ml-1.5 text-[0.55rem] font-space-grotesk uppercase tracking-widest"
                        style={{ color: REALM_TYPE_COLOR[route.source.type] ?? "var(--text-muted)" }}
                      >
                        {route.source.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 tracking-wider">
                      <span className="text-text-dim">{route.dest.name}</span>
                      <span
                        className="ml-1.5 text-[0.55rem] font-space-grotesk uppercase tracking-widest"
                        style={{ color: REALM_TYPE_COLOR[route.dest.type] ?? "var(--text-muted)" }}
                      >
                        {route.dest.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {lastLog ? (
                        <span>
                          {lastLog.status}{" "}
                          <span className="text-[0.6rem]">
                            ({lastLog.rowsLoaded ?? 0} rows)
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-dim/70">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {route.nextRunAt
                        ? new Date(route.nextRunAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => runNow(route.id, route.name)}
                          disabled={runningRouteId === route.id}
                          className="btn-subtle text-[0.6rem] px-3 py-2 sm:px-2 sm:py-1"
                        >
                          {runningRouteId === route.id ? "Running..." : "Run Now"}
                        </button>
                        <Link
                          href={`/bifrost/${route.id}/history`}
                          className="btn-subtle text-[0.6rem] px-3 py-2 sm:px-2 sm:py-1"
                        >
                          Logs
                        </Link>
                        <button
                          onClick={() => deleteRoute(route.id, route.name)}
                          className="btn-subtle text-[0.6rem] px-3 py-2 sm:px-2 sm:py-1 text-ember/70 hover:text-ember"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Route"
        message={deleteTarget ? `Route "${deleteTarget.name}" will be permanently removed. This cannot be undone.` : ""}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
