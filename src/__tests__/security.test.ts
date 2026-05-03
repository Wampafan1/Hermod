import { beforeAll, describe, it, expect, vi } from "vitest";

// ─── Task 29: SSRF Protection ────────────────────────
describe("SSRF Protection", () => {
  // Import inline to avoid DNS resolution in test setup
  let checkSsrf: typeof import("@/lib/ssrf").checkSsrf;

  beforeAll(async () => {
    ({ checkSsrf } = await import("@/lib/ssrf"));
  });

  it("rejects 192.168.x.x private IPs", async () => {
    const result = await checkSsrf("192.168.1.1");
    expect(result).toContain("private IP");
  });

  it("rejects 10.x.x.x private IPs", async () => {
    const result = await checkSsrf("10.0.0.5");
    expect(result).toContain("private IP");
  });

  it("rejects 127.0.0.1 loopback", async () => {
    const result = await checkSsrf("127.0.0.1");
    expect(result).toContain("private IP");
  });

  it("rejects 172.16.x.x private IPs", async () => {
    const result = await checkSsrf("172.16.0.1");
    expect(result).toContain("private IP");
  });

  it("rejects 172.31.x.x (upper bound of 172.16/12)", async () => {
    const result = await checkSsrf("172.31.255.255");
    expect(result).toContain("private IP");
  });

  it("allows 172.32.x.x (outside private range)", async () => {
    const result = await checkSsrf("172.32.0.1");
    expect(result).toBeNull();
  });

  it("rejects IPv6 loopback ::1", async () => {
    const result = await checkSsrf("::1");
    expect(result).toContain("private IP");
  });

  it("rejects IPv4-mapped IPv6 loopback", async () => {
    const result = await checkSsrf("::ffff:127.0.0.1");
    expect(result).toContain("private IP");
  });

  it("rejects IPv4-mapped IPv6 private networks", async () => {
    const result = await checkSsrf("::ffff:10.0.0.1");
    expect(result).toContain("private IP");
  });

  it("rejects 169.254.x.x link-local", async () => {
    const result = await checkSsrf("169.254.1.1");
    expect(result).toContain("private IP");
  });

  it("allows public IPs", async () => {
    const result = await checkSsrf("8.8.8.8");
    expect(result).toBeNull();
  });

  it("rejects 0.0.0.0", async () => {
    const result = await checkSsrf("0.0.0.0");
    expect(result).toContain("private IP");
  });

  it("rejects private REST API URLs", async () => {
    const { checkSsrfUrl } = await import("@/lib/ssrf");
    const result = await checkSsrfUrl("http://127.0.0.1:3000/openapi.json");
    expect(result).toContain("private IP");
  });

  it("rejects non-http URL protocols", async () => {
    const { checkSsrfUrl } = await import("@/lib/ssrf");
    const result = await checkSsrfUrl("file:///etc/passwd");
    expect(result).toContain("not allowed");
  });
});

// ─── Task 34: REPORT_ROW_LIMIT ──────────────────────
describe("REPORT_ROW_LIMIT", () => {
  it("exports a positive integer constant", async () => {
    const { REPORT_ROW_LIMIT } = await import("@/lib/report-runner");
    expect(REPORT_ROW_LIMIT).toBe(500_000);
    expect(Number.isInteger(REPORT_ROW_LIMIT)).toBe(true);
  });
});

// ─── Task 35: PREVIEW_ROW_LIMIT ─────────────────────
describe("PREVIEW_ROW_LIMIT", () => {
  it("exports a positive integer constant", async () => {
    const { PREVIEW_ROW_LIMIT } = await import("@/lib/query-limits");
    expect(PREVIEW_ROW_LIMIT).toBe(10_000);
    expect(Number.isInteger(PREVIEW_ROW_LIMIT)).toBe(true);
  });
});

describe("buildLimitedSqlQuery", () => {
  it("wraps Postgres read queries with a server-side row limit", async () => {
    const { buildLimitedSqlQuery } = await import("@/lib/query-limits");
    const limited = buildLimitedSqlQuery("SELECT * FROM invoices;", "POSTGRES", 10001);

    expect(limited.limited).toBe(true);
    expect(limited.usesSessionRowLimit).toBe(false);
    expect(limited.sql).toContain("LIMIT 10001");
    expect(limited.sql).toContain("SELECT * FROM invoices");
  });

  it("uses a resettable rowcount guard for SQL Server read queries", async () => {
    const { buildLimitedSqlQuery, MSSQL_RESET_ROWCOUNT_SQL } = await import("@/lib/query-limits");
    const limited = buildLimitedSqlQuery("WITH x AS (SELECT 1 AS id) SELECT * FROM x", "MSSQL", 10);

    expect(limited.limited).toBe(true);
    expect(limited.usesSessionRowLimit).toBe(true);
    expect(limited.sql).toContain("SET ROWCOUNT 10");
    expect(limited.sql).toContain(MSSQL_RESET_ROWCOUNT_SQL);
  });

  it("does not wrap non-read statements", async () => {
    const { buildLimitedSqlQuery } = await import("@/lib/query-limits");
    const sql = "UPDATE reports SET name = 'bad'";

    expect(buildLimitedSqlQuery(sql, "POSTGRES", 10)).toEqual({
      sql,
      limited: false,
      usesSessionRowLimit: false,
    });
  });
});
