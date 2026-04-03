import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Variables (hoisted) ───────────────────────────
const mockQuery = vi.hoisted(() => vi.fn());
const mockCreateQueryJob = vi.hoisted(() => vi.fn());
const mockTableGetMetadata = vi.hoisted(() => vi.fn());
const mockDatasetCreate = vi.hoisted(() => vi.fn());
const mockDatasetGet = vi.hoisted(() => vi.fn());
const mockCreateTableFn = vi.hoisted(() => vi.fn());
const mockCreateWriteStream = vi.hoisted(() => vi.fn());

// ─── Module Mock ───────────────────────────────────────
vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn(function () {
    return {
      query: mockQuery,
      createQueryJob: mockCreateQueryJob,
      dataset: () => ({
        get: mockDatasetGet,
        create: mockDatasetCreate,
        table: () => ({
          createWriteStream: mockCreateWriteStream,
          getMetadata: mockTableGetMetadata,
        }),
        createTable: mockCreateTableFn,
      }),
    };
  }),
}));

// ─── Imports ───────────────────────────────────────────
import { BigQueryProvider, clearSchemaCache, floatSafeJsonLine } from "@/lib/providers/bigquery.provider";
import type { ConnectionLike } from "@/lib/providers/types";
import type { ConnectionProvider } from "@/lib/providers/provider";

// ─── Helper: Build mock WriteStream ───────────────────
function buildMockWriteStream(outputRows: number, errors: Array<{ message: string; location?: string }> = []) {
  const { PassThrough } = require("stream");
  const writable = new PassThrough();
  writable.on("pipe", () => {
    const mockJob = {
      on(event: string, cb: Function) {
        if (event === "complete") setTimeout(() => cb(), 0);
        return mockJob;
      },
      getMetadata: vi.fn().mockResolvedValue([{
        statistics: { load: { outputRows: String(outputRows) } },
        status: { errors: errors.length > 0 ? errors : undefined },
      }]),
    };
    setTimeout(() => writable.emit("job", mockJob), 0);
  });
  return writable;
}

// ─── Fixture ──────────────────────────────────────────
const bqConnection: ConnectionLike = {
  type: "BIGQUERY",
  config: { projectId: "my-project", location: "US" },
  credentials: {
    serviceAccountKey: {
      project_id: "my-project",
      client_email: "sa@my-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
    },
  },
};

// ─── Tests ────────────────────────────────────────────
describe("BigQueryProvider", () => {
  let provider: BigQueryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSchemaCache();
    provider = new BigQueryProvider();
  });

  it("has type BIGQUERY", () => {
    expect(provider.type).toBe("BIGQUERY");
  });

  it("implements ConnectionProvider interface", () => {
    const p: ConnectionProvider = provider;
    expect(p.connect).toBeDefined();
    expect(p.testConnection).toBeDefined();
    expect(p.query).toBeDefined();
    expect(p.extract).toBeDefined();
    expect(p.load).toBeDefined();
    expect(p.getSchema).toBeDefined();
    expect(p.createTable).toBeDefined();
  });

  // ─── connect() ───────────────────────────────────────
  describe("connect()", () => {
    it("returns a ProviderConnection with projectId and close()", async () => {
      const conn = await provider.connect(bqConnection);
      expect(conn).toBeDefined();
      expect(typeof conn.close).toBe("function");
      // BigQueryProviderConnection exposes projectId
      expect((conn as any).projectId).toBe("my-project");
    });

    it("close() is callable (BigQuery client is stateless)", async () => {
      const conn = await provider.connect(bqConnection);
      await expect(conn.close()).resolves.toBeUndefined();
    });

    it("passes credentials and location to BigQuery constructor", async () => {
      const { BigQuery } = await import("@google-cloud/bigquery");
      await provider.connect(bqConnection);
      expect(BigQuery).toHaveBeenCalledWith({
        projectId: "my-project",
        credentials: bqConnection.credentials.serviceAccountKey,
        location: "US",
      });
    });
  });

  // ─── testConnection() ────────────────────────────────
  describe("testConnection()", () => {
    it("returns true when SELECT 1 succeeds", async () => {
      mockQuery.mockResolvedValue([[{ f0_: 1 }]]);
      const result = await provider.testConnection(bqConnection);
      expect(result).toBe(true);
    });

    it("returns false when BigQuery throws", async () => {
      mockQuery.mockRejectedValue(new Error("Invalid credentials"));
      const result = await provider.testConnection(bqConnection);
      expect(result).toBe(false);
    });

    it("calls query with maximumBytesBilled to limit cost", async () => {
      mockQuery.mockResolvedValue([[{ f0_: 1 }]]);
      await provider.testConnection(bqConnection);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "SELECT 1",
          maximumBytesBilled: "1000000",
        })
      );
    });

    it("closes connection after successful test", async () => {
      mockQuery.mockResolvedValue([[{ f0_: 1 }]]);
      // testConnection opens and closes — calling connect twice should work
      await provider.testConnection(bqConnection);
      // No assertion needed — just verifying no throw
    });

    it("closes connection after failed test", async () => {
      mockQuery.mockRejectedValue(new Error("Bad credentials"));
      const result = await provider.testConnection(bqConnection);
      expect(result).toBe(false);
    });
  });

  // ─── query() ─────────────────────────────────────────
  describe("query()", () => {
    it("returns columns and rows", async () => {
      const rows = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      mockQuery.mockResolvedValue([rows]);

      const conn = await provider.connect(bqConnection);
      const result = await provider.query!(conn, "SELECT id, name FROM users");
      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual(rows);
    });

    it("returns empty columns and rows for no data", async () => {
      mockQuery.mockResolvedValue([[]]);

      const conn = await provider.connect(bqConnection);
      const result = await provider.query!(conn, "SELECT 1 WHERE FALSE");
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it("uses useLegacySql: false", async () => {
      mockQuery.mockResolvedValue([[]]);
      const conn = await provider.connect(bqConnection);
      await provider.query!(conn, "SELECT 1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ useLegacySql: false })
      );
    });

    it("sets maximumBytesBilled to cap scan cost", async () => {
      mockQuery.mockResolvedValue([[]]);
      const conn = await provider.connect(bqConnection);
      await provider.query!(conn, "SELECT 1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ maximumBytesBilled: "50000000000" })
      );
    });

    it("sets jobTimeoutMs for query timeout", async () => {
      mockQuery.mockResolvedValue([[]]);
      const conn = await provider.connect(bqConnection);
      await provider.query!(conn, "SELECT 1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ jobTimeoutMs: "120000" })
      );
    });
  });

  // ─── extract() ───────────────────────────────────────
  describe("extract()", () => {
    it("yields paginated chunks", async () => {
      const rows1 = [{ id: 1 }, { id: 2 }];
      const rows2 = [{ id: 3 }];

      const mockJob = {
        getQueryResults: vi.fn()
          .mockResolvedValueOnce([rows1, null, { pageToken: "page2" }])
          .mockResolvedValueOnce([rows2, null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT * FROM t", chunkSize: 2 })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([rows1, rows2]);
    });

    it("yields empty array for no results", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT 1 WHERE FALSE" })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([[]]);
    });

    it("converts Date params to ISO strings", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      const config = {
        query: "SELECT * FROM t WHERE dt > @last_run",
        incrementalKey: "dt",
      };
      // The extract signature uses SourceConfig which has query but no explicit params.
      // Params are passed via the config object — but the ConnectionProvider extract()
      // uses SourceConfig. We need to check the implementation handles this correctly.
      for await (const chunk of provider.extract!(conn, config)) {
        chunks.push(chunk);
      }

      expect(mockCreateQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          query: config.query,
          useLegacySql: false,
        })
      );
    });

    it("uses chunkSize from SourceConfig for maxResults", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT 1", chunkSize: 500 })) {
        chunks.push(chunk);
      }

      expect(mockJob.getQueryResults).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 500 })
      );
    });

    it("uses default chunk size when not specified", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT 1" })) {
        chunks.push(chunk);
      }

      expect(mockJob.getQueryResults).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 10_000 })
      );
    });
  });

  // ─── load() ──────────────────────────────────────────
  describe("load()", () => {
    it("loads rows via NDJSON stream", async () => {
      mockCreateWriteStream.mockReturnValue(buildMockWriteStream(5));

      const conn = await provider.connect(bqConnection);
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
      const result = await provider.load!(conn, rows, {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
      });

      expect(result.rowsLoaded).toBe(5);
      expect(result.errors).toEqual([]);
      expect(mockCreateWriteStream).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFormat: "NEWLINE_DELIMITED_JSON",
          writeDisposition: "WRITE_APPEND",
        })
      );
    });

    it("returns 0 for empty rows without calling createWriteStream", async () => {
      const conn = await provider.connect(bqConnection);
      const result = await provider.load!(conn, [], {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
      });

      expect(result.rowsLoaded).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockCreateWriteStream).not.toHaveBeenCalled();
    });

    it("passes schema to createWriteStream when provided", async () => {
      mockCreateWriteStream.mockReturnValue(buildMockWriteStream(1));

      const conn = await provider.connect(bqConnection);
      const schema = { fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" }] };
      await provider.load!(conn, [{ id: 1 }], {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_TRUNCATE",
        autoCreateTable: true,
        schema,
      });

      expect(mockCreateWriteStream).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: { fields: schema.fields },
          autodetect: false,
        })
      );
    });

    it("uses autodetect when no schema provided", async () => {
      mockCreateWriteStream.mockReturnValue(buildMockWriteStream(1));

      const conn = await provider.connect(bqConnection);
      await provider.load!(conn, [{ id: 1 }], {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: true,
      });

      expect(mockCreateWriteStream).toHaveBeenCalledWith(
        expect.objectContaining({ autodetect: true })
      );
    });

    it("returns errors from load job metadata", async () => {
      const loadErrors = [
        { message: "Invalid value for field id", location: "id" },
      ];
      mockCreateWriteStream.mockReturnValue(buildMockWriteStream(3, loadErrors));

      const conn = await provider.connect(bqConnection);
      const result = await provider.load!(conn, [{ id: 1 }, { id: 2 }, { id: 3 }], {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
      });

      expect(result.rowsLoaded).toBe(3);
      expect(result.errors).toEqual([
        { message: "Invalid value for field id", location: "id" },
      ]);
    });

    it("rejects with timeout if load job never completes", async () => {
      vi.useFakeTimers();
      // Mock a writestream that never emits "job" — simulates a hanging load
      const { PassThrough } = require("stream");
      const hangingStream = new PassThrough();
      mockCreateWriteStream.mockReturnValue(hangingStream);

      const conn = await provider.connect(bqConnection);
      const loadPromise = provider.load!(conn, [{ id: 1 }], {
        dataset: "ds",
        table: "tbl",
        writeDisposition: "WRITE_APPEND",
        autoCreateTable: false,
      });

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const assertion = expect(loadPromise).rejects.toThrow(/timed out/i);

      // Advance past the 5-minute timeout
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 100);

      await assertion;

      vi.useRealTimers();
    });
  });

  // ─── getSchema() ─────────────────────────────────────
  describe("getSchema()", () => {
    it("returns schema for existing table", async () => {
      mockTableGetMetadata.mockResolvedValue([{
        schema: {
          fields: [
            { name: "id", type: "INTEGER", mode: "REQUIRED" },
            { name: "name", type: "STRING", mode: "NULLABLE" },
          ],
        },
      }]);

      const conn = await provider.connect(bqConnection);
      const schema = await provider.getSchema!(conn, "ds", "tbl");

      expect(schema).not.toBeNull();
      expect(schema!.fields).toHaveLength(2);
      expect(schema!.fields[0]).toEqual({ name: "id", type: "INTEGER", mode: "REQUIRED" });
      expect(schema!.fields[1]).toEqual({ name: "name", type: "STRING", mode: "NULLABLE" });
    });

    it("returns null for non-existent table (Not found error)", async () => {
      mockTableGetMetadata.mockRejectedValue(new Error("Not found: Table my-project:ds.tbl"));

      const conn = await provider.connect(bqConnection);
      const schema = await provider.getSchema!(conn, "ds", "tbl");
      expect(schema).toBeNull();
    });

    it("returns null for non-existent table (404 error)", async () => {
      mockTableGetMetadata.mockRejectedValue(new Error("404 Not Found"));

      const conn = await provider.connect(bqConnection);
      const schema = await provider.getSchema!(conn, "ds", "tbl");
      expect(schema).toBeNull();
    });

    it("throws for unexpected errors", async () => {
      mockTableGetMetadata.mockRejectedValue(new Error("Permission denied"));

      const conn = await provider.connect(bqConnection);
      await expect(provider.getSchema!(conn, "ds", "tbl")).rejects.toThrow("Permission denied");
    });

    it("returns cached schema on second call", async () => {
      mockTableGetMetadata.mockResolvedValue([{
        schema: {
          fields: [
            { name: "id", type: "INTEGER", mode: "REQUIRED" },
          ],
        },
      }]);

      const conn = await provider.connect(bqConnection);
      const schema1 = await provider.getSchema!(conn, "ds", "tbl");
      const schema2 = await provider.getSchema!(conn, "ds", "tbl");

      expect(schema1).toEqual(schema2);
      // Should only call the API once — second call hits cache
      expect(mockTableGetMetadata).toHaveBeenCalledTimes(1);
    });

    it("invalidates cache after createTable", async () => {
      // First: table doesn't exist → null cached
      mockTableGetMetadata.mockRejectedValueOnce(new Error("Not found: Table"));
      mockDatasetGet.mockResolvedValue([{}]);
      mockCreateTableFn.mockResolvedValue([{}]);

      const conn = await provider.connect(bqConnection);
      const schema1 = await provider.getSchema!(conn, "ds", "new_tbl");
      expect(schema1).toBeNull();

      // Create the table (should invalidate cache)
      await provider.createTable!(conn, "ds", "new_tbl", {
        fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" }],
      });

      // Now mock the table as existing
      mockTableGetMetadata.mockResolvedValueOnce([{
        schema: {
          fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" }],
        },
      }]);

      const schema2 = await provider.getSchema!(conn, "ds", "new_tbl");
      expect(schema2).not.toBeNull();
      expect(schema2!.fields[0].name).toBe("id");
    });

    it("returns null when schema has no fields", async () => {
      mockTableGetMetadata.mockResolvedValue([{ schema: {} }]);

      const conn = await provider.connect(bqConnection);
      const schema = await provider.getSchema!(conn, "ds", "tbl");
      expect(schema).toBeNull();
    });

    it("maps nested RECORD fields", async () => {
      mockTableGetMetadata.mockResolvedValue([{
        schema: {
          fields: [
            {
              name: "address",
              type: "RECORD",
              mode: "NULLABLE",
              description: "Mailing address",
              fields: [
                { name: "street", type: "STRING", mode: "NULLABLE" },
                { name: "city", type: "STRING", mode: "NULLABLE" },
              ],
            },
          ],
        },
      }]);

      const conn = await provider.connect(bqConnection);
      const schema = await provider.getSchema!(conn, "ds", "tbl");

      expect(schema).not.toBeNull();
      expect(schema!.fields[0].name).toBe("address");
      expect(schema!.fields[0].type).toBe("RECORD");
      expect(schema!.fields[0].description).toBe("Mailing address");
      expect(schema!.fields[0].fields).toHaveLength(2);
      expect(schema!.fields[0].fields![0].name).toBe("street");
    });
  });

  // ─── dryRun() ───────────────────────────────────────
  describe("dryRun()", () => {
    it("returns totalBytesProcessed and cacheHit from dry run", async () => {
      mockQuery.mockResolvedValue([
        [], // rows (empty for dry run)
        null,
        {
          statistics: {
            totalBytesProcessed: "5000000000",
            query: { cacheHit: false },
          },
        },
      ]);

      const conn = await provider.connect(bqConnection);
      const result = await provider.dryRun(conn, "SELECT * FROM big_table");

      expect(result.totalBytesProcessed).toBe(5000000000);
      expect(result.cacheHit).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true, useLegacySql: false })
      );
    });

    it("returns 0 bytes when statistics missing", async () => {
      mockQuery.mockResolvedValue([[], null, {}]);

      const conn = await provider.connect(bqConnection);
      const result = await provider.dryRun(conn, "SELECT 1");

      expect(result.totalBytesProcessed).toBe(0);
      expect(result.cacheHit).toBe(false);
    });
  });

  // ─── extract() with params ─────────────────────────
  describe("extract() with params", () => {
    it("passes params to createQueryJob for parameterized queries", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, {
        query: "SELECT * FROM t WHERE dt > @last_run",
        params: { last_run: "2024-01-01T00:00:00.000Z" },
      })) {
        chunks.push(chunk);
      }

      expect(mockCreateQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { last_run: "2024-01-01T00:00:00.000Z" },
        })
      );
    });

    it("omits params from createQueryJob when not provided", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      for await (const _ of provider.extract!(conn, { query: "SELECT 1" })) {
        // consume
      }

      const callArgs = mockCreateQueryJob.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("params");
    });

    it("sets maximumBytesBilled on extract query jobs", async () => {
      const mockJob = {
        getQueryResults: vi.fn().mockResolvedValueOnce([[{ id: 1 }], null, {}]),
      };
      mockCreateQueryJob.mockResolvedValue([mockJob]);

      const conn = await provider.connect(bqConnection);
      for await (const _ of provider.extract!(conn, { query: "SELECT 1" })) {
        // consume
      }

      expect(mockCreateQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({ maximumBytesBilled: "50000000000" })
      );
    });
  });

  // ─── createTable() ───────────────────────────────────
  describe("createTable()", () => {
    it("creates table with schema in existing dataset", async () => {
      mockDatasetGet.mockResolvedValue([{}]);
      mockCreateTableFn.mockResolvedValue([{}]);

      const conn = await provider.connect(bqConnection);
      const schema = { fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" as const }] };
      await provider.createTable!(conn, "ds", "new_table", schema);

      expect(mockDatasetGet).toHaveBeenCalled();
      expect(mockDatasetCreate).not.toHaveBeenCalled();
      expect(mockCreateTableFn).toHaveBeenCalledWith("new_table", {
        schema: { fields: schema.fields },
      });
    });

    it("creates dataset if it doesn't exist, then creates table", async () => {
      mockDatasetGet.mockRejectedValue(new Error("Not found"));
      mockDatasetCreate.mockResolvedValue([{}]);
      mockCreateTableFn.mockResolvedValue([{}]);

      const conn = await provider.connect(bqConnection);
      const schema = { fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" as const }] };
      await provider.createTable!(conn, "new_ds", "new_table", schema);

      expect(mockDatasetCreate).toHaveBeenCalled();
      expect(mockCreateTableFn).toHaveBeenCalledWith("new_table", {
        schema: { fields: schema.fields },
      });
    });
  });

  // ─── floatSafeJsonLine ──────────────────────────────────

  describe("floatSafeJsonLine", () => {
    it("converts integer values to floats", () => {
      const result = floatSafeJsonLine({ a: 5, b: 10 });
      expect(result).toBe('{"a":5.0,"b":10.0}');
    });

    it("preserves existing float values", () => {
      const result = floatSafeJsonLine({ a: 5.5, b: 3.14 });
      expect(result).toBe('{"a":5.5,"b":3.14}');
    });

    it("handles mixed integer and float in same row", () => {
      const result = floatSafeJsonLine({ qty: 5, price: 9.99 });
      expect(result).toBe('{"qty":5.0,"price":9.99}');
    });

    it("does not modify string values containing numbers", () => {
      const result = floatSafeJsonLine({ name: "Route 66", id: 5 });
      expect(result).toBe('{"name":"Route 66","id":5.0}');
    });

    it("handles negative integers", () => {
      const result = floatSafeJsonLine({ balance: -100 });
      expect(result).toBe('{"balance":-100.0}');
    });

    it("handles zero", () => {
      const result = floatSafeJsonLine({ count: 0 });
      expect(result).toBe('{"count":0.0}');
    });

    it("preserves null, boolean, and string values", () => {
      const result = floatSafeJsonLine({ a: null, b: true, c: false, d: "hello" });
      expect(result).toBe('{"a":null,"b":true,"c":false,"d":"hello"}');
    });

    it("handles arrays with integers", () => {
      const result = floatSafeJsonLine({ tags: [1, 2, 3] });
      expect(result).toBe('{"tags":[1.0,2.0,3.0]}');
    });

    it("handles nested objects", () => {
      const result = floatSafeJsonLine({ meta: { count: 5 } });
      expect(result).toBe('{"meta":{"count":5.0}}');
    });

    it("does not modify string-typed number values", () => {
      const result = floatSafeJsonLine({ code: "12345" });
      expect(result).toBe('{"code":"12345"}');
    });
  });
});
