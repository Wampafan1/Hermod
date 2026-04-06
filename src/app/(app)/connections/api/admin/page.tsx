"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CatalogForm } from "@/components/alfheim/catalog-form";

interface Connector {
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string | null;
  authType: string;
  baseUrl: string;
  docsUrl?: string | null;
  popularity: number;
  enabled: boolean;
  authConfig?: unknown;
  pagination?: unknown;
  rateLimiting?: unknown;
  _count?: { objects: number };
}

type FormMode = { type: "closed" } | { type: "create" } | { type: "edit"; connector: Connector };

export default function CatalogAdminPage() {
  const toast = useToast();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>({ type: "closed" });
  const [deleteTarget, setDeleteTarget] = useState<Connector | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch("/api/alfheim/catalog?all=true&limit=100");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setConnectors(data.connectors ?? []);
    } catch {
      toast.error("Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  async function handleToggle(connector: Connector) {
    setToggling(connector.slug);
    try {
      const res = await fetch(`/api/alfheim/catalog/${connector.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !connector.enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      toast.success(`${connector.name} ${connector.enabled ? "disabled" : "enabled"}`);
      await fetchConnectors();
    } catch {
      toast.error("Failed to toggle connector");
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/alfheim/catalog/${deleteTarget.slug}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await fetchConnectors();
    } catch {
      toast.error("Failed to delete connector");
    } finally {
      setDeleting(false);
    }
  }

  function handleFormSave() {
    setFormMode({ type: "closed" });
    fetchConnectors();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Catalog Administration</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Manage API catalog connectors
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/connections/api" className="btn-ghost text-xs">
            &larr; Back to Catalog
          </Link>
          {formMode.type === "closed" && (
            <button
              onClick={() => setFormMode({ type: "create" })}
              className="btn-primary text-xs"
            >
              + Add Connector
            </button>
          )}
        </div>
      </div>

      {/* Inline Form */}
      {formMode.type !== "closed" && (
        <CatalogForm
          connector={formMode.type === "edit" ? formMode.connector : undefined}
          onSave={handleFormSave}
          onCancel={() => setFormMode({ type: "closed" })}
        />
      )}

      {/* Table */}
      <div className="card-norse overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="label-norse text-left px-4 py-3">Name</th>
              <th className="label-norse text-left px-4 py-3">Category</th>
              <th className="label-norse text-left px-4 py-3">Auth Type</th>
              <th className="label-norse text-center px-4 py-3">Objects</th>
              <th className="label-norse text-center px-4 py-3">Status</th>
              <th className="label-norse text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-text-dim py-8">
                  Loading...
                </td>
              </tr>
            ) : connectors.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-text-dim py-8">
                  No connectors found. Add one to get started.
                </td>
              </tr>
            ) : (
              connectors.map((c) => (
                <tr
                  key={c.slug}
                  className="border-b border-border hover:bg-surface-hover transition-colors"
                >
                  <td className="px-4 py-3 font-cinzel text-text tracking-wide">
                    {c.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge-neutral">{c.category}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="label-norse">{c.authType}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-text-dim">
                    {c._count?.objects ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.enabled ? (
                      <span className="badge-success">Enabled</span>
                    ) : (
                      <span className="badge-error">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setFormMode({ type: "edit", connector: c })}
                        className="btn-ghost text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(c)}
                        disabled={toggling === c.slug}
                        className="btn-ghost text-xs"
                      >
                        {toggling === c.slug
                          ? "..."
                          : c.enabled
                            ? "Disable"
                            : "Enable"}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        className="btn-ghost text-xs text-error"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Connector"
        message={`Permanently delete "${deleteTarget?.name ?? ""}" and all its objects? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
