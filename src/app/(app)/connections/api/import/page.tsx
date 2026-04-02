"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { EndpointSelector, type DiscoveredEndpoint } from "@/components/alfheim/discovery/endpoint-selector";
import { SchemaReview } from "@/components/alfheim/discovery/schema-review";
import { DDLPreview } from "@/components/alfheim/discovery/ddl-preview";
import { SaveToCatalog } from "@/components/alfheim/discovery/save-to-catalog";
import type { SchemaMapping } from "@/lib/alfheim/types";

/* ── Types ── */

interface ParsedEndpoint {
  path: string;
  method: string;
  summary: string;
  responseSchema: SchemaMapping;
  parameters: { name: string; in: string; required: boolean }[];
  suggestedName: string;
  responseRoot: string;
}

interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  auth: { type: string; config: Record<string, unknown> };
  endpoints: ParsedEndpoint[];
}

type Step = "input" | "endpoints" | "review" | "save";
type FetchState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

/* ── Component ── */

export default function OpenApiImportPage() {
  const [step, setStep] = useState<Step>("input");
  const [specUrl, setSpecUrl] = useState("");
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [parsedSpec, setParsedSpec] = useState<ParsedSpec | null>(null);
  const [selectedEndpoints, setSelectedEndpoints] = useState<DiscoveredEndpoint[]>([]);
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  // Schema review state (for the first selected endpoint as representative)
  const [reviewIndex, setReviewIndex] = useState(0);
  const [tableName, setTableName] = useState("");
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [incrementalKey, setIncrementalKey] = useState<string | null>(null);

  const handleFetchSpec = useCallback(async () => {
    setFetchState({ status: "loading" });

    try {
      let body: Record<string, unknown> = {};
      if (specFile) {
        const content = await specFile.text();
        body = { specContent: content };
      } else if (specUrl.trim()) {
        body = { specUrl: specUrl.trim() };
      } else {
        throw new Error("Provide a spec URL or upload a file");
      }

      const res = await fetch("/api/alfheim/discover/openapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed to parse spec (${res.status})`);
      }

      const data: ParsedSpec = await res.json();
      setParsedSpec(data);
      setStep("endpoints");
    } catch (err) {
      setFetchState({ status: "error", message: err instanceof Error ? err.message : "Failed to parse" });
    }
  }, [specUrl, specFile]);

  const handleEndpointSelect = useCallback((eps: DiscoveredEndpoint[]) => {
    setSelectedEndpoints(eps);
    if (eps.length > 0) {
      setTableName(eps[0].suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      setPrimaryKey(eps[0].primaryKey);
      setIncrementalKey(eps[0].incrementalKey);
    }
    setReviewIndex(0);
    setStep("review");
  }, []);

  const handleSchemaChange = useCallback((schema: SchemaMapping) => {
    setSelectedEndpoints((prev) =>
      prev.map((ep, i) => (i === reviewIndex ? { ...ep, schema } : ep)),
    );
  }, [reviewIndex]);

  const currentEndpoint = selectedEndpoints[reviewIndex];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/connections/api" className="btn-ghost text-xs inline-flex items-center gap-1">
        <span>&larr; Back to Connectors</span>
      </Link>

      <div>
        <h1 className="heading-norse text-xl">Import OpenAPI Spec</h1>
        <p className="text-text-dim text-xs tracking-wide mt-1">
          Paste a Swagger / OpenAPI spec URL or upload a file
        </p>
      </div>

      {/* Step: Input */}
      {step === "input" && (
        <div className="space-y-4">
          <div>
            <label className="label-norse block mb-1">Spec URL</label>
            <input
              type="url"
              value={specUrl}
              onChange={(e) => setSpecUrl(e.target.value)}
              className="input-norse w-full"
              placeholder="https://api.example.com/openapi.json"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-text-dim text-[10px] tracking-[0.15em] uppercase">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div>
            <label className="label-norse block mb-1">Upload Spec File</label>
            <input
              type="file"
              accept=".json,.yaml,.yml"
              onChange={(e) => setSpecFile(e.target.files?.[0] ?? null)}
              className="input-norse w-full text-xs file:mr-3 file:px-3 file:py-1 file:border file:border-border file:bg-deep file:text-text-dim file:text-xs file:cursor-pointer"
            />
          </div>

          {fetchState.status === "error" && (
            <p className="text-sm text-red-400">{fetchState.message}</p>
          )}

          <button
            type="button"
            onClick={handleFetchSpec}
            disabled={fetchState.status === "loading" || (!specUrl.trim() && !specFile)}
            className="btn-primary disabled:opacity-40"
          >
            {fetchState.status === "loading" ? (
              <span className="flex items-center gap-2">
                <span className="spinner-norse" style={{ width: 14, height: 14 }} />
                Parsing...
              </span>
            ) : (
              "Fetch & Parse"
            )}
          </button>
        </div>
      )}

      {/* Step: Endpoints */}
      {step === "endpoints" && parsedSpec && (
        <div className="space-y-4">
          <div className="card-norse">
            <div className="flex items-center gap-3">
              <span className="text-text font-cinzel uppercase tracking-[0.06em]">
                {parsedSpec.title}
              </span>
              <span className="badge-neutral">v{parsedSpec.version}</span>
              <span className="badge-neutral">{parsedSpec.auth.type}</span>
            </div>
            <p className="text-text-dim text-xs font-inconsolata mt-1">{parsedSpec.baseUrl}</p>
          </div>

          <EndpointSelector
            endpoints={parsedSpec.endpoints.map((ep) => ({
              endpoint: ep.path,
              suggestedName: ep.suggestedName,
              responseRoot: ep.responseRoot,
              schema: ep.responseSchema,
              incrementalKey: null,
              primaryKey: null,
              confidence: "high" as const,
              notes: [ep.summary],
            }))}
            onSelect={handleEndpointSelect}
          />

          <button type="button" onClick={() => setStep("input")} className="btn-ghost">
            &larr; Back
          </button>
        </div>
      )}

      {/* Step: Review */}
      {step === "review" && currentEndpoint && (
        <div className="space-y-5">
          {/* Endpoint tabs if multiple */}
          {selectedEndpoints.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {selectedEndpoints.map((ep, i) => (
                <button
                  key={ep.endpoint}
                  type="button"
                  onClick={() => {
                    setReviewIndex(i);
                    setTableName(ep.suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
                    setPrimaryKey(ep.primaryKey);
                    setIncrementalKey(ep.incrementalKey);
                  }}
                  className={`px-3 py-1.5 text-xs border whitespace-nowrap transition-colors ${
                    i === reviewIndex
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border text-text-dim hover:border-gold-dim"
                  }`}
                >
                  {ep.suggestedName}
                </button>
              ))}
            </div>
          )}

          <SchemaReview
            schema={currentEndpoint.schema}
            suggestedTableName={tableName}
            suggestedPrimaryKey={primaryKey}
            suggestedIncrementalKey={incrementalKey}
            confidence={currentEndpoint.confidence}
            notes={currentEndpoint.notes}
            onSchemaChange={handleSchemaChange}
            onTableNameChange={setTableName}
            onPrimaryKeyChange={setPrimaryKey}
            onIncrementalKeyChange={setIncrementalKey}
          />

          <DDLPreview tableName={tableName} schema={currentEndpoint.schema} />

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setStep("endpoints")} className="btn-ghost">
              &larr; Back
            </button>
            <button type="button" onClick={() => setStep("save")} className="btn-primary">
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step: Save */}
      {step === "save" && parsedSpec && (
        <div className="space-y-5">
          {/* Collect credentials before saving */}
          <div className="card-norse space-y-3">
            <h3 className="label-norse">Credentials</h3>
            <p className="text-text-dim text-xs">
              Auth type detected: <span className="text-text">{parsedSpec.auth.type}</span>
            </p>
            <div>
              <label className="label-norse block mb-1">API Key / Token</label>
              <input
                type="password"
                value={credentials.apiKey ?? ""}
                onChange={(e) => setCredentials((p) => ({ ...p, apiKey: e.target.value }))}
                className="input-norse w-full"
                placeholder="Enter your API key or token"
              />
            </div>
          </div>

          <SaveToCatalog
            baseUrl={parsedSpec.baseUrl}
            authType={parsedSpec.auth.type}
            authConfig={parsedSpec.auth.config}
            credentials={credentials}
            endpoints={selectedEndpoints}
          />

          <button type="button" onClick={() => setStep("review")} className="btn-ghost">
            &larr; Back
          </button>
        </div>
      )}
    </div>
  );
}
