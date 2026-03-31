"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  completed: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  running: "bg-gold animate-pulse",
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
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="heading-norse text-lg">
            ᛒ Bifrost Routes
          </h1>
          <p className="text-text-dim text-xs tracking-wider mt-1">
            Data pathways through the realms
          </p>
        </div>
        <Link
          href="/bifrost/new"
          className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase"
        >
          Forge New Route
        </Link>
      </div>

      {/* Table */}
      {routes.length === 0 ? (
        <div className="border border-border bg-deep p-12 text-center">
          <p className="text-text-dim text-sm tracking-wider">No routes forged yet.</p>
          <Link
            href="/bifrost/new"
            className="text-gold text-xs tracking-wider hover:text-gold-bright mt-2 inline-block"
          >
            Create your first route
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
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {route.source.name}
                    </td>
                    <td className="px-4 py-3 text-text-dim tracking-wider">
                      {route.dest.name}
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
