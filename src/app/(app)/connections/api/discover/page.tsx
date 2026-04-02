"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { DiscoveryProgress, type DiscoveryStep } from "@/components/alfheim/discovery/discovery-progress";
import { EndpointSelector, type DiscoveredEndpoint } from "@/components/alfheim/discovery/endpoint-selector";
import { SchemaReview } from "@/components/alfheim/discovery/schema-review";
import { DDLPreview } from "@/components/alfheim/discovery/ddl-preview";
import { SaveToCatalog } from "@/components/alfheim/discovery/save-to-catalog";
import type { SchemaMapping } from "@/lib/alfheim/types";

type Step = "input" | "discovering" | "endpoints" | "review" | "save";

const AUTH_TYPES = [
  { value: "NONE", label: "None (public)" },
  { value: "API_KEY", label: "API Key (header)" },
  { value: "BEARER", label: "Bearer Token" },
  { value: "BASIC", label: "Basic Auth" },
];

export default function AiDiscoverPage() {
  const [step, setStep] = useState<Step>("input");

  // Input state
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState("NONE");
  const [apiKey, setApiKey] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");

  // Discovery state
  const [discoverySteps, setDiscoverySteps] = useState<DiscoveryStep[]>([]);
  const [discoveredEndpoints, setDiscoveredEndpoints] = useState<DiscoveredEndpoint[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Review state
  const [selectedEndpoints, setSelectedEndpoints] = useState<DiscoveredEndpoint[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [tableName, setTableName] = useState("");
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [incrementalKey, setIncrementalKey] = useState<string | null>(null);

  const buildCredentials = useCallback((): Record<string, string> => {
    switch (authType) {
      case "API_KEY": return { apiKey };
      case "BEARER": return { bearerToken: apiKey };
      case "BASIC": return { username, password };
      default: return {};
    }
  }, [authType, apiKey, username, password]);

  const buildAuthConfig = useCallback((): Record<string, unknown> => {
    if (authType === "API_KEY") return { headerName };
    if (authType === "BEARER") return { tokenPrefix: "Bearer" };
    return {};
  }, [authType, headerName]);

  const handleDiscover = useCallback(async () => {
    setStep("discovering");
    setDiscoveryError(null);

    const steps: DiscoveryStep[] = [
      { label: "Searching for documentation...", status: "running" },
      { label: "Probing endpoints...", status: "waiting" },
      { label: "Inferring schemas with AI...", status: "waiting" },
    ];
    setDiscoverySteps([...steps]);

    try {
      const res = await fetch("/api/alfheim/discover/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          authType,
          credentials: buildCredentials(),
          authConfig: buildAuthConfig(),
          description: description.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Discovery failed (${res.status})`);
      }

      const data = await res.json();

      // Mark all steps done
      steps[0].status = "done";
      steps[0].detail = data.upgradedToOpenApi ? "Spec found" : "Done";
      steps[1].status = "done";
      steps[1].detail = `${data.endpoints?.length ?? 0} found`;
      steps[2].status = "done";
      steps[2].detail = "Done";
      setDiscoverySteps([...steps]);

      const endpoints: DiscoveredEndpoint[] = (data.endpoints ?? []).map((ep: Record<string, unknown>) => ({
        endpoint: ep.endpoint as string,
        suggestedName: ep.suggestedName as string,
        responseRoot: ep.responseRoot as string,
        schema: ep.schema as SchemaMapping,
        incrementalKey: (ep.incrementalKey as string) ?? null,
        primaryKey: (ep.primaryKey as string) ?? null,
        confidence: (ep.confidence as "high" | "medium" | "low") ?? "medium",
        notes: (ep.notes as string[]) ?? [],
        pagination: ep.pagination as { type: string; config: Record<string, unknown> } | undefined,
      }));

      setDiscoveredEndpoints(endpoints);

      if (endpoints.length > 0) {
        setTimeout(() => setStep("endpoints"), 600);
      } else {
        setDiscoveryError("No data endpoints were discovered. Try a different URL or check your credentials.");
      }
    } catch (err) {
      steps.forEach((s) => { if (s.status === "running") s.status = "error"; });
      setDiscoverySteps([...steps]);
      setDiscoveryError(err instanceof Error ? err.message : "Discovery failed");
    }
  }, [baseUrl, authType, description, buildCredentials, buildAuthConfig]);

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
        <h1 className="heading-norse text-xl">Discover with AI</h1>
        <p className="text-text-dim text-xs tracking-wide mt-1">
          Paste a URL and credentials. AI discovers endpoints and maps schemas.
        </p>
      </div>

      {/* Step: Input */}
      {step === "input" && (
        <div className="space-y-4">
          <div>
            <label className="label-norse block mb-1">Base URL</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="input-norse w-full"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div>
            <label className="label-norse block mb-1">Authentication</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="input-norse w-full"
            >
              {AUTH_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Dynamic credential fields */}
          {authType === "API_KEY" && (
            <>
              <div>
                <label className="label-norse block mb-1">Header Name</label>
                <input
                  type="text"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  className="input-norse w-full"
                  placeholder="X-API-Key"
                />
              </div>
              <div>
                <label className="label-norse block mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="input-norse w-full"
                />
              </div>
            </>
          )}

          {authType === "BEARER" && (
            <div>
              <label className="label-norse block mb-1">Bearer Token</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input-norse w-full"
              />
            </div>
          )}

          {authType === "BASIC" && (
            <>
              <div>
                <label className="label-norse block mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-norse w-full"
                />
              </div>
              <div>
                <label className="label-norse block mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-norse w-full"
                />
              </div>
            </>
          )}

          <div>
            <label className="label-norse block mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-norse w-full"
              placeholder="What does this API do? Helps AI discover better."
            />
          </div>

          <button
            type="button"
            onClick={handleDiscover}
            disabled={!baseUrl.trim()}
            className="btn-primary disabled:opacity-40"
          >
            Start Discovery
          </button>
        </div>
      )}

      {/* Step: Discovering */}
      {step === "discovering" && (
        <div className="space-y-4">
          <DiscoveryProgress steps={discoverySteps} />
          {discoveryError && (
            <div className="space-y-3">
              <p className="text-sm text-red-400">{discoveryError}</p>
              <button type="button" onClick={() => setStep("input")} className="btn-ghost">
                &larr; Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step: Endpoints */}
      {step === "endpoints" && (
        <div className="space-y-4">
          <EndpointSelector
            endpoints={discoveredEndpoints}
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
      {step === "save" && (
        <div className="space-y-5">
          <SaveToCatalog
            baseUrl={baseUrl}
            authType={authType}
            authConfig={buildAuthConfig()}
            credentials={buildCredentials()}
            endpoints={selectedEndpoints}
            pagination={selectedEndpoints[0]?.pagination}
          />
          <button type="button" onClick={() => setStep("review")} className="btn-ghost">
            &larr; Back
          </button>
        </div>
      )}
    </div>
  );
}
