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
const DEFAULT_PAGE_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 10000];

/**
 * Known SuiteQL table names. The REST metadata catalog returns record IDs
 * (e.g., "assemblybuild") that don't work in SuiteQL — SuiteQL uses broader
 * tables (e.g., "transaction" with a `type` filter). This curated list covers
 * the most common SuiteQL-queryable tables.
 */
const SUITEQL_TABLES: { name: string; label: string; category: string }[] = [
  // Transactions
  { name: "transaction", label: "Transactions (all types)", category: "Transactions" },
  { name: "transactionline", label: "Transaction Lines", category: "Transactions" },
  { name: "transactionaccountingline", label: "GL Posting Lines", category: "Transactions" },
  // Entities
  { name: "customer", label: "Customers", category: "Entities" },
  { name: "vendor", label: "Vendors", category: "Entities" },
  { name: "employee", label: "Employees", category: "Entities" },
  { name: "contact", label: "Contacts", category: "Entities" },
  // Items
  { name: "item", label: "Items (all types)", category: "Items" },
  // Accounting
  { name: "account", label: "GL Accounts", category: "Accounting" },
  { name: "accountingperiod", label: "Accounting Periods", category: "Accounting" },
  { name: "currency", label: "Currencies", category: "Accounting" },
  { name: "exchangerate", label: "Exchange Rates", category: "Accounting" },
  // Organization
  { name: "subsidiary", label: "Subsidiaries", category: "Organization" },
  { name: "department", label: "Departments", category: "Organization" },
  { name: "location", label: "Locations", category: "Organization" },
  { name: "classification", label: "Classes", category: "Organization" },
  // Inventory
  { name: "inventoryassignment", label: "Lot/Serial/Bin Assignments", category: "Inventory" },
  // System
  { name: "systemnote", label: "Audit Trail / Field Changes", category: "System" },
  { name: "role", label: "Roles", category: "System" },
  { name: "rolepermissions", label: "Role Permissions", category: "System" },
];

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
  label: string;
  category: string;
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

    // Trim all credentials — copy-paste from NetSuite UI often includes trailing whitespace
    const accountId = (cfg?.accountId as string | undefined)?.trim();
    const consumerKey = (creds?.consumerKey as string | undefined)?.trim();
    const consumerSecret = (creds?.consumerSecret as string | undefined)?.trim();
    const tokenId = (creds?.tokenId as string | undefined)?.trim();
    const tokenSecret = (creds?.tokenSecret as string | undefined)?.trim();

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
        "SELECT CURRENT_TIMESTAMP AS ts",
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
        "SELECT CURRENT_TIMESTAMP AS ts",
        1,
        0
      );

      return {
        success: true,
        message: `Connected to NetSuite (account ${connection.config?.accountId ?? "unknown"})`,
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

    // Sanitize stored queries: strip REST metadata fields and ORDER BY id
    // (not all SuiteQL tables have an 'id' column).
    let resolvedQuery = config.query
      .replace(
        /SELECT\s+(.*?)\s+FROM/i,
        (_match, fieldList: string) => {
          const cleaned = fieldList
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f.toLowerCase() !== "links")
            .join(", ");
          return `SELECT ${cleaned || "*"} FROM`;
        }
      )
      .replace(/\s+ORDER\s+BY\s+id\s+ASC\s*$/i, "");

    // Substitute @last_run params if incremental
    if (config.incrementalKey) {
      // The caller may pass last_run via SourceConfig extension — handle both Date and string
      const lastRun = (config as unknown as Record<string, unknown>).last_run;
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
  /**
   * List SuiteQL-compatible record types.
   * Returns a curated list of known tables plus any custom records
   * discovered via SuiteQL (customrecord_* tables).
   */
  async listRecordTypes(
    connection: NetSuiteProviderConnection
  ): Promise<NetSuiteRecordType[]> {
    const results: NetSuiteRecordType[] = [...SUITEQL_TABLES];

    // Discover custom records dynamically
    try {
      const customRecords = await this.executeSuiteQL(
        connection,
        "SELECT scriptid, name FROM customrecordtype ORDER BY name",
        1000,
        0
      );
      for (const row of customRecords.items) {
        const scriptId = String(row.scriptid ?? "").toLowerCase();
        const name = String(row.name ?? scriptId);
        if (scriptId) {
          results.push({ name: scriptId, label: name, category: "Custom Records" });
        }
      }
    } catch {
      // Custom record discovery failed — return curated list only
      console.warn("[NetSuite] Custom record discovery failed, using curated list only");
    }

    return results;
  }

  /** Get field metadata for a specific record type via SuiteQL introspection. */
  async getRecordFields(
    connection: NetSuiteProviderConnection,
    recordType: string
  ): Promise<NetSuiteField[]> {
    // Use SuiteQL SELECT * with limit 1 to discover available columns.
    // This is more reliable than the metadata catalog which returns 405
    // for individual record schemas on many NetSuite accounts.
    const result = await this.executeSuiteQL(
      connection,
      `SELECT * FROM ${recordType}`,
      1,
      0
    );

    if (result.items.length === 0) {
      // Record type exists but has no rows — column names unavailable
      return [];
    }

    // Extract field names from the first row and infer types from values.
    // Filter out "links" — it's HATEOAS metadata, not an actual column.
    const METADATA_KEYS = new Set(["links"]);
    return Object.entries(result.items[0])
      .filter(([name]) => !METADATA_KEYS.has(name))
      .map(([name, value]) => ({
        name,
        type: inferTypeFromValue(value),
        label: name,
        mandatory: false,
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
          const err = new Error(nsError);
          // Tag 4xx errors (except 429, handled above) as non-retryable
          if (response.status >= 400 && response.status < 500) {
            (err as Error & { nonRetryable?: boolean }).nonRetryable = true;
          }
          throw err;
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry auth errors, bad queries, or any 4xx client error
        if (
          (lastError as Error & { nonRetryable?: boolean }).nonRetryable ||
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

/** Infer a BigQuery-compatible type from a sample SuiteQL value. */
function inferTypeFromValue(value: unknown): string {
  if (value === null || value === undefined) return "STRING";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "FLOAT";
  if (typeof value === "string") {
    // Check for date-like patterns: "2024-01-15" or "1/15/2024 12:00:00 AM"
    if (/^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) {
      return "TIMESTAMP";
    }
  }
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
  const EXCLUDED = new Set(["links"]);
  const clean = config.fields.filter((f) => !EXCLUDED.has(f));
  const fields = clean.length > 0 ? clean.join(", ") : "*";
  let query = `SELECT ${fields} FROM ${config.recordType}`;

  if (config.filter) {
    query += ` WHERE ${config.filter}`;
  }

  // Only add ORDER BY id if 'id' is among the selected fields — not all
  // SuiteQL tables have an 'id' column (e.g. itemAssemblyItemBom).
  const hasId = clean.some((f) => f.toLowerCase() === "id");
  if (hasId) {
    query += " ORDER BY id ASC";
  }
  return query;
}
