// ---------------------------------------------------------------------------
// Alfheim Discovery — probe live API endpoints for sample data
// ---------------------------------------------------------------------------

import { buildAuthHeaders } from "../../providers/rest-api.provider";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProbeResult {
  endpoint: string;
  status: number;
  hasData: boolean;
  recordCount: number;
  sampleRecords: Record<string, unknown>[];
  responseRoot: string;
  detectedPagination?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 15_000;
const MAX_SAMPLE_RECORDS = 5;

/** Common wrapper keys ordered by priority. */
const DATA_ARRAY_KEYS = ["data", "results", "items", "records", "entries", "rows"];

/** Common pagination indicator fields. */
const PAGINATION_FIELDS: Record<string, string> = {
  next: "cursor",
  cursor: "cursor",
  next_cursor: "cursor",
  nextCursor: "cursor",
  next_page_token: "cursor",
  nextPageToken: "cursor",
  offset: "offset",
  page: "page_number",
  current_page: "page_number",
  currentPage: "page_number",
  total: "offset", // presence of total hints offset-style
  total_count: "offset",
  totalCount: "offset",
};

/** Fallback paths to try when no explicit endpoints are given. */
const COMMON_PATHS = ["/api", "/api/v1", "/api/v2", "/v1", "/v2"];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function probeEndpoints(config: {
  baseUrl: string;
  authType: string;
  authConfig?: Record<string, unknown>;
  credentials: Record<string, string>;
  endpoints: string[];
}): Promise<ProbeResult[]> {
  const { baseUrl, authType, authConfig, credentials } = config;
  const endpointsToProbe =
    config.endpoints.length > 0 ? config.endpoints : COMMON_PATHS;

  const headers = buildAuthHeaders(authType, authConfig, credentials);

  // Probe in parallel with concurrency limit of 3
  const CONCURRENCY = 3;
  const results: ProbeResult[] = [];
  for (let i = 0; i < endpointsToProbe.length; i += CONCURRENCY) {
    const batch = endpointsToProbe.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((ep) => probeSingleEndpoint(baseUrl, ep, headers)),
    );
    results.push(...batchResults);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Single endpoint probe
// ---------------------------------------------------------------------------

async function probeSingleEndpoint(
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
): Promise<ProbeResult> {
  const url = normalizeUrl(baseUrl, endpoint);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        endpoint,
        status: response.status,
        hasData: false,
        recordCount: 0,
        sampleRecords: [],
        responseRoot: "",
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      return {
        endpoint,
        status: response.status,
        hasData: false,
        recordCount: 0,
        sampleRecords: [],
        responseRoot: "",
        error: `Non-JSON response: ${contentType}`,
      };
    }

    const body: unknown = await response.json();
    const { records, root } = findDataArray(body);
    const pagination = detectPagination(body);

    return {
      endpoint,
      status: response.status,
      hasData: records.length > 0,
      recordCount: records.length,
      sampleRecords: records.slice(0, MAX_SAMPLE_RECORDS),
      responseRoot: root,
      ...(pagination ? { detectedPagination: pagination } : {}),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during probe";
    return {
      endpoint,
      status: 0,
      hasData: false,
      recordCount: 0,
      sampleRecords: [],
      responseRoot: "",
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Walk the response body looking for the first array of objects.
 * Prioritizes known wrapper keys (data, results, items, ...).
 */
function findDataArray(
  body: unknown,
): { records: Record<string, unknown>[]; root: string } {
  // Direct array
  if (Array.isArray(body)) {
    const records = body.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
    return { records, root: "$" };
  }

  if (typeof body !== "object" || body === null) {
    return { records: [], root: "" };
  }

  const obj = body as Record<string, unknown>;

  // Check priority keys first
  for (const key of DATA_ARRAY_KEYS) {
    if (key in obj && Array.isArray(obj[key])) {
      const records = (obj[key] as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
      if (records.length > 0) return { records, root: key };
    }
  }

  // Fall back to first array property that contains objects
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      const records = (val as unknown[]).filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
      if (records.length > 0) return { records, root: key };
    }
  }

  return { records: [], root: "" };
}

/**
 * Detect pagination style from response body structure.
 */
function detectPagination(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Check for Link header-style (next URL)
  if (typeof obj["next"] === "string" && obj["next"]) {
    return "cursor";
  }

  for (const key of keys) {
    const paginationType = PAGINATION_FIELDS[key];
    if (paginationType && obj[key] !== null && obj[key] !== undefined) {
      return paginationType;
    }
  }

  return undefined;
}
