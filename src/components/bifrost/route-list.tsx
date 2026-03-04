"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

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
    }
  }

  async function deleteRoute(id: string, name: string) {
    if (!confirm(`Delete route "${name}"? This cannot be undone.`)) return;
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
            Cloud-to-cloud data pathways
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
        <div className="border border-border bg-deep overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-dim tracking-[0.15em] uppercase">
                <th className="px-4 py-3 text-left font-normal">Status</th>
                <th className="px-4 py-3 text-left font-normal">Name</th>
                <th className="px-4 py-3 text-left font-normal">Source</th>
                <th className="px-4 py-3 text-left font-normal">Destination</th>
                <th className="px-4 py-3 text-left font-normal">Last Run</th>
                <th className="px-4 py-3 text-left font-normal">Next Run</th>
                <th className="px-4 py-3 text-right font-normal">Actions</th>
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
                          className={`text-[0.6rem] tracking-wider uppercase px-2 py-0.5 border ${
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
                          className="btn-subtle text-[0.6rem] px-2 py-1"
                        >
                          Run Now
                        </button>
                        <Link
                          href={`/bifrost/${route.id}/history`}
                          className="btn-subtle text-[0.6rem] px-2 py-1"
                        >
                          Logs
                        </Link>
                        <button
                          onClick={() => deleteRoute(route.id, route.name)}
                          className="btn-subtle text-[0.6rem] px-2 py-1 text-ember/70 hover:text-ember"
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
      )}
    </div>
  );
}
