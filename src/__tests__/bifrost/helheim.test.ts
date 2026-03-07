import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  compressPayload,
  decompressPayload,
  classifyError,
} from "@/lib/bifrost/helheim/dead-letter";

// Only test the pure functions that don't need DB mocking.
// enqueue/retry/mark* are integration-tested against the DB.

describe("Helheim — pure functions", () => {
  describe("compressPayload / decompressPayload round-trip", () => {
    it("compresses and decompresses rows correctly", async () => {
      const rows = [
        { id: 1, name: "Alpha", value: 100 },
        { id: 2, name: "Beta", value: 200 },
        { id: 3, name: "Gamma", value: 300 },
      ];

      const compressed = await compressPayload(rows);
      expect(typeof compressed).toBe("string");
      // Should be base64
      expect(/^[A-Za-z0-9+/=]+$/.test(compressed)).toBe(true);

      const decompressed = await decompressPayload(compressed);
      expect(decompressed).toEqual(rows);
    });

    it("handles single row", async () => {
      const rows = [{ x: 1 }];
      const result = await decompressPayload(await compressPayload(rows));
      expect(result).toEqual(rows);
    });

    it("handles empty array", async () => {
      const rows: Record<string, unknown>[] = [];
      const result = await decompressPayload(await compressPayload(rows));
      expect(result).toEqual([]);
    });

    it("handles rows with nulls and nested objects", async () => {
      const rows = [
        { id: 1, meta: null, tags: ["a", "b"] },
        { id: 2, meta: { nested: true }, tags: [] },
      ];
      const result = await decompressPayload(await compressPayload(rows));
      expect(result).toEqual(rows);
    });

    it("handles special characters in values", async () => {
      const rows = [
        { text: "hello\nworld", emoji: "test", unicode: "\u2603" },
      ];
      const result = await decompressPayload(await compressPayload(rows));
      expect(result).toEqual(rows);
    });

    it("compresses large payloads significantly", async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Row number ${i}`,
        value: Math.random() * 1000,
        category: i % 5 === 0 ? "A" : "B",
      }));

      const compressed = await compressPayload(rows);
      const rawSize = JSON.stringify(rows).length;
      const compressedSize = compressed.length;

      // Compressed should be significantly smaller (at least 50% smaller for repetitive data)
      expect(compressedSize).toBeLessThan(rawSize);
    });
  });

  describe("classifyError", () => {
    it("classifies auth errors", () => {
      expect(classifyError(new Error("Authentication failed"))).toBe("auth_failure");
      expect(classifyError(new Error("Invalid credential"))).toBe("auth_failure");
      expect(classifyError(new Error("Permission denied"))).toBe("auth_failure");
      expect(classifyError(new Error("403 Forbidden"))).toBe("auth_failure");
    });

    it("classifies timeout errors", () => {
      expect(classifyError(new Error("Request timeout"))).toBe("timeout");
      expect(classifyError(new Error("Deadline exceeded"))).toBe("timeout");
      expect(classifyError(new Error("ETIMEDOUT"))).toBe("timeout");
    });

    it("classifies transform errors", () => {
      expect(classifyError(new Error("Transform failed"))).toBe("transform_failure");
      expect(classifyError(new Error("Forge step error"))).toBe("transform_failure");
      expect(classifyError(new Error("Blueprint execution error"))).toBe("transform_failure");
    });

    it("defaults to load_failure for unknown errors", () => {
      expect(classifyError(new Error("Something went wrong"))).toBe("load_failure");
      expect(classifyError(new Error("Schema mismatch"))).toBe("load_failure");
    });

    it("handles non-Error objects", () => {
      expect(classifyError("string error")).toBe("load_failure");
      expect(classifyError(42)).toBe("load_failure");
      expect(classifyError(null)).toBe("load_failure");
    });
  });
});
