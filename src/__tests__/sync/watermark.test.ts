import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
const mockFindFirst = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineWatermark: {
      findFirst: mockFindFirst,
      upsert: mockUpsert,
    },
  },
}));

const { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } = await import(
  "@/lib/sync/watermark"
);

describe("watermark service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWatermark", () => {
    it("returns watermark string when found", async () => {
      mockFindFirst.mockResolvedValueOnce({ watermark: "2026-01-15T08:30:00.000Z" });
      const result = await getWatermark("route-1", "customers");
      expect(result).toBe("2026-01-15T08:30:00.000Z");
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { routeId_tableName: { routeId: "route-1", tableName: "customers" } },
        select: { watermark: true },
      });
    });

    it("returns null when no watermark exists", async () => {
      mockFindFirst.mockResolvedValueOnce(null);
      const result = await getWatermark("route-1", "new_table");
      expect(result).toBeNull();
    });
  });

  describe("setWatermark", () => {
    it("upserts watermark record", async () => {
      mockUpsert.mockResolvedValueOnce({});
      await setWatermark({
        routeId: "route-1",
        tableName: "customers",
        watermark: "2026-01-15T10:00:00.000Z",
        watermarkType: "timestamp_cursor",
        rowsSynced: 42,
      });

      expect(mockUpsert).toHaveBeenCalledOnce();
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where.routeId_tableName).toEqual({
        routeId: "route-1",
        tableName: "customers",
      });
      expect(call.create.watermark).toBe("2026-01-15T10:00:00.000Z");
      expect(call.update.watermark).toBe("2026-01-15T10:00:00.000Z");
    });
  });

  describe("buildIncrementalClause", () => {
    it("returns null for full_refresh", () => {
      expect(buildIncrementalClause("col", "full_refresh", "2026-01-01")).toBeNull();
    });

    it("returns null when watermark is null (first run)", () => {
      expect(buildIncrementalClause("updated_at", "timestamp_cursor", null)).toBeNull();
    });

    it("builds timestamp comparison", () => {
      const clause = buildIncrementalClause(
        "lastmodifieddate",
        "timestamp_cursor",
        "2026-01-15T08:30:00.000Z"
      );
      expect(clause).toBe("lastmodifieddate > '2026-01-15T08:30:00.000Z'");
    });

    it("builds integer ID comparison", () => {
      const clause = buildIncrementalClause("log_id", "integer_id_cursor", "98765");
      expect(clause).toBe("log_id > 98765");
    });

    it("builds rowversion comparison", () => {
      const clause = buildIncrementalClause("RowVer", "rowversion_cursor", "00000000000007D1");
      expect(clause).toBe("RowVer > 0x00000000000007D1");
    });
  });

  describe("extractNewWatermark", () => {
    it("returns null for empty rows", () => {
      expect(extractNewWatermark([], "col", "timestamp_cursor")).toBeNull();
    });

    it("returns null for full_refresh", () => {
      const rows = [{ id: 1, col: "2026-01-01" }];
      expect(extractNewWatermark(rows, "col", "full_refresh")).toBeNull();
    });

    it("extracts max timestamp", () => {
      const rows = [
        { lastmod: "2026-01-10T00:00:00.000Z" },
        { lastmod: "2026-01-15T12:00:00.000Z" },
        { lastmod: "2026-01-12T06:00:00.000Z" },
      ];
      const result = extractNewWatermark(rows, "lastmod", "timestamp_cursor");
      expect(result).toBe("2026-01-15T12:00:00.000Z");
    });

    it("extracts max integer ID", () => {
      const rows = [{ log_id: 100 }, { log_id: 250 }, { log_id: 200 }];
      const result = extractNewWatermark(rows, "log_id", "integer_id_cursor");
      expect(result).toBe("250");
    });

    it("extracts max rowversion as hex", () => {
      const rows = [
        { RowVer: "00000000000007D0" },
        { RowVer: "00000000000007D1" },
        { RowVer: "00000000000007CF" },
      ];
      const result = extractNewWatermark(rows, "RowVer", "rowversion_cursor");
      expect(result).toBe("00000000000007D1");
    });

    it("skips null cursor values", () => {
      const rows = [
        { updated_at: null },
        { updated_at: "2026-01-15T12:00:00.000Z" },
        { updated_at: null },
      ];
      const result = extractNewWatermark(rows, "updated_at", "timestamp_cursor");
      expect(result).toBe("2026-01-15T12:00:00.000Z");
    });
  });
});
