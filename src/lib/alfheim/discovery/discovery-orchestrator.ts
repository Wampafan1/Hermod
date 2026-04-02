// ---------------------------------------------------------------------------
// Alfheim Discovery — orchestrates the full API discovery pipeline
// ---------------------------------------------------------------------------

import type { SchemaMapping, PaginationType } from "../types";
import { searchForApiDocs } from "./doc-search";
import { parseOpenApiSpec } from "./openapi-parser";
import { probeEndpoints } from "./probe-endpoints";
import { inferSchemaWithAI } from "./ai-schema-inference";
import { inferSchema } from "../schema-mapper";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoveryEndpoint {
  endpoint: string;
  suggestedName: string;
  schema: SchemaMapping;
  responseRoot: string;
  incrementalKey: string | null;
  primaryKey: string | null;
  confidence: "high" | "medium" | "low";
  notes: string[];
  pagination: { type: PaginationType; config: Record<string, unknown> };
}

export interface DiscoveryResult {
  endpoints: DiscoveryEndpoint[];
  baseUrl: string;
  detectedAuth: string;
  upgradedToOpenApi: boolean;
  specUrl?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDiscovery(input: {
  baseUrl: string;
  authType: string;
  credentials: Record<string, string>;
  authConfig?: Record<string, unknown>;
  description?: string;
}): Promise<DiscoveryResult> {
  const { baseUrl, authType, credentials, authConfig, description } = input;

  // ----- Step 1: Search for API documentation / OpenAPI spec -----
  let specUrl: string | undefined;
  let specEndpoints: DiscoveryEndpoint[] | null = null;

  try {
    const docResult = await searchForApiDocs(baseUrl);

    if (docResult.foundSpec && docResult.specUrl) {
      specUrl = docResult.specUrl;

      try {
        const parsed = await parseOpenApiSpec({ specUrl: docResult.specUrl });

        // Convert parsed endpoints to DiscoveryEndpoint format
        specEndpoints = parsed.endpoints.map((ep) => ({
          endpoint: ep.path,
          suggestedName: ep.suggestedName,
          schema: ep.responseSchema,
          responseRoot: ep.responseRoot,
          incrementalKey: null,
          primaryKey: null,
          confidence: "high" as const,
          notes: [
            ep.summary || "Discovered from OpenAPI spec",
          ].filter(Boolean),
          pagination: { type: "none" as PaginationType, config: {} },
        }));

        return {
          endpoints: specEndpoints,
          baseUrl: parsed.baseUrl || baseUrl,
          detectedAuth: parsed.auth.type,
          upgradedToOpenApi: true,
          specUrl,
        };
      } catch (parseErr) {
        console.error(
          "[alfheim/discovery] Failed to parse found spec, continuing with probe:",
          parseErr instanceof Error ? parseErr.message : parseErr,
        );
      }
    }
  } catch (docErr) {
    console.error(
      "[alfheim/discovery] Doc search failed, continuing with probe:",
      docErr instanceof Error ? docErr.message : docErr,
    );
  }

  // ----- Step 2: Probe endpoints for live data -----
  // Use doc-extracted endpoints if available, otherwise fall back to common patterns
  const endpointsToProbe: string[] = [];

  const probeResults = await probeEndpoints({
    baseUrl,
    authType,
    authConfig,
    credentials,
    endpoints: endpointsToProbe, // empty → probeEndpoints uses common patterns
  });

  const successfulProbes = probeResults.filter(
    (r) => r.hasData && r.sampleRecords.length > 0,
  );

  if (successfulProbes.length === 0) {
    return {
      endpoints: [],
      baseUrl,
      detectedAuth: authType,
      upgradedToOpenApi: false,
      specUrl,
    };
  }

  // ----- Step 3: AI schema inference for each successful probe -----
  const endpoints: DiscoveryEndpoint[] = [];

  for (const probe of successfulProbes) {
    try {
      const aiResult = await inferSchemaWithAI({
        endpoint: probe.endpoint,
        responseRoot: probe.responseRoot,
        sampleRecords: probe.sampleRecords,
        documentationContext: description,
      });

      endpoints.push({
        endpoint: probe.endpoint,
        suggestedName: aiResult.suggestedName,
        schema: aiResult.schema,
        responseRoot: probe.responseRoot,
        incrementalKey: aiResult.incrementalKey,
        primaryKey: aiResult.primaryKey,
        confidence: aiResult.confidence,
        notes: aiResult.notes,
        pagination: aiResult.detectedPagination,
      });
    } catch (aiErr) {
      // Fall back to deterministic inference if AI fails entirely
      console.error(
        `[alfheim/discovery] AI inference failed for ${probe.endpoint}:`,
        aiErr instanceof Error ? aiErr.message : aiErr,
      );

      const schema = inferSchema(probe.sampleRecords);
      endpoints.push({
        endpoint: probe.endpoint,
        suggestedName: suggestName(probe.endpoint),
        schema,
        responseRoot: probe.responseRoot,
        incrementalKey: null,
        primaryKey: null,
        confidence: "low",
        notes: ["Schema inferred without AI — AI call failed."],
        pagination: {
          type: (probe.detectedPagination as PaginationType) ?? "none",
          config: {},
        },
      });
    }
  }

  return {
    endpoints,
    baseUrl,
    detectedAuth: authType,
    upgradedToOpenApi: false,
    specUrl,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function suggestName(endpoint: string): string {
  const segments = endpoint
    .split("/")
    .filter((s) => s && !s.startsWith("{") && !/^v\d+$/i.test(s));

  const last = segments[segments.length - 1];
  if (!last) return "records";

  return last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
