import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Variables (hoisted) ───────────────────────────
const mockDecrypt = vi.hoisted(() => vi.fn());

// ─── Module Mocks ───────────────────────────────────────

// Mock all driver imports so provider constructors don't pull in real deps
vi.mock("pg", () => ({ default: { Client: vi.fn() } }));
vi.mock("mssql", () => ({ default: { connect: vi.fn() } }));
vi.mock("mysql2/promise", () => ({ createConnection: vi.fn() }));
vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn(),
}));

// Mock crypto — decrypt is the function we care about
vi.mock("@/lib/crypto", () => ({
  decrypt: mockDecrypt,
  encrypt: vi.fn((s: string) => s),
}));

// ─── Imports ────────────────────────────────────────────

import { getProvider } from "@/lib/providers";
import { toConnectionLike } from "@/lib/providers/helpers";

// ─── Registry Tests ─────────────────────────────────────

describe("provider registry", () => {
  it("returns a provider for each supported type", () => {
    for (const type of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE"]) {
      expect(() => getProvider(type)).not.toThrow();
      expect(getProvider(type).type).toBe(type);
    }
  });

  it("throws for unknown type", () => {
    expect(() => getProvider("UNKNOWN")).toThrow("No provider for type");
  });

  it("error message lists available types", () => {
    try {
      getProvider("UNKNOWN");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("POSTGRES");
      expect(msg).toContain("BIGQUERY");
      expect(msg).toContain("NETSUITE");
    }
  });

  it("returns the same instance for repeated calls", () => {
    const a = getProvider("POSTGRES");
    const b = getProvider("POSTGRES");
    expect(a).toBe(b);
  });
});

// ─── toConnectionLike Tests ─────────────────────────────

describe("toConnectionLike", () => {
  beforeEach(() => {
    mockDecrypt.mockReset();
  });

  it("decrypts credentials JSON and parses config", () => {
    // decrypt returns the plaintext JSON
    mockDecrypt.mockReturnValue('{"password":"secret"}');

    const result = toConnectionLike({
      type: "POSTGRES",
      config: { host: "localhost", port: 5432 },
      credentials: "encrypted-blob",
    });

    expect(result.type).toBe("POSTGRES");
    expect(result.config.host).toBe("localhost");
    expect(result.config.port).toBe(5432);
    expect(result.credentials.password).toBe("secret");
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-blob");
  });

  it("handles null credentials", () => {
    const result = toConnectionLike({
      type: "BIGQUERY",
      config: { projectId: "p" },
      credentials: null,
    });
    expect(result.credentials).toEqual({});
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("handles null config", () => {
    const result = toConnectionLike({
      type: "POSTGRES",
      config: null,
      credentials: null,
    });
    expect(result.config).toEqual({});
  });

  it("falls back to plaintext JSON if decrypt fails", () => {
    // decrypt throws (not a valid encrypted string)
    mockDecrypt.mockImplementation(() => {
      throw new Error("Invalid encrypted format");
    });

    const result = toConnectionLike({
      type: "POSTGRES",
      config: {},
      credentials: '{"password":"plain"}',
    });
    expect(result.credentials.password).toBe("plain");
  });

  it("returns empty credentials if both decrypt and JSON.parse fail", () => {
    mockDecrypt.mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    const result = toConnectionLike({
      type: "POSTGRES",
      config: {},
      credentials: "not-json-not-encrypted",
    });
    expect(result.credentials).toEqual({});
  });

  it("preserves the connection type as-is", () => {
    const result = toConnectionLike({
      type: "NETSUITE",
      config: { accountId: "123" },
      credentials: null,
    });
    expect(result.type).toBe("NETSUITE");
  });
});
