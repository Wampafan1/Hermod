/**
 * REST API Provider — Extract data from external REST APIs.
 *
 * REST APIs are stateless (no persistent connection), so connect() is a no-op.
 * testConnection() verifies the base URL is reachable and auth credentials work.
 * extract() paginates through API responses and yields flattened record chunks.
 */

import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection } from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";
import type { PaginationConfig, RateLimitConfig, SchemaMapping } from "@/lib/alfheim/types";
import { flattenRecord } from "@/lib/alfheim/schema-mapper";

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_RETRY_AFTER_SEC = 60;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Auth Helper ─────────────────────────────────────────────

/**
 * Build authentication headers from connection config.
 * Shared by testConnection() and extract().
 */
export function buildAuthHeaders(
  authType: string,
  authConfig: Record<string, unknown> | undefined,
  credentials: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };

  switch (authType) {
    case "BEARER":
      headers["Authorization"] = `Bearer ${credentials.bearerToken || credentials.apiKey}`;
      break;
    case "API_KEY": {
      const headerName = (authConfig?.headerName as string) || "X-API-Key";
      headers[headerName] = (credentials.apiKey as string) || "";
      break;
    }
    case "BASIC": {
      const encoded = Buffer.from(
        `${credentials.username}:${credentials.password}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      break;
    }
  }

  return headers;
}

// ─── Response Parsing ────────────────────────────────────────

/** Extract an array from a JSON response using a dot-notation path (e.g. "data.items"). */
function extractResponseData(body: unknown, responseRoot: string): unknown[] {
  if (!responseRoot) {
    return Array.isArray(body) ? body : [];
  }

  const parts = responseRoot.split(".");
  let current: unknown = body;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[part];
  }

  return Array.isArray(current) ? current : [];
}

/** Extract a value from a JSON object using a dot-notation path (e.g. "meta.next_cursor"). */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Parse Link header for rel="next" URL. */
function parseLinkHeaderNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

// ─── Retry / Rate Limiting ───────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic for 5xx and 429 errors.
 * - 401/403: throws immediately (auth failure)
 * - 429: waits for Retry-After header (or default), then retries
 * - 5xx: exponential backoff, up to MAX_RETRIES
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === retries) break;
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    // Auth failures — no retry
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => "");
      console.error(`[REST] Auth failed ${response.status} for ${url}: ${body.slice(0, 500)}`);
      throw new Error(`Authentication failed (${response.status}): ${body.slice(0, 200)}`);
    }

    // Rate limited — wait and retry
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : DEFAULT_RETRY_AFTER_SEC;
      const waitMs = (Number.isNaN(waitSec) ? DEFAULT_RETRY_AFTER_SEC : waitSec) * 1000;
      if (attempt < retries) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Rate limited (429) after ${retries + 1} attempts`);
    }

    // Server errors — retry with backoff
    if (response.status >= 500) {
      lastError = new Error(`Server error (${response.status})`);
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    // Other non-OK — throw immediately
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  throw lastError ?? new Error("Request failed after retries");
}

// ─── Provider ────────────────────────────────────────────────

export class RestApiProvider implements ConnectionProvider {
  readonly type = "REST_API";

  async connect(_connection: ConnectionLike): Promise<ProviderConnection> {
    // REST APIs are stateless — no persistent connection needed.
    return {
      async close() {
        /* no-op */
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    const config = connection.config as Record<string, unknown>;
    const creds = connection.credentials as Record<string, unknown>;
    const baseUrl = config.baseUrl as string;
    const authType = config.authType as string;

    if (!baseUrl) throw new Error("No baseUrl in config");

    const authConfig = config.authConfig as Record<string, unknown> | undefined;
    const headers = buildAuthHeaders(authType, authConfig, creds);

    const response = await fetch(baseUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication failed (${response.status})`);
    }

    return response.ok;
  }

  async *extract(
    _conn: ProviderConnection,
    config: SourceConfig,
  ): AsyncGenerator<Record<string, unknown>[]> {
    // REST config comes from the connection + source config.
    // The engine passes connection details through config.params.__restConnection
    // or the caller must set them on config directly.
    const restMeta = (config.params?.__restConnection ?? {}) as Record<string, unknown>;

    const baseUrl = (restMeta.baseUrl ?? "") as string;
    const authType = (restMeta.authType ?? "") as string;
    const authConfig = restMeta.authConfig as Record<string, unknown> | undefined;
    const credentials = (restMeta.credentials ?? {}) as Record<string, unknown>;
    const pagination = (restMeta.pagination ?? { type: "none" }) as PaginationConfig;
    const rateLimiting = restMeta.rateLimiting as RateLimitConfig | undefined;

    const endpoint = config.endpoint ?? "";
    const responseRoot = config.responseRoot ?? "";
    const schema = config.schema as SchemaMapping | undefined;
    const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;

    if (!baseUrl) throw new Error("REST extract: no baseUrl in connection config");

    const headers = buildAuthHeaders(authType, authConfig, credentials);
    const fullUrl = endpoint
      ? `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`
      : baseUrl;

    console.log(`[REST extract] ${fullUrl} | authType=${authType} | credKeys=${Object.keys(credentials).join(",")}`);

    const requestInit: RequestInit = {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    // Rate limit delay between requests (ms)
    const rateLimitDelay = rateLimiting?.requestsPerSecond
      ? Math.ceil(1000 / rateLimiting.requestsPerSecond)
      : 0;

    let buffer: Record<string, unknown>[] = [];

    const flushIfNeeded = function* (
      buf: Record<string, unknown>[],
      force: boolean,
    ): Generator<Record<string, unknown>[]> {
      while (buf.length >= chunkSize) {
        yield buf.splice(0, chunkSize);
      }
      if (force && buf.length > 0) {
        yield buf.splice(0, buf.length);
      }
    };

    // Process a page of raw records into the buffer and yield chunks
    const processRecords = function (
      records: unknown[],
      schemaMapping: SchemaMapping | undefined,
      buf: Record<string, unknown>[],
    ): void {
      for (const raw of records) {
        if (raw == null || typeof raw !== "object") continue;
        const record = raw as Record<string, unknown>;

        if (schemaMapping) {
          const { main } = flattenRecord(record, schemaMapping);
          buf.push(main);
        } else {
          // No schema — pass through as-is (shallow)
          buf.push(record);
        }
      }
    };

    // ── Pagination strategies ────────────────────────────

    if (pagination.type === "none" || !pagination.type) {
      // Single request
      const response = await fetchWithRetry(fullUrl, requestInit);
      const body = await response.json();
      const records = extractResponseData(body, responseRoot);
      processRecords(records, schema, buffer);
      yield* flushIfNeeded(buffer, true);
      return;
    }

    if (pagination.type === "page_number") {
      const pageParam = pagination.pageParam || "page";
      const limitParam = pagination.limitParam || "limit";
      const limit = pagination.defaultLimit || 100;
      let page = 1;

      while (true) {
        const url = new URL(fullUrl);
        url.searchParams.set(pageParam, String(page));
        url.searchParams.set(limitParam, String(limit));

        const response = await fetchWithRetry(url.toString(), {
          ...requestInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = await response.json();
        const records = extractResponseData(body, responseRoot);

        if (records.length === 0) break;

        processRecords(records, schema, buffer);
        yield* flushIfNeeded(buffer, false);

        // If we got fewer than the limit, this is the last page
        if (records.length < limit) break;

        page++;
        if (rateLimitDelay > 0) await sleep(rateLimitDelay);
      }

      yield* flushIfNeeded(buffer, true);
      return;
    }

    if (pagination.type === "offset") {
      const limitParam = pagination.limitParam || "limit";
      const limit = pagination.defaultLimit || 100;
      let offset = 0;

      while (true) {
        const url = new URL(fullUrl);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set(limitParam, String(limit));

        const response = await fetchWithRetry(url.toString(), {
          ...requestInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = await response.json();
        const records = extractResponseData(body, responseRoot);

        if (records.length === 0) break;

        processRecords(records, schema, buffer);
        yield* flushIfNeeded(buffer, false);

        if (records.length < limit) break;

        offset += limit;
        if (rateLimitDelay > 0) await sleep(rateLimitDelay);
      }

      yield* flushIfNeeded(buffer, true);
      return;
    }

    if (pagination.type === "cursor") {
      const cursorPath = pagination.cursorPath || "meta.next_cursor";
      const pageParam = pagination.pageParam || "cursor";
      let cursor: string | null = null;

      while (true) {
        const url = new URL(fullUrl);
        if (cursor) {
          url.searchParams.set(pageParam, cursor);
        }

        const response = await fetchWithRetry(url.toString(), {
          ...requestInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = await response.json();
        const records = extractResponseData(body, responseRoot);

        if (records.length === 0) break;

        processRecords(records, schema, buffer);
        yield* flushIfNeeded(buffer, false);

        // Extract next cursor
        const nextCursor = getByPath(body, cursorPath);
        if (!nextCursor || typeof nextCursor !== "string") break;
        cursor = nextCursor;

        if (rateLimitDelay > 0) await sleep(rateLimitDelay);
      }

      yield* flushIfNeeded(buffer, true);
      return;
    }

    if (pagination.type === "link_header") {
      let nextUrl: string | null = fullUrl;

      while (nextUrl) {
        const response = await fetchWithRetry(nextUrl, {
          ...requestInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = await response.json();
        const records = extractResponseData(body, responseRoot);

        if (records.length === 0) break;

        processRecords(records, schema, buffer);
        yield* flushIfNeeded(buffer, false);

        nextUrl = parseLinkHeaderNext(response.headers.get("Link"));
        if (rateLimitDelay > 0 && nextUrl) await sleep(rateLimitDelay);
      }

      yield* flushIfNeeded(buffer, true);
      return;
    }

    throw new Error(`Unsupported pagination type: ${pagination.type}`);
  }
}
