"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DiscoveredEndpoint } from "./endpoint-selector";

interface SaveToCatalogProps {
  baseUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  credentials: Record<string, string>;
  endpoints: DiscoveredEndpoint[];
  pagination?: { type: string; config: Record<string, unknown> };
}

type SaveMode = "catalog" | "route";
type SaveState =
  | { status: "idle" }
  | { status: "saving"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function SaveToCatalog({
  baseUrl,
  authType,
  authConfig,
  credentials,
  endpoints,
  pagination,
}: SaveToCatalogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<SaveMode>("route");
  const [connectorName, setConnectorName] = useState("");
  const [category, setCategory] = useState("Custom");
  const [description, setDescription] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  const handleSaveToCatalog = useCallback(async () => {
    if (!connectorName.trim()) return;
    setSaveState({ status: "saving", message: "Saving to catalog..." });

    try {
      const slug = connectorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const res = await fetch("/api/alfheim/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: connectorName,
          description: description || `Custom connector for ${connectorName}`,
          category,
          baseUrl,
          authType,
          authConfig,
          pagination: pagination ?? { type: "none" },
          objects: endpoints.map((ep) => ({
            slug: ep.suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: ep.suggestedName,
            endpoint: ep.endpoint,
            responseRoot: ep.responseRoot,
            incrementalKey: ep.incrementalKey,
            schema: ep.schema,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed to save (${res.status})`);
      }

      setSaveState({ status: "success", message: "Saved to catalog" });
      setTimeout(() => router.push(`/connections/api/${slug}`), 800);
    } catch (err) {
      setSaveState({ status: "error", message: err instanceof Error ? err.message : "Failed to save" });
    }
  }, [connectorName, description, category, baseUrl, authType, authConfig, pagination, endpoints, router]);

  const handleCreateRoute = useCallback(async () => {
    setSaveState({ status: "saving", message: "Creating connection..." });

    try {
      // Create REST_API connection
      const connRes = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connectorName || `Discovered API (${new URL(baseUrl).hostname})`,
          type: "REST_API",
          config: {
            baseUrl,
            authType,
            authConfig,
            pagination: pagination ?? { type: "none" },
            selectedObjects: endpoints.map((e) => e.suggestedName),
          },
          credentials,
        }),
      });

      if (!connRes.ok) {
        const err = await connRes.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed to create connection (${connRes.status})`);
      }

      setSaveState({ status: "success", message: "Connection created" });
      setTimeout(() => router.push("/bifrost"), 800);
    } catch (err) {
      setSaveState({ status: "error", message: err instanceof Error ? err.message : "Failed" });
    }
  }, [connectorName, baseUrl, authType, authConfig, credentials, pagination, endpoints, router]);

  const isSaving = saveState.status === "saving";

  return (
    <div className="space-y-5">
      <h3 className="heading-norse">Save &amp; Finish</h3>

      {/* Mode toggle */}
      <div className="flex gap-2" role="group" aria-label="Save mode">
        <button
          type="button"
          onClick={() => setMode("route")}
          aria-pressed={mode === "route"}
          className={`px-4 py-2 text-xs border transition-colors ${
            mode === "route" ? "border-gold bg-gold/10 text-gold" : "border-border text-text-dim hover:border-gold-dim"
          }`}
        >
          Create Route Directly
        </button>
        <button
          type="button"
          onClick={() => setMode("catalog")}
          aria-pressed={mode === "catalog"}
          className={`px-4 py-2 text-xs border transition-colors ${
            mode === "catalog" ? "border-gold bg-gold/10 text-gold" : "border-border text-text-dim hover:border-gold-dim"
          }`}
        >
          Save to Catalog
        </button>
      </div>

      {/* Common: Name */}
      <div>
        <label className="label-norse block mb-1">
          {mode === "catalog" ? "Connector Name" : "Connection Name"}
        </label>
        <input
          type="text"
          value={connectorName}
          onChange={(e) => setConnectorName(e.target.value)}
          className="input-norse w-full max-w-sm"
          placeholder={mode === "catalog" ? "e.g., My Custom API" : "e.g., Production API"}
        />
      </div>

      {/* Catalog-specific fields */}
      {mode === "catalog" && (
        <>
          <div>
            <label className="label-norse block mb-1">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input-norse w-full max-w-sm"
              placeholder="e.g., Payments, CRM, Custom"
            />
          </div>
          <div>
            <label className="label-norse block mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-norse w-full"
              placeholder="Brief description of this API"
            />
          </div>
        </>
      )}

      {/* Summary */}
      <div className="card-norse">
        <p className="text-text-dim text-xs">
          <span className="text-text">{endpoints.length}</span> endpoint{endpoints.length !== 1 ? "s" : ""} selected
          &nbsp;&middot;&nbsp;
          Base URL: <span className="text-text font-inconsolata">{baseUrl}</span>
        </p>
      </div>

      {/* Status */}
      {saveState.status === "saving" && (
        <div className="flex items-center gap-2 text-text-dim text-xs">
          <span className="spinner-norse" style={{ width: 14, height: 14 }} />
          {saveState.message}
        </div>
      )}
      {saveState.status === "success" && (
        <p className="text-sm text-emerald-400">&#10003; {saveState.message}</p>
      )}
      {saveState.status === "error" && (
        <p className="text-sm text-red-400">{saveState.message}</p>
      )}

      {/* Action */}
      <button
        type="button"
        onClick={mode === "catalog" ? handleSaveToCatalog : handleCreateRoute}
        disabled={isSaving || saveState.status === "success" || (mode === "catalog" && !connectorName.trim())}
        className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {mode === "catalog" ? "Save to Catalog" : "Create Connection"}
      </button>
    </div>
  );
}
