import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestApiProvider, buildAuthHeaders } from "@/lib/providers/rest-api.provider";
import type { SourceConfig } from "@/lib/bifrost/types";
import type { SchemaMapping } from "@/lib/alfheim/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from the async generator into a flat array. */
async function collectAll(
  gen: AsyncGenerator<Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for await (const chunk of gen) {
    all.push(...chunk);
  }
  return all;
}

/** Build a SourceConfig with REST params injected. */
function makeConfig(overrides: Partial<SourceConfig> & {
  baseUrl?: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  pagination?: Record<string, unknown>;
  rateLimiting?: Record<string, unknown>;
}): SourceConfig {
  const {
    baseUrl = "https://api.example.com",
    authType = "BEARER",
    authConfig,
    credentials = { bearerToken: "tok_test" },
    pagination = { type: "none" },
    rateLimiting,
    ...rest
  } = overrides;

  return {
    query: "",
    ...rest,
    params: {
      ...rest.params,
      __restConnection: {
        baseUrl,
        authType,
        authConfig,
        credentials,
        pagination,
        rateLimiting,
      },
    },
  };
}

/** Create a mock Response object. */
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Error ${status}`,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAuthHeaders", () => {
  it("builds Bearer auth header", () => {
    const headers = buildAuthHeaders("BEARER", undefined, { bearerToken: "abc123" });
    expect(headers["Authorization"]).toBe("Bearer abc123");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("falls back to apiKey for Bearer when bearerToken is absent", () => {
    const headers = buildAuthHeaders("BEARER", undefined, { apiKey: "key_xyz" });
    expect(headers["Authorization"]).toBe("Bearer key_xyz");
  });

  it("builds API_KEY auth header with default name", () => {
    const headers = buildAuthHeaders("API_KEY", undefined, { apiKey: "my-key" });
    expect(headers["X-API-Key"]).toBe("my-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("builds API_KEY auth header with custom header name", () => {
    const headers = buildAuthHeaders(
      "API_KEY",
      { headerName: "X-Custom-Auth" },
      { apiKey: "my-key" },
    );
    expect(headers["X-Custom-Auth"]).toBe("my-key");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("builds Basic auth header", () => {
    const headers = buildAuthHeaders("BASIC", undefined, {
      username: "admin",
      password: "secret",
    });
    const expected = Buffer.from("admin:secret").toString("base64");
    expect(headers["Authorization"]).toBe(`Basic ${expected}`);
  });

  it("returns only Accept header for unknown auth type", () => {
    const headers = buildAuthHeaders("UNKNOWN", undefined, {});
    expect(headers["Accept"]).toBe("application/json");
    expect(Object.keys(headers)).toHaveLength(1);
  });
});

describe("RestApiProvider.extract()", () => {
  const provider = new RestApiProvider();
  const conn = { close: async () => {} };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Single request (no pagination) ─────────────────

  it("extracts data from a single request with responseRoot", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ data: { items: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] } }),
    );

    const config = makeConfig({
      endpoint: "/users",
      responseRoot: "data.items",
    });

    const rows = await collectAll(provider.extract(conn, config));

    expect(rows).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/users");
  });

  it("extracts data when response is a top-level array (no responseRoot)", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse([{ id: 1 }, { id: 2 }]),
    );

    const config = makeConfig({ responseRoot: "" });
    const rows = await collectAll(provider.extract(conn, config));
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  // ─── Page number pagination ─────────────────────────

  it("paginates with page_number strategy across 3 pages", async () => {
    const page1 = [{ id: 1 }, { id: 2 }];
    const page2 = [{ id: 3 }, { id: 4 }];
    const page3 = [{ id: 5 }]; // partial page = last

    fetchMock
      .mockResolvedValueOnce(mockResponse({ results: page1 }))
      .mockResolvedValueOnce(mockResponse({ results: page2 }))
      .mockResolvedValueOnce(mockResponse({ results: page3 }));

    const config = makeConfig({
      responseRoot: "results",
      pagination: { type: "page_number", pageParam: "page", limitParam: "per_page", defaultLimit: 2 },
    });

    const rows = await collectAll(provider.extract(conn, config));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify page params
    const url1 = new URL(fetchMock.mock.calls[0][0]);
    expect(url1.searchParams.get("page")).toBe("1");
    expect(url1.searchParams.get("per_page")).toBe("2");

    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.get("page")).toBe("2");

    const url3 = new URL(fetchMock.mock.calls[2][0]);
    expect(url3.searchParams.get("page")).toBe("3");
  });

  it("stops page_number pagination on empty response", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ results: [{ id: 1 }] }))
      .mockResolvedValueOnce(mockResponse({ results: [] }));

    const config = makeConfig({
      responseRoot: "results",
      // defaultLimit=1 so the first page (1 record) is "full" and triggers page 2
      pagination: { type: "page_number", defaultLimit: 1 },
    });

    const rows = await collectAll(provider.extract(conn, config));
    expect(rows).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── Cursor pagination ──────────────────────────────

  it("paginates with cursor strategy", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: 1 }], meta: { next_cursor: "cur_abc" } }),
      )
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: 2 }], meta: { next_cursor: "cur_def" } }),
      )
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: 3 }], meta: { next_cursor: null } }),
      );

    const config = makeConfig({
      responseRoot: "data",
      pagination: {
        type: "cursor",
        cursorPath: "meta.next_cursor",
        pageParam: "cursor",
      },
    });

    const rows = await collectAll(provider.extract(conn, config));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // First call should not have cursor param
    const url1 = new URL(fetchMock.mock.calls[0][0]);
    expect(url1.searchParams.has("cursor")).toBe(false);

    // Second call should have cursor param
    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.get("cursor")).toBe("cur_abc");
  });

  // ─── Offset pagination ─────────────────────────────

  it("paginates with offset strategy", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ items: [{ id: 1 }, { id: 2 }] }))
      .mockResolvedValueOnce(mockResponse({ items: [{ id: 3 }] })); // partial = last

    const config = makeConfig({
      responseRoot: "items",
      pagination: { type: "offset", defaultLimit: 2 },
    });

    const rows = await collectAll(provider.extract(conn, config));

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url1 = new URL(fetchMock.mock.calls[0][0]);
    expect(url1.searchParams.get("offset")).toBe("0");

    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.get("offset")).toBe("2");
  });

  // ─── Link header pagination ─────────────────────────

  it("paginates with link_header strategy", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse([{ id: 1 }], 200, {
          Link: '<https://api.example.com/users?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(
        mockResponse([{ id: 2 }], 200, {}), // no Link header = done
      );

    const config = makeConfig({
      responseRoot: "",
      pagination: { type: "link_header" },
    });

    const rows = await collectAll(provider.extract(conn, config));
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── Rate limit handling (429) ──────────────────────

  it("retries on 429 with Retry-After header", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(null, 429, { "Retry-After": "1" }),
      )
      .mockResolvedValueOnce(
        mockResponse({ data: [{ id: 1 }] }),
      );

    const config = makeConfig({ responseRoot: "data" });

    const rows = await collectAll(provider.extract(conn, config));
    expect(rows).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── Auth failure (401) ─────────────────────────────

  it("throws immediately on 401", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(null, 401));

    const config = makeConfig({ responseRoot: "data" });

    await expect(collectAll(provider.extract(conn, config))).rejects.toThrow(
      "Authentication failed (401)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── 5xx retry with backoff ─────────────────────────

  it("retries on 500 and succeeds on second attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(null, 500))
      .mockResolvedValueOnce(mockResponse({ items: [{ id: 1 }] }));

    const config = makeConfig({ responseRoot: "items" });

    const rows = await collectAll(provider.extract(conn, config));
    expect(rows).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── Schema flattening ──────────────────────────────

  it("flattens nested JSON using schema mapping", async () => {
    const apiResponse = {
      results: [
        {
          id: 42,
          name: "Widget",
          address: { city: "Portland", state: "OR" },
          active: true,
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(mockResponse(apiResponse));

    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
        { jsonPath: "name", columnName: "name", dataType: "STRING", nullable: false },
        { jsonPath: "address.city", columnName: "address_city", dataType: "STRING", nullable: true },
        { jsonPath: "address.state", columnName: "address_state", dataType: "STRING", nullable: true },
        { jsonPath: "active", columnName: "active", dataType: "BOOLEAN", nullable: false },
      ],
    };

    const config = makeConfig({
      responseRoot: "results",
      schema,
    });

    const rows = await collectAll(provider.extract(conn, config));

    expect(rows).toEqual([
      {
        id: 42,
        name: "Widget",
        address_city: "Portland",
        address_state: "OR",
        active: true,
      },
    ]);
  });

  it("passes records through without schema when none provided", async () => {
    const record = { id: 1, nested: { a: 1 } };
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [record] }));

    const config = makeConfig({ responseRoot: "data" });
    const rows = await collectAll(provider.extract(conn, config));

    // Without schema, nested objects are preserved as-is
    expect(rows).toEqual([record]);
  });

  // ─── Chunking ───────────────────────────────────────

  it("yields records in chunks of configured size", async () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    fetchMock.mockResolvedValueOnce(mockResponse({ data: records }));

    const config = makeConfig({
      responseRoot: "data",
      chunkSize: 2,
    });

    const chunks: Record<string, unknown>[][] = [];
    for await (const chunk of provider.extract(conn, config)) {
      chunks.push(chunk);
    }

    // 5 records with chunkSize=2 → 3 chunks: [2, 2, 1]
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(2);
    expect(chunks[2]).toHaveLength(1);
  });

  // ─── URL construction ───────────────────────────────

  it("joins baseUrl and endpoint correctly", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ items: [] }));

    const config = makeConfig({
      baseUrl: "https://api.example.com/v2/",
      endpoint: "/users",
      responseRoot: "items",
    });

    await collectAll(provider.extract(conn, config));
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v2/users");
  });

  it("uses baseUrl alone when no endpoint", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([]));

    const config = makeConfig({ responseRoot: "" });
    await collectAll(provider.extract(conn, config));
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com");
  });

  // ─── Error cases ────────────────────────────────────

  it("throws when baseUrl is missing", async () => {
    const config = makeConfig({ baseUrl: "" });
    await expect(collectAll(provider.extract(conn, config))).rejects.toThrow(
      "REST extract: no baseUrl",
    );
  });

  it("throws on unsupported pagination type", async () => {
    const config = makeConfig({
      pagination: { type: "graphql_relay" as never },
    });
    await expect(collectAll(provider.extract(conn, config))).rejects.toThrow(
      "Unsupported pagination type",
    );
  });
});
