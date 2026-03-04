import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Variables (hoisted) ───────────────────────────
const mockPgClient = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

const mockMssqlPool = vi.hoisted(() => ({
  request: vi.fn().mockReturnValue({ query: vi.fn() }),
  close: vi.fn(),
}));

const mockMysqlConnection = vi.hoisted(() => ({
  execute: vi.fn(),
  end: vi.fn(),
}));

// ─── Module Mocks ───────────────────────────────────────

vi.mock("pg", () => ({
  default: {
    Client: vi.fn(function (this: typeof mockPgClient) {
      Object.assign(this, mockPgClient);
    }),
  },
}));

vi.mock("mssql", () => ({
  default: {
    connect: vi.fn().mockResolvedValue(mockMssqlPool),
  },
}));

vi.mock("mysql2/promise", () => ({
  createConnection: vi.fn().mockResolvedValue(mockMysqlConnection),
}));

// ─── Imports ────────────────────────────────────────────

import { PostgresProvider } from "@/lib/providers/postgres.provider";
import { MssqlProvider } from "@/lib/providers/mssql.provider";
import { MysqlProvider } from "@/lib/providers/mysql.provider";
import type { ConnectionLike } from "@/lib/providers/types";
import type { ConnectionProvider } from "@/lib/providers/provider";

// ─── Fixtures ───────────────────────────────────────────

const pgConnection: ConnectionLike = {
  type: "POSTGRES",
  config: { host: "localhost", port: 5432, database: "testdb", username: "user", ssl: false },
  credentials: { password: "secret" },
};

const mssqlConnection: ConnectionLike = {
  type: "MSSQL",
  config: { host: "sqlserver.local", port: 1433, database: "testdb", username: "sa", encrypt: false, trustServerCertificate: true },
  credentials: { password: "secret" },
};

const mysqlConnection: ConnectionLike = {
  type: "MYSQL",
  config: { host: "mysql.local", port: 3306, database: "testdb", username: "root" },
  credentials: { password: "secret" },
};

// ─── Tests ──────────────────────────────────────────────

describe("PostgresProvider", () => {
  let provider: PostgresProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new PostgresProvider();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.end.mockResolvedValue(undefined);
  });

  it("has type POSTGRES", () => {
    expect(provider.type).toBe("POSTGRES");
  });

  it("implements ConnectionProvider interface", () => {
    const p: ConnectionProvider = provider;
    expect(p.connect).toBeDefined();
    expect(p.testConnection).toBeDefined();
    expect(p.query).toBeDefined();
    expect(p.extract).toBeDefined();
  });

  describe("connect()", () => {
    it("returns a ProviderConnection with close() method", async () => {
      const conn = await provider.connect(pgConnection);
      expect(conn).toBeDefined();
      expect(typeof conn.close).toBe("function");
      expect(mockPgClient.connect).toHaveBeenCalledOnce();
    });

    it("close() calls client.end()", async () => {
      const conn = await provider.connect(pgConnection);
      await conn.close();
      expect(mockPgClient.end).toHaveBeenCalledOnce();
    });
  });

  describe("query()", () => {
    it("returns columns and rows", async () => {
      mockPgClient.query.mockResolvedValue({
        fields: [{ name: "id" }, { name: "name" }],
        rows: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      });
      const conn = await provider.connect(pgConnection);
      const result = await provider.query!(conn, "SELECT id, name FROM users");
      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
    });

    it("returns empty columns and rows for no data", async () => {
      mockPgClient.query.mockResolvedValue({
        fields: [],
        rows: [],
      });
      const conn = await provider.connect(pgConnection);
      const result = await provider.query!(conn, "SELECT 1 WHERE false");
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });
  });

  describe("testConnection()", () => {
    it("returns true on success", async () => {
      mockPgClient.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
      const result = await provider.testConnection(pgConnection);
      expect(result).toBe(true);
    });

    it("returns false on error", async () => {
      mockPgClient.connect.mockRejectedValue(new Error("Connection refused"));
      const result = await provider.testConnection(pgConnection);
      expect(result).toBe(false);
    });

    it("always closes the connection on success", async () => {
      mockPgClient.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
      await provider.testConnection(pgConnection);
      expect(mockPgClient.end).toHaveBeenCalledOnce();
    });

    it("always closes the connection on error", async () => {
      mockPgClient.connect.mockResolvedValue(undefined);
      mockPgClient.query.mockRejectedValue(new Error("Timeout"));
      await provider.testConnection(pgConnection);
      expect(mockPgClient.end).toHaveBeenCalledOnce();
    });
  });

  describe("extract()", () => {
    it("yields rows from query", async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      mockPgClient.query.mockResolvedValue({
        fields: [{ name: "id" }],
        rows,
      });
      const conn = await provider.connect(pgConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM t" })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(rows);
    });

    it("yields empty array for no results", async () => {
      mockPgClient.query.mockResolvedValue({
        fields: [{ name: "id" }],
        rows: [],
      });
      const conn = await provider.connect(pgConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM empty" })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual([]);
    });
  });
});

describe("MssqlProvider", () => {
  let provider: MssqlProvider;
  const mockRequest = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MssqlProvider();
    mockMssqlPool.request.mockReturnValue(mockRequest);
    mockMssqlPool.close.mockResolvedValue(undefined);
  });

  it("has type MSSQL", () => {
    expect(provider.type).toBe("MSSQL");
  });

  it("implements ConnectionProvider interface", () => {
    const p: ConnectionProvider = provider;
    expect(p.connect).toBeDefined();
    expect(p.testConnection).toBeDefined();
    expect(p.query).toBeDefined();
    expect(p.extract).toBeDefined();
  });

  describe("connect()", () => {
    it("returns a ProviderConnection with close() method", async () => {
      const conn = await provider.connect(mssqlConnection);
      expect(conn).toBeDefined();
      expect(typeof conn.close).toBe("function");
    });

    it("close() calls pool.close()", async () => {
      const conn = await provider.connect(mssqlConnection);
      await conn.close();
      expect(mockMssqlPool.close).toHaveBeenCalledOnce();
    });
  });

  describe("query()", () => {
    it("returns columns and rows (from recordset.columns)", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: Object.assign([{ id: 1, name: "Alice" }], {
          columns: { id: {}, name: {} },
        }),
      });
      const conn = await provider.connect(mssqlConnection);
      const result = await provider.query!(conn, "SELECT id, name FROM users");
      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual([{ id: 1, name: "Alice" }]);
    });

    it("falls back to Object.keys of first row when columns missing", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [{ x: 10, y: 20 }],
      });
      const conn = await provider.connect(mssqlConnection);
      const result = await provider.query!(conn, "SELECT x, y FROM t");
      expect(result.columns).toEqual(["x", "y"]);
      expect(result.rows).toEqual([{ x: 10, y: 20 }]);
    });

    it("returns empty for no data", async () => {
      mockRequest.query.mockResolvedValue({
        recordset: Object.assign([], { columns: {} }),
      });
      const conn = await provider.connect(mssqlConnection);
      const result = await provider.query!(conn, "SELECT 1 WHERE 1=0");
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });
  });

  describe("testConnection()", () => {
    it("returns true on success", async () => {
      mockRequest.query.mockResolvedValue({ recordset: [{ "": 1 }] });
      const result = await provider.testConnection(mssqlConnection);
      expect(result).toBe(true);
    });

    it("returns false on error", async () => {
      const mssql = await import("mssql");
      (mssql.default.connect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Login failed")
      );
      const result = await provider.testConnection(mssqlConnection);
      expect(result).toBe(false);
    });

    it("always closes the pool on success", async () => {
      mockRequest.query.mockResolvedValue({ recordset: [{ "": 1 }] });
      await provider.testConnection(mssqlConnection);
      expect(mockMssqlPool.close).toHaveBeenCalledOnce();
    });
  });

  describe("extract()", () => {
    it("yields rows from query", async () => {
      const expectedRows = [{ id: 1 }, { id: 2 }];
      mockRequest.query.mockResolvedValue({
        recordset: Object.assign([{ id: 1 }, { id: 2 }], { columns: { id: {} } }),
      });
      const conn = await provider.connect(mssqlConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM t" })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(expectedRows);
    });
  });
});

describe("MysqlProvider", () => {
  let provider: MysqlProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MysqlProvider();
    mockMysqlConnection.end.mockResolvedValue(undefined);
  });

  it("has type MYSQL", () => {
    expect(provider.type).toBe("MYSQL");
  });

  it("implements ConnectionProvider interface", () => {
    const p: ConnectionProvider = provider;
    expect(p.connect).toBeDefined();
    expect(p.testConnection).toBeDefined();
    expect(p.query).toBeDefined();
    expect(p.extract).toBeDefined();
  });

  describe("connect()", () => {
    it("returns a ProviderConnection with close() method", async () => {
      const conn = await provider.connect(mysqlConnection);
      expect(conn).toBeDefined();
      expect(typeof conn.close).toBe("function");
    });

    it("close() calls connection.end()", async () => {
      const conn = await provider.connect(mysqlConnection);
      await conn.close();
      expect(mockMysqlConnection.end).toHaveBeenCalledOnce();
    });
  });

  describe("query()", () => {
    it("returns columns and rows", async () => {
      mockMysqlConnection.execute.mockResolvedValue([
        [{ id: 1, name: "Alice" }],
        [{ name: "id" }, { name: "name" }],
      ]);
      const conn = await provider.connect(mysqlConnection);
      const result = await provider.query!(conn, "SELECT id, name FROM users");
      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual([{ id: 1, name: "Alice" }]);
    });

    it("returns empty for no data", async () => {
      mockMysqlConnection.execute.mockResolvedValue([[], []]);
      const conn = await provider.connect(mysqlConnection);
      const result = await provider.query!(conn, "SELECT 1 WHERE false");
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });
  });

  describe("testConnection()", () => {
    it("returns true on success", async () => {
      mockMysqlConnection.execute.mockResolvedValue([[{ 1: 1 }], []]);
      const result = await provider.testConnection(mysqlConnection);
      expect(result).toBe(true);
    });

    it("returns false on error", async () => {
      const mysql = await import("mysql2/promise");
      (mysql.createConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Access denied")
      );
      const result = await provider.testConnection(mysqlConnection);
      expect(result).toBe(false);
    });

    it("always closes the connection on success", async () => {
      mockMysqlConnection.execute.mockResolvedValue([[{ 1: 1 }], []]);
      await provider.testConnection(mysqlConnection);
      expect(mockMysqlConnection.end).toHaveBeenCalledOnce();
    });
  });

  describe("extract()", () => {
    it("yields rows from query", async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      mockMysqlConnection.execute.mockResolvedValue([
        rows,
        [{ name: "id" }],
      ]);
      const conn = await provider.connect(mysqlConnection);
      const chunks: Record<string, unknown>[][] = [];
      for await (const chunk of provider.extract!(conn, { query: "SELECT id FROM t" })) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(rows);
    });
  });
});
