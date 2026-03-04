/**
 * NetSuiteProvider — Unified ConnectionProvider for NetSuite.
 *
 * Uses SuiteQL (REST API) for data extraction and metadata browsing.
 * Authentication: Token-Based Auth (TBA / OAuth 1.0a) with HMAC-SHA256 signing.
 * NetSuite is source-only — load/createTable/getSchema are not implemented.
 *
 * Credential source: connection.credentials.{consumerKey, consumerSecret, tokenId, tokenSecret}
 *   (already decrypted by toConnectionLike()).
 * Config source: connection.config.accountId
 */

import crypto from "crypto";
import type { ConnectionProvider } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";

// ─── Constants ─────────────────────────────────────────

const SUITEQL_PATH = "/services/rest/query/v1/suiteql";
const METADATA_CATALOG_PATH = "/services/rest/record/v1/metadata-catalog/";
const DEFAULT_PAGE_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 10000];

// ─── TBA Credentials ──────────────────────────────────

interface TbaCredentials {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

// ─── Connection ────────────────────────────────────────

interface NetSuiteProviderConnection extends ProviderConnection {
  baseUrl: string;
  tba: TbaCredentials;
}

// ─── Metadata Types ────────────────────────────────────

export interface NetSuiteRecordType {
  name: string;
  href: string;
}

export interface NetSuiteField {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
}

export interface NetSuiteSavedSearch {
  id: string;
  title: string;
  recordType: string;
}

// ─── Provider ──────────────────────────────────────────

export class NetSuiteProvider implements ConnectionProvider {
  readonly type = "NETSUITE";

  async connect(connection: ConnectionLike): Promise<NetSuiteProviderConnection> {
    const cfg = connection.config as { accountId?: string };
    const creds = connection.credentials as {
      consumerKey?: string;
      consumerSecret?: string;
      tokenId?: string;
      tokenSecret?: string;
    };

    const accountId = cfg?.accountId as string | undefined;
    const consumerKey = creds?.consumerKey as string | undefined;
    const consumerSecret = creds?.consumerSecret as string | undefined;
    const tokenId = creds?.tokenId as string | undefined;
    const tokenSecret = creds?.tokenSecret as string | undefined;

    if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      throw new Error("NetSuite TBA credentials incomplete");
    }

    // Build base URL: account ID may contain underscores for sandbox (e.g., "1234567_SB1")
    // NetSuite REST API URL format: https://{accountId}.suitetalk.api.netsuite.com
    const normalizedAccountId = accountId.toLowerCase().replace(/_/g, "-");
    const baseUrl = `https://${normalizedAccountId}.suitetalk.api.netsuite.com`;

    return {
      baseUrl,
      tba: { accountId, consumerKey, consumerSecret, tokenId, tokenSecret },
      close: async () => {
        // No persistent connection to close
      },
    };
  }

  /**
   * Quick connection test. Returns boolean per the ConnectionProvider interface,
   * but also exposes testConnectionExtended() for richer UI feedback.
   */
  async testConnection(connection: ConnectionLike): Promise<boolean> {
    try {
      const conn = await this.connect(connection);
      const result = await this.executeSuiteQL(
        conn,
        "SELECT companyname FROM company WHERE id = 1",
        1,
        0
      );
      return result.items.length >= 0; // Any successful response = connected
    } catch {
      return false;
    }
  }

  /**
   * Extended connection test returning richer info for the UI.
   * Preserves the old testConnection() signature with { success, message, accountName? }.
   */
  async testConnectionExtended(
    connection: ConnectionLike
  ): Promise<{ success: boolean; message: string; accountName?: string }> {
    try {
      const conn = await this.connect(connection);
      const result = await this.executeSuiteQL(
        conn,
        "SELECT companyname FROM company WHERE id = 1",
        1,
        0
      );

      const accountName =
        result.items.length > 0
          ? String(result.items[0].companyname ?? "")
          : undefined;

      return {
        success: true,
        message: accountName
          ? `Connected to ${accountName}`
          : "Connection successful",
        accountName,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown connection error";
      return { success: false, message };
    }
  }

  // ─── query() — thin wrapper around executeSuiteQL ────

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const nsConn = conn as NetSuiteProviderConnection;
    const result = await this.executeSuiteQL(nsConn, sql, DEFAULT_PAGE_LIMIT, 0);

    const columns =
      result.items.length > 0 ? Object.keys(result.items[0]) : [];

    return { columns, rows: result.items };
  }

  // ─── extract() — paginated SuiteQL streaming ─────────

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const nsConn = conn as NetSuiteProviderConnection;
    const chunkSize = config.chunkSize ?? DEFAULT_PAGE_LIMIT;

    let resolvedQuery = config.query;

    // Substitute @last_run params if incremental
    if (config.incrementalKey) {
      // The caller may pass last_run via SourceConfig extension — handle both Date and string
      const lastRun = (config as Record<string, unknown>).last_run;
      if (lastRun) {
        const lastRunStr =
          lastRun instanceof Date ? lastRun.toISOString() : String(lastRun);
        resolvedQuery = resolvedQuery.replace(/@last_run/g, `'${lastRunStr}'`);
      }
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await this.executeSuiteQL(
        nsConn,
        resolvedQuery,
        chunkSize,
        offset
      );

      if (result.items.length > 0) {
        yield result.items;
      } else if (offset === 0) {
        // First page returned no rows — yield empty to signal "no data"
        yield [];
      }

      hasMore = result.hasMore;
      offset += result.items.length;
    }
  }

  // ─── Metadata Browsing (UI only, not on ConnectionProvider interface) ───

  /** List available record types from the metadata catalog. */
  async listRecordTypes(
    connection: NetSuiteProviderConnection
  ): Promise<NetSuiteRecordType[]> {
    const url = `${connection.baseUrl}${METADATA_CATALOG_PATH}`;
    const response = await this.signedRequest(connection, "GET", url);

    const data = (await response.json()) as {
      items?: Array<{ name: string; href: string }>;
    };

    return (data.items ?? []).map((item) => ({
      name: item.name,
      href: item.href,
    }));
  }

  /** Get field metadata for a specific record type. */
  async getRecordFields(
    connection: NetSuiteProviderConnection,
    recordType: string
  ): Promise<NetSuiteField[]> {
    const url = `${connection.baseUrl}${METADATA_CATALOG_PATH}nsrecord/${encodeURIComponent(recordType)}`;
    const response = await this.signedRequest(connection, "GET", url);
    const data = (await response.json()) as {
      properties?: Record<
        string,
        { type?: string; title?: string; nullable?: boolean }
      >;
    };

    if (!data.properties) return [];

    return Object.entries(data.properties).map(([name, meta]) => ({
      name,
      type: mapNetSuiteType(meta.type),
      label: meta.title ?? name,
      mandatory: meta.nullable === false,
    }));
  }

  /** List public saved searches via SuiteQL. */
  async listSavedSearches(
    connection: NetSuiteProviderConnection
  ): Promise<NetSuiteSavedSearch[]> {
    const query =
      "SELECT id, title, recordtype FROM savedsearch WHERE ispublic = 'T' ORDER BY title ASC";
    const result = await this.executeSuiteQL(connection, query, 1000, 0);

    return result.items.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      recordType: String(row.recordtype ?? ""),
    }));
  }

  // ─── SuiteQL Execution ─────────────────────────────────

  async executeSuiteQL(
    connection: NetSuiteProviderConnection,
    query: string,
    limit: number = DEFAULT_PAGE_LIMIT,
    offset: number = 0
  ): Promise<{
    items: Record<string, unknown>[];
    hasMore: boolean;
    totalResults?: number;
  }> {
    const url = `${connection.baseUrl}${SUITEQL_PATH}`;
    const body = JSON.stringify({ q: query });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Prefer: `transient, max-page-size=${limit}`,
    };

    // Add offset via query parameter
    const requestUrl =
      offset > 0 ? `${url}?offset=${offset}` : url;

    const response = await this.signedRequest(
      connection,
      "POST",
      requestUrl,
      body,
      headers
    );

    const data = (await response.json()) as {
      items?: Record<string, unknown>[];
      hasMore?: boolean;
      totalResults?: number;
      count?: number;
    };

    return {
      items: data.items ?? [],
      hasMore: data.hasMore ?? false,
      totalResults: data.totalResults,
    };
  }

  // ─── OAuth 1.0a TBA Request Signing ────────────────────

  private async signedRequest(
    connection: NetSuiteProviderConnection,
    method: string,
    url: string,
    body?: string,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const authHeader = buildTbaAuthHeader(
        connection.tba,
        method.toUpperCase(),
        url
      );

      const headers: Record<string, string> = {
        Authorization: authHeader,
        ...extraHeaders,
      };

      try {
        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body: method.toUpperCase() !== "GET" ? body : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        // Rate limited — respect Retry-After
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : RETRY_BACKOFF_MS[attempt] ?? 10000;
          console.warn(
            `[NetSuite] Rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const parsed = tryParseJson(errorBody);
          const nsError = extractNetSuiteError(parsed, response.status);
          throw new Error(nsError);
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry auth errors or bad queries
        if (
          lastError.message.includes("INVALID_LOGIN") ||
          lastError.message.includes("INVALID_QUERY") ||
          lastError.message.includes("INSUFFICIENT_PERMISSION")
        ) {
          throw lastError;
        }

        // Retry on network/timeout errors
        if (attempt < MAX_RETRIES - 1) {
          const waitMs = RETRY_BACKOFF_MS[attempt] ?? 10000;
          console.warn(
            `[NetSuite] Request failed, retrying in ${waitMs}ms: ${lastError.message}`
          );
          await sleep(waitMs);
        }
      }
    }

    throw lastError ?? new Error("NetSuite request failed after retries");
  }
}

// ─── OAuth 1.0a TBA Signing Helpers ──────────────────────

/** Build the OAuth 1.0a Authorization header for TBA. */
export function buildTbaAuthHeader(
  tba: TbaCredentials,
  method: string,
  url: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  // Parse URL to separate base URL from query string
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Collect all OAuth params + query params for signature
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: tba.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_token: tba.tokenId,
    oauth_version: "1.0",
  };

  // Include query string params in signature base
  const allParams: Record<string, string> = { ...oauthParams };
  urlObj.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  // Sort params and build parameter string
  const paramString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join("&");

  // Build signature base string: METHOD&URL&PARAMS
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  // Sign with composite key: consumerSecret&tokenSecret
  const signingKey = `${percentEncode(tba.consumerSecret)}&${percentEncode(tba.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(signatureBase)
    .digest("base64");

  // Build Authorization header
  const authParams = {
    ...oauthParams,
    oauth_signature: signature,
    realm: tba.accountId,
  };

  const authString = Object.entries(authParams)
    .map(([key, value]) => `${key}="${percentEncode(value)}"`)
    .join(", ");

  return `OAuth ${authString}`;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// ─── Helpers ─────────────────────────────────────────────

function mapNetSuiteType(nsType?: string): string {
  if (!nsType) return "STRING";
  const t = nsType.toLowerCase();
  if (t.includes("integer") || t.includes("number")) return "INTEGER";
  if (t.includes("float") || t.includes("double") || t.includes("decimal"))
    return "FLOAT";
  if (t.includes("boolean")) return "BOOLEAN";
  if (t.includes("date") || t.includes("time")) return "TIMESTAMP";
  return "STRING";
}

function extractNetSuiteError(
  parsed: Record<string, unknown> | null,
  status: number
): string {
  if (parsed) {
    // NetSuite REST error format
    const title = parsed["o:errorDetails"]
      ? (
          parsed["o:errorDetails"] as Array<{
            code?: string;
            detail?: string;
          }>
        )?.[0]
      : null;
    if (title) {
      return `NetSuite ${title.code ?? "ERROR"}: ${title.detail ?? "Unknown error"} (HTTP ${status})`;
    }
    // SuiteQL error format
    if (parsed.title || parsed.detail) {
      return `NetSuite: ${parsed.title ?? ""} ${parsed.detail ?? ""} (HTTP ${status})`.trim();
    }
  }
  return `NetSuite request failed with HTTP ${status}`;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── SuiteQL Builder ─────────────────────────────────────

/** Build a SuiteQL query from structured source config. */
export function buildSuiteQL(config: {
  recordType: string;
  fields: string[];
  filter?: string | null;
}): string {
  const fields =
    config.fields.length > 0 ? config.fields.join(", ") : "*";
  let query = `SELECT ${fields} FROM ${config.recordType}`;

  if (config.filter) {
    query += ` WHERE ${config.filter}`;
  }

  query += " ORDER BY id ASC";
  return query;
}
