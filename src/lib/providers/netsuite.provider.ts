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

/** Validates a SuiteQL identifier (record type) against injection. */
const SAFE_SUITEQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Validates a SuiteQL field name, including dot-notation for sublist fields (e.g. "item.internalId"). */
const SAFE_SUITEQL_FIELD = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

/**
 * Maps SuiteQL table names to REST metadata-catalog record type names.
 * SuiteQL uses broad tables (e.g., "item", "transaction") while REST
 * uses specific subtypes (e.g., "inventoryItem", "salesOrder").
 * We map the common SuiteQL table names to their most common REST equivalent.
 */
const SUITEQL_TO_REST_RECORD_MAP: Record<string, string> = {
  item: "inventoryItem",
  transaction: "salesOrder",
  transactionline: "salesOrder",
  customer: "customer",
  vendor: "vendor",
  employee: "employee",
  contact: "contact",
};

function validateSuiteQLIdentifier(value: string, label: string): void {
  if (!SAFE_SUITEQL_IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
}

function validateSuiteQLField(value: string): void {
  if (!SAFE_SUITEQL_FIELD.test(value)) {
    throw new Error(`Invalid field name: "${value}"`);
  }
}

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
  isCustom?: boolean;
  isReference?: boolean;
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
      // Engine stores last_run in config.params; fallback to top-level for direct callers
      const lastRun = config.params?.last_run
        ?? (config as unknown as Record<string, unknown>).last_run;
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
        yield result.items.map(stripHateoasFields);
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

  /**
   * Get field metadata for a specific record type.
   *
   * Strategy:
   * 1. Try the REST metadata-catalog endpoint — returns all fields (standard + custom)
   *    with proper labels and types in a single call.
   * 2. If that fails (405 on many accounts), fall back to SuiteQL introspection:
   *    a) SELECT * with limit 1 for standard fields
   *    b) Query customfield table to discover custom fields missing from the sample row
   */
  async getRecordFields(
    connection: NetSuiteProviderConnection,
    recordType: string
  ): Promise<NetSuiteField[]> {
    validateSuiteQLIdentifier(recordType, "record type");

    // The REST metadata catalog describes a SPECIFIC record subtype (e.g.,
    // inventoryItem) while SuiteQL queries the GENERIC union table (e.g., item).
    // The catalog is trusted for field discovery — it provides rich metadata
    // (types, labels, isReference, mandatory). SELECT * only supplements with
    // columns the catalog doesn't know about.
    //
    // NOTE: SELECT * cannot be used to validate/filter catalog fields because
    // NetSuite omits null-valued columns from JSON responses. A field that's
    // null in the first row won't appear in SELECT * but is still queryable.

    let catalogFields: NetSuiteField[] = [];
    try {
      catalogFields = await this.getFieldsFromMetadataCatalog(connection, recordType);
    } catch {
      // Catalog unavailable — fall through
    }

    // SELECT * discovers columns the catalog may not know about (system columns,
    // fields from other subtypes). It does NOT filter catalog fields.
    let suiteqlRow: Record<string, unknown> | null = null;
    let suiteqlColumns: Set<string> = new Set();
    try {
      const result = await this.executeSuiteQL(
        connection,
        `SELECT * FROM ${recordType} FETCH FIRST 1 ROWS ONLY`,
        1,
        0
      );
      const METADATA_KEYS = new Set(["links"]);
      if (result.items.length > 0) {
        suiteqlRow = result.items[0];
        suiteqlColumns = new Set(
          Object.keys(suiteqlRow).filter((k) => !METADATA_KEYS.has(k))
        );
      }
    } catch {
      // SELECT * failed — continue with catalog only
    }

    const fieldMap = new Map<string, NetSuiteField>();

    if (catalogFields.length > 0) {
      // Trust all catalog fields
      for (const f of catalogFields) {
        fieldMap.set(f.name, f);
      }

      // Supplement with SuiteQL columns not in the catalog
      for (const col of suiteqlColumns) {
        if (!fieldMap.has(col)) {
          fieldMap.set(col, {
            name: col,
            type: suiteqlRow ? inferTypeFromValue(suiteqlRow[col]) : "STRING",
            label: col,
            mandatory: false,
            isCustom: isCustomFieldName(col),
          });
        }
      }
    } else if (suiteqlColumns.size > 0 && suiteqlRow) {
      // No catalog — build from SELECT * row with type inference
      for (const col of suiteqlColumns) {
        fieldMap.set(col, {
          name: col,
          type: inferTypeFromValue(suiteqlRow[col]),
          label: col,
          mandatory: false,
          isCustom: isCustomFieldName(col),
        });
      }
    } else {
      // Neither source returned data — try legacy SuiteQL fallback
      return this.getFieldsFromSuiteQL(connection, recordType);
    }

    // Discover custom fields from the customfield table that may be missing
    // from both catalog and SELECT * (null-valued custom fields are often
    // omitted from SuiteQL results).
    try {
      const customFields = await this.executeSuiteQL(
        connection,
        `SELECT scriptid, label, fieldtype FROM customfield WHERE appliesto = '${mapRecordTypeToAppliesto(recordType)}'`,
        1000,
        0
      );
      for (const row of customFields.items) {
        const scriptId = String(row.scriptid ?? "").toLowerCase();
        if (!scriptId || fieldMap.has(scriptId)) continue;
        fieldMap.set(scriptId, {
          name: scriptId,
          type: mapCustomFieldType(String(row.fieldtype ?? "")),
          label: String(row.label ?? scriptId),
          mandatory: false,
          isCustom: true,
        });
      }
    } catch {
      // customfield table may not be accessible
    }

    // Sort: standard first, then custom, alphabetical within each group
    return Array.from(fieldMap.values()).sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Fetch fields from the REST metadata-catalog endpoint. */
  private async getFieldsFromMetadataCatalog(
    connection: NetSuiteProviderConnection,
    recordType: string
  ): Promise<NetSuiteField[]> {
    // SuiteQL table names differ from REST record type names.
    // Try the REST name first, then fall back to the SuiteQL name.
    const mapped = SUITEQL_TO_REST_RECORD_MAP[recordType.toLowerCase()];
    const restNames = mapped && mapped !== recordType
      ? [mapped, recordType]
      : [recordType];

    let response: Response | null = null;
    for (const name of restNames) {
      const url = `${connection.baseUrl}/services/rest/record/v1/metadata-catalog/${name}`;
      try {
        response = await this.signedRequest(connection, "GET", url, undefined, {
          Accept: "application/schema+json",
        });
        break;
      } catch {
        // Try next name
      }
    }

    if (!response) throw new Error("Metadata catalog not available");

    const data = (await response.json()) as {
      properties?: Record<string, {
        title?: string;
        type?: string;
        format?: string;
        enum?: string[];
        nullable?: boolean;
        "x-ns-custom-field"?: boolean;
      }>;
    };

    if (!data.properties) return [];

    const SKIP_KEYS = new Set(["links", "id", "refName"]);
    const fields: NetSuiteField[] = [];

    for (const [name, meta] of Object.entries(data.properties)) {
      if (SKIP_KEYS.has(name)) continue;
      // Skip arrays (e.g., links)
      if (meta.type === "array") continue;
      // For object types, distinguish reference fields (valid SuiteQL columns that
      // return an internal ID) from sub-record/sublist collections (not queryable).
      // Reference fields have { id, refName } in properties; sublists have
      // { totalResults, count, hasMore, offset } — paginated collection markers.
      if (meta.type === "object") {
        const props = meta.properties as Record<string, unknown> | undefined;
        const isReference = props && "id" in props && !("totalResults" in props);
        if (!isReference) continue;
      }

      // SuiteQL requires lowercase identifiers — the catalog returns camelCase
      // (e.g., "salesDescription") but SuiteQL only accepts "salesdescription".
      const fieldName = name.toLowerCase();
      const custom = meta["x-ns-custom-field"] === true || isCustomFieldName(fieldName);
      const isRef = meta.type === "object";
      const fieldType = isRef ? "INTEGER" : mapCatalogType(meta.type, meta.format);
      fields.push({
        name: fieldName,
        type: fieldType,
        label: meta.title ?? name,
        mandatory: meta.nullable === false,
        isCustom: custom,
        isReference: isRef,
      });
    }

    // Sort: standard fields first, then custom fields, alphabetical within each group
    return fields.sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Fallback: discover fields via SuiteQL SELECT * + customfield query. */
  private async getFieldsFromSuiteQL(
    connection: NetSuiteProviderConnection,
    recordType: string
  ): Promise<NetSuiteField[]> {
    // Standard fields from SELECT * (limit 1)
    const result = await this.executeSuiteQL(
      connection,
      `SELECT * FROM ${recordType}`,
      1,
      0
    );

    const METADATA_KEYS = new Set(["links"]);
    const fieldMap = new Map<string, NetSuiteField>();

    if (result.items.length > 0) {
      for (const [name, value] of Object.entries(result.items[0])) {
        if (METADATA_KEYS.has(name)) continue;
        fieldMap.set(name, {
          name,
          type: inferTypeFromValue(value),
          label: name,
          mandatory: false,
          isCustom: isCustomFieldName(name),
        });
      }
    }

    // Discover custom fields that may be missing from the sample row
    // (null-valued custom fields are often omitted from SuiteQL results)
    try {
      const customFields = await this.executeSuiteQL(
        connection,
        `SELECT scriptid, label, fieldtype FROM customfield WHERE appliesto = '${mapRecordTypeToAppliesto(recordType)}'`,
        1000,
        0
      );

      for (const row of customFields.items) {
        const scriptId = String(row.scriptid ?? "").toLowerCase();
        if (!scriptId || fieldMap.has(scriptId)) continue;

        fieldMap.set(scriptId, {
          name: scriptId,
          type: mapCustomFieldType(String(row.fieldtype ?? "")),
          label: String(row.label ?? scriptId),
          mandatory: false,
          isCustom: true,
        });
      }
    } catch {
      // customfield table may not be accessible — continue with what we have
    }

    // Sort: standard first, then custom, alphabetical within each
    return Array.from(fieldMap.values()).sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
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
    if (offset === 0) console.log(`[NetSuite] Executing query: ${query}`);
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

/** Strip HATEOAS metadata fields injected by the NetSuite REST API. */
function stripHateoasFields(row: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { links, _links, ...rest } = row;
  return rest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check if a field name is a NetSuite custom field. */
function isCustomFieldName(name: string): boolean {
  return /^(custitem|custbody|custcol|custrecord|custevent|custentity)_/i.test(name);
}

/** Map REST metadata-catalog JSON schema type/format to our type system. */
function mapCatalogType(jsonType?: string, format?: string): string {
  if (format === "date-time" || format === "date") return "TIMESTAMP";
  if (format === "int64" || format === "int32") return "INTEGER";
  if (format === "float" || format === "double") return "FLOAT";
  if (jsonType === "boolean") return "BOOLEAN";
  if (jsonType === "integer" || jsonType === "number") {
    return format === "float" || format === "double" ? "FLOAT" : "INTEGER";
  }
  return "STRING";
}

/** Map NetSuite customfield.fieldtype values to our type system. */
function mapCustomFieldType(fieldType: string): string {
  const t = fieldType.toUpperCase();
  if (t === "CHECKBOX") return "BOOLEAN";
  if (t === "DATE" || t === "DATETIMETZ") return "TIMESTAMP";
  if (t === "INTEGER" || t === "INTEGERNUMBER") return "INTEGER";
  if (t === "FLOAT" || t === "CURRENCY" || t === "PERCENT" || t === "DECIMALNUMBER") return "FLOAT";
  return "STRING"; // TEXT, TEXTAREA, SELECT, MULTISELECT, RICHTEXT, etc.
}

/**
 * Map a SuiteQL record type name to the NetSuite customfield.appliesto value.
 * NetSuite uses specific enum values like ITEM, ENTITY, TRANSACTION, etc.
 */
function mapRecordTypeToAppliesto(recordType: string): string {
  const mapping: Record<string, string> = {
    item: "ITEM",
    customer: "ENTITY",
    vendor: "ENTITY",
    employee: "ENTITY",
    contact: "ENTITY",
    transaction: "TRANSACTION",
    transactionline: "TRANSACTIONCOLUMN",
  };
  return mapping[recordType.toLowerCase()] ?? recordType.toUpperCase();
}

// ─── SuiteQL Builder ─────────────────────────────────────

/** Build a SuiteQL query from structured source config. */
export function buildSuiteQL(config: {
  recordType: string;
  fields: string[];
  filter?: string | null;
}): string {
  validateSuiteQLIdentifier(config.recordType, "record type");
  const EXCLUDED = new Set(["links"]);
  const clean = config.fields.filter((f) => !EXCLUDED.has(f));
  for (const field of clean) {
    validateSuiteQLField(field);
  }
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
