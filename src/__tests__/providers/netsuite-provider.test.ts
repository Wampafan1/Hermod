import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────
const mockFetch = vi.hoisted(() => vi.fn());

// ─── Import under test ──────────────────────────────
import {
  NetSuiteProvider,
  buildTbaAuthHeader,
  buildSuiteQL,
} from "@/lib/providers/netsuite.provider";
import type { ConnectionLike } from "@/lib/providers/types";
import type { ConnectionProvider } from "@/lib/providers/provider";

// ─── Test fixtures ──────────────────────────────────

const MOCK_TBA = {
  accountId: "1234567_SB1",
  consumerKey: "ck_consumer",
  consumerSecret: "cs_secret",
  tokenId: "tk_token",
  tokenSecret: "ts_secret",
};

function makeConnection(overrides?: {
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}): ConnectionLike {
  return {
    type: "NETSUITE",
    config: {
      accountId: "1234567_SB1",
      ...overrides?.config,
    },
    credentials: {
      consumerKey: "ck_consumer",
      consumerSecret: "cs_secret",
      tokenId: "tk_token",
      tokenSecret: "ts_secret",
      ...overrides?.credentials,
    },
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: {
      get: vi.fn((key: string) => headers?.[key] ?? null),
    },
  };
}

/** Mock a 404 response for the metadata-catalog GET (so getRecordFields falls through to SuiteQL). */
function catalogNotFound() {
  return jsonResponse({ message: "Not found" }, 404);
}

/** Mock a 400 response for the customfield SuiteQL query (table not available on all accounts). */
function customFieldNotFound() {
  return jsonResponse({ title: "Invalid search", detail: "Record 'customfield' was not found." }, 400);
}

// ─── Test suite ─────────────────────────────────────

describe("NetSuiteProvider", () => {
  let provider: NetSuiteProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    provider = new NetSuiteProvider();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ═══════════════════════════════════════════════════
  // Interface compliance
  // ═══════════════════════════════════════════════════

  it("has type NETSUITE", () => {
    expect(provider.type).toBe("NETSUITE");
  });

  it("implements ConnectionProvider interface", () => {
    const p: ConnectionProvider = provider;
    expect(p.connect).toBeDefined();
    expect(p.testConnection).toBeDefined();
    expect(p.query).toBeDefined();
    expect(p.extract).toBeDefined();
  });

  it("does not implement load, getSchema, or createTable (source-only)", () => {
    const p = provider as Record<string, unknown>;
    expect(p.load).toBeUndefined();
    expect(p.getSchema).toBeUndefined();
    expect(p.createTable).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════
  // 1. TBA OAuth 1.0a signing
  // ═══════════════════════════════════════════════════

  describe("buildTbaAuthHeader", () => {
    let dateNowSpy: ReturnType<typeof vi.spyOn>;
    let randomBytesSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Fix timestamp and nonce for deterministic signatures
      dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      const crypto = require("crypto");
      randomBytesSpy = vi.spyOn(crypto, "randomBytes").mockReturnValue({
        toString: () => "abcdef1234567890abcdef1234567890",
      });
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
      randomBytesSpy.mockRestore();
    });

    it("generates valid OAuth header with all required params", () => {
      const header = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"
      );

      expect(header).toMatch(/^OAuth /);
      expect(header).toContain('oauth_consumer_key="ck_consumer"');
      expect(header).toContain('oauth_token="tk_token"');
      expect(header).toContain("oauth_signature_method=");
      expect(header).toContain("oauth_timestamp=");
      expect(header).toContain("oauth_nonce=");
      expect(header).toContain("oauth_version=");
      expect(header).toContain("oauth_signature=");
    });

    it("includes realm in header", () => {
      const header = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://1234567-sb1.suitetalk.api.netsuite.com/test"
      );

      expect(header).toContain(`realm="${MOCK_TBA.accountId}"`);
    });

    it("uses HMAC-SHA256 signature method", () => {
      const header = buildTbaAuthHeader(
        MOCK_TBA,
        "POST",
        "https://1234567-sb1.suitetalk.api.netsuite.com/test"
      );

      expect(header).toContain('oauth_signature_method="HMAC-SHA256"');
    });

    it("includes URL query parameters in signature base", () => {
      const urlWithQuery =
        "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?offset=100";

      const header = buildTbaAuthHeader(MOCK_TBA, "POST", urlWithQuery);

      // The signature should differ when query params are present because
      // they're included in the signature base string
      const headerNoQuery = buildTbaAuthHeader(
        MOCK_TBA,
        "POST",
        "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"
      );

      // Extract signatures
      const sigMatch1 = header.match(/oauth_signature="([^"]+)"/);
      const sigMatch2 = headerNoQuery.match(/oauth_signature="([^"]+)"/);
      expect(sigMatch1).not.toBeNull();
      expect(sigMatch2).not.toBeNull();
      // Signatures must differ due to different base strings
      expect(sigMatch1![1]).not.toBe(sigMatch2![1]);
    });

    it("produces deterministic output with fixed timestamp and nonce", () => {
      const header1 = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://test.suitetalk.api.netsuite.com/test"
      );
      const header2 = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://test.suitetalk.api.netsuite.com/test"
      );

      expect(header1).toBe(header2);
    });

    it("produces correct timestamp from Date.now", () => {
      const header = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://test.suitetalk.api.netsuite.com/test"
      );

      // 1700000000000 ms => 1700000000 seconds
      expect(header).toContain('oauth_timestamp="1700000000"');
    });

    it("uses oauth_version 1.0", () => {
      const header = buildTbaAuthHeader(
        MOCK_TBA,
        "GET",
        "https://test.suitetalk.api.netsuite.com/test"
      );

      expect(header).toContain('oauth_version="1.0"');
    });
  });

  // ═══════════════════════════════════════════════════
  // 2. connect()
  // ═══════════════════════════════════════════════════

  describe("connect", () => {
    it("creates connection from ConnectionLike config+credentials", async () => {
      const conn = await provider.connect(makeConnection());

      expect(typeof conn.close).toBe("function");
      expect((conn as any).baseUrl).toBe(
        "https://1234567-sb1.suitetalk.api.netsuite.com"
      );
      expect((conn as any).tba).toEqual(MOCK_TBA);
    });

    it("builds correct base URL with underscores converted to hyphens for sandbox", async () => {
      const conn = await provider.connect(
        makeConnection({ config: { accountId: "9876543_SB2" } })
      );

      expect((conn as any).baseUrl).toBe(
        "https://9876543-sb2.suitetalk.api.netsuite.com"
      );
    });

    it("lowercases account ID in URL", async () => {
      const conn = await provider.connect(
        makeConnection({ config: { accountId: "ACCT_SB1" } })
      );

      expect((conn as any).baseUrl).toBe(
        "https://acct-sb1.suitetalk.api.netsuite.com"
      );
    });

    it("preserves original accountId in tba credentials", async () => {
      const conn = await provider.connect(
        makeConnection({ config: { accountId: "ACCT_SB1" } })
      );

      expect((conn as any).tba.accountId).toBe("ACCT_SB1");
    });

    it("throws on missing accountId", async () => {
      await expect(
        provider.connect(makeConnection({ config: { accountId: "" } }))
      ).rejects.toThrow("NetSuite TBA credentials incomplete");
    });

    it("throws on missing credentials", async () => {
      await expect(
        provider.connect(
          makeConnection({ credentials: { consumerSecret: "" } })
        )
      ).rejects.toThrow("NetSuite TBA credentials incomplete");
    });

    it("throws when tokenId is missing", async () => {
      await expect(
        provider.connect(
          makeConnection({ credentials: { tokenId: "" } })
        )
      ).rejects.toThrow("NetSuite TBA credentials incomplete");
    });

    it("does NOT call decrypt — credentials arrive pre-decrypted", async () => {
      // The new provider reads from connection.credentials directly.
      // No decrypt import or call should exist.
      const conn = await provider.connect(makeConnection());

      // Verify the credentials come through as-is
      expect((conn as any).tba.consumerSecret).toBe("cs_secret");
      expect((conn as any).tba.tokenSecret).toBe("ts_secret");
    });

    it("close() is a no-op (no persistent connection)", async () => {
      const conn = await provider.connect(makeConnection());
      await expect(conn.close()).resolves.toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════
  // 3. extract() — pagination via SourceConfig
  // ═══════════════════════════════════════════════════

  describe("extract", () => {
    async function connectDefault() {
      return provider.connect(makeConnection());
    }

    it("yields paginated chunks", async () => {
      const page1 = { items: [{ id: 1 }, { id: 2 }], hasMore: true };
      const page2 = { items: [{ id: 3 }], hasMore: false };

      mockFetch
        .mockResolvedValueOnce(jsonResponse(page1))
        .mockResolvedValueOnce(jsonResponse(page2));

      const conn = await connectDefault();
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM item", chunkSize: 2 })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
    });

    it("yields empty array for no results", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await connectDefault();
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM empty" })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([[]]);
    });

    it("stops when hasMore is false", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 1 }], hasMore: false })
      );

      const conn = await connectDefault();
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT 1 FROM dual" })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("paginates with offset incrementing by items received", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ items: [{ id: 1 }, { id: 2 }, { id: 3 }], hasMore: true })
        )
        .mockResolvedValueOnce(
          jsonResponse({ items: [{ id: 4 }, { id: 5 }], hasMore: false })
        );

      const conn = await connectDefault();
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM item", chunkSize: 3 })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      // Second call should have offset=3 in the URL
      const secondUrl = mockFetch.mock.calls[1][0];
      expect(secondUrl).toContain("offset=3");
    });

    it("does not pass offset on the first page", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 1 }], hasMore: false })
      );

      const conn = await connectDefault();
      for await (const _ of provider.extract!(conn, { query: "SELECT 1" })) {
        // consume
      }

      const firstUrl = mockFetch.mock.calls[0][0];
      expect(firstUrl).not.toContain("offset");
    });

    it("uses DEFAULT_PAGE_LIMIT when chunkSize not specified", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 1 }], hasMore: false })
      );

      const conn = await connectDefault();
      for await (const _ of provider.extract!(conn, { query: "SELECT 1" })) {
        // consume
      }

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Prefer).toBe("transient, max-page-size=1000");
    });
  });

  // ═══════════════════════════════════════════════════
  // 4. executeSuiteQL()
  // ═══════════════════════════════════════════════════

  describe("executeSuiteQL", () => {
    async function connectDefault() {
      return provider.connect(makeConnection()) as Promise<any>;
    }

    it("sends correct request format (POST with { q: query })", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 1 }], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT id FROM item", 100, 0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ q: "SELECT id FROM item" });
    });

    it("sets Prefer header with page size", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT 1", 500, 0);

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Prefer).toBe("transient, max-page-size=500");
    });

    it("sets Content-Type to application/json", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT 1", 100, 0);

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });

    it("handles offset pagination", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 5 }], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT id FROM item", 10, 50);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("?offset=50");
    });

    it("does not add offset param when offset is 0", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT 1", 100, 0);

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("offset");
    });

    it("returns items, hasMore, and totalResults from response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 1 }, { id: 2 }],
          hasMore: true,
          totalResults: 100,
        })
      );

      const conn = await connectDefault();
      const result = await provider.executeSuiteQL(conn, "SELECT id FROM item", 2, 0);

      expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.hasMore).toBe(true);
      expect(result.totalResults).toBe(100);
    });

    it("defaults items to [] and hasMore to false when missing from response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const conn = await connectDefault();
      const result = await provider.executeSuiteQL(conn, "SELECT 1", 100, 0);

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.totalResults).toBeUndefined();
    });

    it("includes Authorization header from TBA signing", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT 1", 100, 0);

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toMatch(/^OAuth /);
      expect(opts.headers.Authorization).toContain("oauth_consumer_key=");
    });
  });

  // ═══════════════════════════════════════════════════
  // 5. query() — thin wrapper around executeSuiteQL
  // ═══════════════════════════════════════════════════

  describe("query", () => {
    it("returns columns and rows from SuiteQL results", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: 1, name: "Widget" },
            { id: 2, name: "Gadget" },
          ],
          hasMore: false,
        })
      );

      const conn = await provider.connect(makeConnection());
      const result = await provider.query!(conn, "SELECT id, name FROM item");

      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual([
        { id: 1, name: "Widget" },
        { id: 2, name: "Gadget" },
      ]);
    });

    it("returns empty columns and rows for no data", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await provider.connect(makeConnection());
      const result = await provider.query!(conn, "SELECT 1 WHERE 1=0");

      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it("uses default page limit (1000)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = await provider.connect(makeConnection());
      await provider.query!(conn, "SELECT 1");

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Prefer).toBe("transient, max-page-size=1000");
    });
  });

  // ═══════════════════════════════════════════════════
  // 6. listRecordTypes()
  // ═══════════════════════════════════════════════════

  describe("listRecordTypes", () => {
    it("includes curated SuiteQL tables", async () => {
      // Mock the custom record discovery SuiteQL call
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const types = await provider.listRecordTypes(conn);

      // Should include known curated tables
      const names = types.map((t) => t.name);
      expect(names).toContain("transaction");
      expect(names).toContain("customer");
      expect(names).toContain("item");
      expect(names).toContain("subsidiary");

      // Each type should have label and category
      const tx = types.find((t) => t.name === "transaction")!;
      expect(tx.label).toBe("Transactions (all types)");
      expect(tx.category).toBe("Transactions");
    });

    it("appends custom records discovered via SuiteQL", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [
            { scriptid: "customrecord_my_data", name: "My Custom Data" },
            { scriptid: "customrecord_inv_ext", name: "Inventory Extension" },
          ],
          hasMore: false,
        })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const types = await provider.listRecordTypes(conn);

      const customTypes = types.filter((t) => t.category === "Custom Records");
      expect(customTypes).toEqual([
        { name: "customrecord_my_data", label: "My Custom Data", category: "Custom Records" },
        { name: "customrecord_inv_ext", label: "Inventory Extension", category: "Custom Records" },
      ]);
    });

    it("returns curated list when custom record query fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("SuiteQL failed"));

      const conn = (await provider.connect(makeConnection())) as any;
      const types = await provider.listRecordTypes(conn);

      // Should still have curated tables
      expect(types.length).toBeGreaterThan(0);
      expect(types.some((t) => t.name === "customer")).toBe(true);
      // No custom records category
      expect(types.every((t) => t.category !== "Custom Records")).toBe(true);
    });

    it("uses SuiteQL POST to discover custom records", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      await provider.listRecordTypes(conn);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/suiteql");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.q).toContain("customrecordtype");
    });
  });

  // ═══════════════════════════════════════════════════
  // 7. getRecordFields()
  // ═══════════════════════════════════════════════════

  describe("getRecordFields", () => {
    it("infers types from sample SuiteQL row values", async () => {
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(
          jsonResponse({
            items: [{
              id: 42,
              name: "Acme Widget",
              amount: 19.99,
              isactive: true,
              datecreated: "2024-01-15 08:30:00",
              count: 100,
              memo: null,
            }],
            hasMore: false,
          })
        )
        .mockResolvedValueOnce(customFieldNotFound());

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "salesOrder");

      const fieldMap = Object.fromEntries(fields.map((f) => [f.name, f]));

      expect(fieldMap.id.type).toBe("INTEGER");
      expect(fieldMap.name.type).toBe("STRING");
      expect(fieldMap.amount.type).toBe("FLOAT");
      expect(fieldMap.isactive.type).toBe("BOOLEAN");
      expect(fieldMap.datecreated.type).toBe("TIMESTAMP");
      expect(fieldMap.count.type).toBe("INTEGER");
      expect(fieldMap.memo.type).toBe("STRING"); // null defaults to STRING
    });

    it("uses field name as label", async () => {
      // "customer" maps to itself → 1 catalog attempt
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(
          jsonResponse({
            items: [{ entityid: "CUST001", companyname: "Acme" }],
            hasMore: false,
          })
        )
        .mockResolvedValueOnce(customFieldNotFound());

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "customer");

      const fieldMap = Object.fromEntries(fields.map((f) => [f.name, f]));

      expect(fieldMap.entityid.label).toBe("entityid");
      expect(fieldMap.companyname.label).toBe("companyname");
    });

    it("returns empty array when record type has no rows", async () => {
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())           // catalog
        .mockResolvedValueOnce(                              // SELECT * (empty)
          jsonResponse({ items: [], hasMore: false })
        )
        // Falls to getFieldsFromSuiteQL which does its own SELECT * + customfield
        .mockResolvedValueOnce(                              // getFieldsFromSuiteQL SELECT *
          jsonResponse({ items: [], hasMore: false })
        )
        .mockResolvedValueOnce(customFieldNotFound());       // customfield

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "nonexistent");

      expect(fields).toEqual([]);
    });

    it("sends SELECT * FROM {recordType} with limit 1 (SuiteQL fallback)", async () => {
      // "customer" maps to itself → 1 catalog attempt
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(
          jsonResponse({ items: [{ id: 1 }], hasMore: false })
        )
        .mockResolvedValueOnce(customFieldNotFound());

      const conn = (await provider.connect(makeConnection())) as any;
      await provider.getRecordFields(conn, "customer");

      // Call 0 = metadata-catalog GET (404), call 1 = SuiteQL SELECT *
      const [, opts] = mockFetch.mock.calls[1];
      const body = JSON.parse(opts.body);
      expect(body.q).toBe("SELECT * FROM customer FETCH FIRST 1 ROWS ONLY");
      expect(opts.headers.Prefer).toContain("max-page-size=1");
    });

    it("detects date strings with slash format as TIMESTAMP", async () => {
      // "transaction" maps to "salesOrder" → 2 catalog attempts (salesOrder, transaction)
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(
          jsonResponse({
            items: [{ lastmodified: "3/15/2024 12:00:00 AM" }],
            hasMore: false,
          })
        )
        .mockResolvedValueOnce(customFieldNotFound());

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "transaction");

      expect(fields[0].type).toBe("TIMESTAMP");
    });

    it("sets all fields as non-mandatory (SuiteQL fallback)", async () => {
      // "customer" maps to itself → 1 catalog attempt
      mockFetch
        .mockResolvedValueOnce(catalogNotFound())
        .mockResolvedValueOnce(
          jsonResponse({
            items: [{ id: 1, name: "Test" }],
            hasMore: false,
          })
        )
        .mockResolvedValueOnce(customFieldNotFound());

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "customer");

      expect(fields.every((f) => f.mandatory === false)).toBe(true);
    });

    it("uses metadata-catalog when available (standard + custom fields)", async () => {
      // Mock 1: Catalog response for inventoryItem
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          type: "object",
          properties: {
            autoLeadTime: {
              title: "Auto-Calculate Lead Time",
              type: "boolean",
              nullable: true,
            },
            averageCost: {
              title: "Average Cost",
              type: "number",
              format: "float",
              nullable: true,
            },
            lastModifiedDate: {
              title: "Last Modified Date",
              type: "string",
              format: "date-time",
              nullable: false,
            },
            custitem_lowvolt: {
              title: "Low Voltage",
              type: "boolean",
              nullable: true,
              "x-ns-custom-field": true,
            },
            custitem_ava_taxcode: {
              title: "AvaTax Taxcode",
              type: "string",
              nullable: true,
              "x-ns-custom-field": true,
            },
            // Subtype-specific field — should be INCLUDED even though SELECT *
            // on an unfiltered item table may not return it (needs itemtype filter)
            salesDescription: {
              title: "Sales Description",
              type: "string",
              nullable: true,
            },
            // Reference field — should be INCLUDED as INTEGER
            costCategory: {
              title: "Cost Category",
              type: "object",
              nullable: true,
              properties: { id: {}, refName: {}, externalId: {}, links: {} },
            },
            // Custom reference field — should be INCLUDED
            custitem_category: {
              title: "Category",
              type: "object",
              nullable: true,
              "x-ns-custom-field": true,
              properties: { id: {}, refName: {}, externalId: {}, links: {} },
            },
            // Sub-record — should be SKIPPED (has totalResults, no id)
            itemVendor: {
              title: "Item Vendor",
              type: "object",
              nullable: true,
              properties: { links: {}, totalResults: {}, count: {}, hasMore: {}, offset: {} },
            },
            // Array — should be SKIPPED
            links: {
              title: "Links",
              type: "array",
            },
          },
        })
      );

      // Mock 2: SuiteQL SELECT * — supplements catalog with extra columns.
      // salesdescription absent here (subtype-specific, needs itemtype filter)
      // but should still appear in results because catalog is trusted.
      // extrafield is a column only SELECT * knows about (not in catalog).
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [{
            autoleadtime: "T",
            averagecost: 12.5,
            costcategory: 3,
            lastmodifieddate: "3/8/2026",
            custitem_ava_taxcode: "TAX01",
            custitem_category: 7,
            custitem_lowvolt: "F",
            extrafield: "bonus",
            links: [],
          }],
          hasMore: false,
        })
      );

      // Mock 3: customfield query — no extra custom fields
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const fields = await provider.getRecordFields(conn, "item");

      // Catalog fields trusted + SELECT *-only fields supplemented.
      // Sorted: standard alpha, then custom alpha.
      const names = fields.map((f) => f.name);
      expect(names).toEqual([
        "autoleadtime",
        "averagecost",
        "costcategory",
        "extrafield",       // from SELECT * only (not in catalog)
        "lastmodifieddate",
        "salesdescription",  // from catalog — kept (null-valued fields omitted from SELECT *)
        "custitem_ava_taxcode",
        "custitem_category",
        "custitem_lowvolt",
      ]);

      const fieldMap = Object.fromEntries(fields.map((f) => [f.name, f]));

      // Type mapping — catalog provides rich types
      expect(fieldMap.autoleadtime.type).toBe("BOOLEAN");
      expect(fieldMap.averagecost.type).toBe("FLOAT");
      expect(fieldMap.lastmodifieddate.type).toBe("TIMESTAMP");
      expect(fieldMap.salesdescription.type).toBe("STRING");
      expect(fieldMap.custitem_lowvolt.type).toBe("BOOLEAN");
      expect(fieldMap.custitem_ava_taxcode.type).toBe("STRING");
      expect(fieldMap.costcategory.type).toBe("INTEGER");
      expect(fieldMap.custitem_category.type).toBe("INTEGER");
      // SELECT *-only field gets type inferred from value
      expect(fieldMap.extrafield.type).toBe("STRING");

      // isCustom flag
      expect(fieldMap.autoleadtime.isCustom).toBe(false);
      expect(fieldMap.averagecost.isCustom).toBe(false);
      expect(fieldMap.costcategory.isCustom).toBe(false);
      expect(fieldMap.salesdescription.isCustom).toBe(false);
      expect(fieldMap.extrafield.isCustom).toBe(false);
      expect(fieldMap.custitem_lowvolt.isCustom).toBe(true);
      expect(fieldMap.custitem_ava_taxcode.isCustom).toBe(true);
      expect(fieldMap.custitem_category.isCustom).toBe(true);

      // Labels preserved from catalog titles (not lowercased)
      expect(fieldMap.autoleadtime.label).toBe("Auto-Calculate Lead Time");
      expect(fieldMap.salesdescription.label).toBe("Sales Description");
      expect(fieldMap.custitem_lowvolt.label).toBe("Low Voltage");
      expect(fieldMap.costcategory.label).toBe("Cost Category");
      expect(fieldMap.custitem_category.label).toBe("Category");
      // SELECT *-only field uses column name as label
      expect(fieldMap.extrafield.label).toBe("extrafield");

      // Mandatory from nullable
      expect(fieldMap.lastmodifieddate.mandatory).toBe(true);
      expect(fieldMap.autoleadtime.mandatory).toBe(false);
      expect(fieldMap.salesdescription.mandatory).toBe(false);

      // isReference flag — only object types with id property
      expect(fieldMap.costcategory.isReference).toBe(true);
      expect(fieldMap.custitem_category.isReference).toBe(true);
      expect(fieldMap.autoleadtime.isReference).toBe(false);
      expect(fieldMap.averagecost.isReference).toBe(false);
      expect(fieldMap.salesdescription.isReference).toBe(false);
      expect(fieldMap.lastmodifieddate.isReference).toBe(false);

      // Excluded: links (array), itemVendor (sub-record with totalResults)
      expect(names).not.toContain("links");
      expect(names).not.toContain("itemvendor");
    });
  });

  // ═══════════════════════════════════════════════════
  // 8. listSavedSearches()
  // ═══════════════════════════════════════════════════

  describe("listSavedSearches", () => {
    it("executes correct SuiteQL query for public saved searches", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: "customsearch_inv", title: "Inventory Report", recordtype: "item" },
            { id: "customsearch_so", title: "Sales Orders", recordtype: "salesorder" },
          ],
          hasMore: false,
        })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const searches = await provider.listSavedSearches(conn);

      // Verify the SuiteQL query
      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.q).toBe(
        "SELECT id, title, recordtype FROM savedsearch WHERE ispublic = 'T' ORDER BY title ASC"
      );

      expect(searches).toEqual([
        { id: "customsearch_inv", title: "Inventory Report", recordType: "item" },
        { id: "customsearch_so", title: "Sales Orders", recordType: "salesorder" },
      ]);
    });

    it("handles null title and recordtype", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "123", title: null, recordtype: null }],
          hasMore: false,
        })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const searches = await provider.listSavedSearches(conn);

      expect(searches).toEqual([
        { id: "123", title: "", recordType: "" },
      ]);
    });

    it("returns empty array when no saved searches found", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const conn = (await provider.connect(makeConnection())) as any;
      const searches = await provider.listSavedSearches(conn);

      expect(searches).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════
  // 9. testConnection()
  // ═══════════════════════════════════════════════════

  describe("testConnection", () => {
    it("returns true when query succeeds", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: "1", name: "Parent Company" }],
          hasMore: false,
        })
      );

      const result = await provider.testConnection(makeConnection());
      expect(result).toBe(true);
    });

    it("returns false on error", async () => {
      // INVALID_LOGIN skips retries
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [{ code: "INVALID_LOGIN", detail: "Bad creds" }],
        },
        401
      );
      errorResponse.ok = false;
      mockFetch.mockResolvedValueOnce(errorResponse);

      const result = await provider.testConnection(makeConnection());
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════
  // 10. testConnectionExtended()
  // ═══════════════════════════════════════════════════

  describe("testConnectionExtended", () => {
    it("returns success with account ID in message", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          items: [{ ts: "2026-03-06T12:00:00Z" }],
          hasMore: false,
        })
      );

      const result = await provider.testConnectionExtended(makeConnection());

      expect(result.success).toBe(true);
      expect(result.message).toContain("1234567_SB1");
    });

    it("returns success even when query returns no rows", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [], hasMore: false })
      );

      const result = await provider.testConnectionExtended(makeConnection());

      expect(result.success).toBe(true);
      expect(result.message).toContain("1234567_SB1");
    });

    it("returns failure on error", async () => {
      // INVALID_LOGIN skips retries
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [{ code: "INVALID_LOGIN", detail: "Bad credentials" }],
        },
        401
      );
      errorResponse.ok = false;
      mockFetch.mockResolvedValueOnce(errorResponse);

      const result = await provider.testConnectionExtended(makeConnection());

      expect(result.success).toBe(false);
      expect(result.message).toContain("INVALID_LOGIN");
    });

    it("queries CURRENT_TIMESTAMP with limit 1", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ items: [{ ts: "2026-03-06T12:00:00Z" }], hasMore: false })
      );

      await provider.testConnectionExtended(makeConnection());

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.q).toBe("SELECT CURRENT_TIMESTAMP AS ts");
      expect(opts.headers.Prefer).toContain("max-page-size=1");
    });
  });

  // ═══════════════════════════════════════════════════
  // 11. Error handling
  // ═══════════════════════════════════════════════════

  describe("error handling", () => {
    async function connectDefault() {
      return provider.connect(makeConnection()) as Promise<any>;
    }

    // Speed up retries for tests
    beforeEach(() => {
      mockFetch.mockReset(); // Clear any leftover mocks from previous tests
      vi.spyOn(global, "setTimeout").mockImplementation((fn: any) => {
        if (typeof fn === "function") fn();
        return 0 as any;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("retries on 429 rate limiting and respects Retry-After header", async () => {
      const rateLimitResponse = jsonResponse(
        { message: "Rate limited" },
        429,
        { "Retry-After": "2" }
      );
      rateLimitResponse.ok = false;

      const successResponse = jsonResponse({
        items: [{ id: 1 }],
        hasMore: false,
      });

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      const conn = await connectDefault();
      const result = await provider.executeSuiteQL(conn, "SELECT 1", 10, 0);

      expect(result.items).toEqual([{ id: 1 }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("uses backoff delay when Retry-After header is missing on 429", async () => {
      const rateLimitResponse = jsonResponse({ message: "Rate limited" }, 429);
      rateLimitResponse.ok = false;

      const successResponse = jsonResponse({
        items: [],
        hasMore: false,
      });

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      const conn = await connectDefault();
      await provider.executeSuiteQL(conn, "SELECT 1", 10, 0);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("fails after MAX_RETRIES rate limit responses", async () => {
      const rateLimitResponse = jsonResponse({ message: "Rate limited" }, 429);
      rateLimitResponse.ok = false;

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(rateLimitResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT 1", 10, 0)
      ).rejects.toThrow("NetSuite request failed after retries");
    });

    it("parses NetSuite o:errorDetails format", async () => {
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [
            { code: "INVALID_QUERY", detail: "Field 'xyz' does not exist" },
          ],
        },
        400
      );
      errorResponse.ok = false;

      mockFetch.mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT xyz FROM item", 10, 0)
      ).rejects.toThrow("INVALID_QUERY");
    });

    it("parses SuiteQL title/detail error format", async () => {
      // 400 errors are non-retryable (4xx tagged), so only 1 mock needed
      const errorResponse = jsonResponse(
        { title: "Invalid Search", detail: "The search query is malformed" },
        400
      );
      errorResponse.ok = false;
      mockFetch.mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "BAD QUERY", 10, 0)
      ).rejects.toThrow("Invalid Search");
    });

    it("handles unparseable error body", async () => {
      const errorResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Internal Server Error"),
        headers: { get: vi.fn(() => null) },
      };

      // Need 3 failures for all retries to exhaust
      mockFetch
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT 1", 10, 0)
      ).rejects.toThrow("HTTP 500");
    });

    it("does not retry INVALID_LOGIN errors", async () => {
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [
            { code: "INVALID_LOGIN", detail: "Invalid login attempt" },
          ],
        },
        401
      );
      errorResponse.ok = false;

      mockFetch.mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT 1", 10, 0)
      ).rejects.toThrow("INVALID_LOGIN");

      // Should only have been called once — no retries
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry INVALID_QUERY errors", async () => {
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [
            { code: "INVALID_QUERY", detail: "Bad SQL" },
          ],
        },
        400
      );
      errorResponse.ok = false;

      mockFetch.mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "INVALID SQL", 10, 0)
      ).rejects.toThrow("INVALID_QUERY");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry INSUFFICIENT_PERMISSION errors", async () => {
      const errorResponse = jsonResponse(
        {
          "o:errorDetails": [
            { code: "INSUFFICIENT_PERMISSION", detail: "No access" },
          ],
        },
        403
      );
      errorResponse.ok = false;

      mockFetch.mockResolvedValueOnce(errorResponse);

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT 1", 10, 0)
      ).rejects.toThrow("INSUFFICIENT_PERMISSION");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on network errors", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(
          jsonResponse({ items: [{ id: 1 }], hasMore: false })
        );

      const conn = await connectDefault();
      const result = await provider.executeSuiteQL(conn, "SELECT 1", 10, 0);

      expect(result.items).toEqual([{ id: 1 }]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting all retries on network errors", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"));

      const conn = await connectDefault();
      await expect(
        provider.executeSuiteQL(conn, "SELECT 1", 10, 0)
      ).rejects.toThrow("ECONNRESET");
    });
  });

  // ═══════════════════════════════════════════════════
  // 12. buildSuiteQL()
  // ═══════════════════════════════════════════════════

  describe("buildSuiteQL", () => {
    it("generates correct SELECT from structured config", () => {
      const sql = buildSuiteQL({
        recordType: "transaction",
        fields: ["id", "trandate", "entity", "amount"],
      });

      expect(sql).toBe(
        "SELECT id, trandate, entity, amount FROM transaction ORDER BY id ASC"
      );
    });

    it("uses * when fields array is empty (no ORDER BY without explicit id)", () => {
      const sql = buildSuiteQL({
        recordType: "customer",
        fields: [],
      });

      expect(sql).toBe("SELECT * FROM customer");
    });

    it("includes WHERE clause from filter", () => {
      const sql = buildSuiteQL({
        recordType: "item",
        fields: ["id", "itemid", "displayname"],
        filter: "isinactive = 'F'",
      });

      expect(sql).toBe(
        "SELECT id, itemid, displayname FROM item WHERE isinactive = 'F' ORDER BY id ASC"
      );
    });

    it("always adds ORDER BY id ASC", () => {
      const sql = buildSuiteQL({
        recordType: "employee",
        fields: ["id", "firstname"],
      });

      expect(sql.endsWith("ORDER BY id ASC")).toBe(true);
    });

    it("handles null filter (no WHERE clause)", () => {
      const sql = buildSuiteQL({
        recordType: "vendor",
        fields: ["id"],
        filter: null,
      });

      expect(sql).toBe("SELECT id FROM vendor ORDER BY id ASC");
      expect(sql).not.toContain("WHERE");
    });

    it("handles undefined filter (no WHERE clause)", () => {
      const sql = buildSuiteQL({
        recordType: "vendor",
        fields: ["id"],
      });

      expect(sql).toBe("SELECT id FROM vendor ORDER BY id ASC");
      expect(sql).not.toContain("WHERE");
    });

    it("handles empty string filter (treated as falsy, no WHERE clause)", () => {
      const sql = buildSuiteQL({
        recordType: "vendor",
        fields: ["id"],
        filter: "",
      });

      expect(sql).toBe("SELECT id FROM vendor ORDER BY id ASC");
      expect(sql).not.toContain("WHERE");
    });

    it("handles complex filter with AND/OR", () => {
      const sql = buildSuiteQL({
        recordType: "transaction",
        fields: ["id", "amount"],
        filter: "type = 'SalesOrd' AND amount > 1000 OR subsidiary = 1",
      });

      expect(sql).toBe(
        "SELECT id, amount FROM transaction WHERE type = 'SalesOrd' AND amount > 1000 OR subsidiary = 1 ORDER BY id ASC"
      );
    });

    it("handles single field", () => {
      const sql = buildSuiteQL({
        recordType: "item",
        fields: ["id"],
      });

      expect(sql).toBe("SELECT id FROM item ORDER BY id ASC");
    });

    it("allows dot-notation sublist fields", () => {
      const sql = buildSuiteQL({
        recordType: "transaction",
        fields: ["id", "item.internalId", "item.quantity"],
      });

      expect(sql).toBe(
        "SELECT id, item.internalId, item.quantity FROM transaction ORDER BY id ASC"
      );
    });

    it("rejects field names with SQL injection", () => {
      expect(() =>
        buildSuiteQL({
          recordType: "item",
          fields: ["id; DROP TABLE item--"],
        })
      ).toThrow('Invalid field name');
    });

    it("rejects field names with quotes", () => {
      expect(() =>
        buildSuiteQL({
          recordType: "item",
          fields: ["id", "name' OR '1'='1"],
        })
      ).toThrow('Invalid field name');
    });

    it("rejects field names with spaces", () => {
      expect(() =>
        buildSuiteQL({
          recordType: "item",
          fields: ["id", "name FROM item; --"],
        })
      ).toThrow('Invalid field name');
    });
  });
});
