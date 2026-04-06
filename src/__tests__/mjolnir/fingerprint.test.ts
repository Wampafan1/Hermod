import { describe, it, expect } from "vitest";
import {
  inferDataType,
  detectDatePattern,
  computeSampleHash,
  fingerprintColumn,
  fingerprintAllColumns,
} from "@/lib/mjolnir/engine/fingerprint";

// ─── inferDataType ───────────────────────────────────

describe("inferDataType", () => {
  it("returns 'number' for numeric values", () => {
    expect(inferDataType([1, 2, 3, 4.5, -10])).toBe("number");
  });

  it("returns 'number' for numeric strings", () => {
    expect(inferDataType(["100", "200.5", "-30", "1,000", "42"])).toBe(
      "number"
    );
  });

  it("returns 'string' for text values", () => {
    expect(inferDataType(["alice", "bob", "charlie", "dana", "eve"])).toBe(
      "string"
    );
  });

  it("returns 'date' for ISO date strings", () => {
    expect(
      inferDataType([
        "2024-01-15",
        "2024-02-20",
        "2024-03-10",
        "2024-04-01",
        "2024-05-05",
      ])
    ).toBe("date");
  });

  it("returns 'boolean' for boolean values", () => {
    expect(inferDataType([true, false, true, true, false])).toBe("boolean");
  });

  it("returns 'boolean' for boolean strings", () => {
    expect(inferDataType(["true", "false", "TRUE", "False", "true"])).toBe(
      "boolean"
    );
  });

  it("returns 'mixed' when no type dominates", () => {
    expect(inferDataType(["hello", 42, true, "2024-01-01", null])).toBe(
      "mixed"
    );
  });

  it("returns 'empty' when all values are null/undefined/empty", () => {
    expect(inferDataType([null, undefined, "", null, ""])).toBe("empty");
  });

  it("handles null-heavy arrays with a dominant type", () => {
    // 3 numbers out of 5 non-null → 60% threshold
    expect(inferDataType([1, null, 2, undefined, 3, "", ""])).toBe("number");
  });
});

// ─── detectDatePattern ───────────────────────────────

describe("detectDatePattern", () => {
  it("detects ISO date pattern YYYY-MM-DD", () => {
    expect(
      detectDatePattern([
        "2024-01-15",
        "2024-02-20",
        "2024-03-10",
        "2024-04-01",
        "2024-05-05",
      ])
    ).toBe("YYYY-MM-DD");
  });

  it("detects ISO datetime pattern", () => {
    expect(
      detectDatePattern([
        "2024-01-15T10:30:00Z",
        "2024-02-20T08:00:00Z",
        "2024-03-10T14:15:00Z",
        "2024-04-01T09:00:00Z",
        "2024-05-05T16:45:00Z",
      ])
    ).toBe("YYYY-MM-DDTHH:mm:ssZ");
  });

  it("detects US date pattern MM/DD/YYYY", () => {
    expect(
      detectDatePattern([
        "01/15/2024",
        "02/20/2024",
        "03/10/2024",
        "04/01/2024",
        "05/05/2024",
      ])
    ).toBe("MM/DD/YYYY");
  });

  it("detects EU dot date pattern DD.MM.YYYY", () => {
    expect(
      detectDatePattern([
        "15.01.2024",
        "20.02.2024",
        "10.03.2024",
        "01.04.2024",
        "05.05.2024",
      ])
    ).toBe("DD.MM.YYYY");
  });

  it("detects DD-MMM-YYYY pattern", () => {
    expect(
      detectDatePattern([
        "15-Jan-2024",
        "20-Feb-2024",
        "10-Mar-2024",
        "01-Apr-2024",
        "05-May-2024",
      ])
    ).toBe("DD-MMM-YYYY");
  });

  it("returns undefined for non-date data", () => {
    expect(
      detectDatePattern(["alice", "bob", "charlie", "dana", "eve"])
    ).toBeUndefined();
  });

  it("returns undefined when fewer than 5 non-null values", () => {
    expect(
      detectDatePattern(["2024-01-15", "2024-02-20", null, null])
    ).toBeUndefined();
  });
});

// ─── computeSampleHash ───────────────────────────────

describe("computeSampleHash", () => {
  it("produces a consistent hash for the same data", () => {
    const values = [1, 2, 3, "hello"];
    const hash1 = computeSampleHash(values);
    const hash2 = computeSampleHash(values);
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const hash = computeSampleHash(["a", "b", "c"]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different data", () => {
    const hash1 = computeSampleHash([1, 2, 3]);
    const hash2 = computeSampleHash([4, 5, 6]);
    expect(hash1).not.toBe(hash2);
  });

  it("ignores null and undefined values", () => {
    const hash1 = computeSampleHash([1, 2, 3]);
    const hash2 = computeSampleHash([1, null, 2, undefined, 3]);
    expect(hash1).toBe(hash2);
  });

  it("order-independent (sorted internally)", () => {
    const hash1 = computeSampleHash(["c", "a", "b"]);
    const hash2 = computeSampleHash(["a", "b", "c"]);
    expect(hash1).toBe(hash2);
  });
});

// ─── fingerprintColumn ───────────────────────────────

describe("fingerprintColumn", () => {
  it("builds a complete fingerprint for a numeric column", () => {
    const fp = fingerprintColumn("amount", [10, 20, 30, 40, 50]);
    expect(fp.name).toBe("amount");
    expect(fp.dataType).toBe("number");
    expect(fp.nullRate).toBe(0);
    expect(fp.cardinality).toBe(5);
    expect(fp.sampleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.minValue).toBe(10);
    expect(fp.maxValue).toBe(50);
  });

  it("builds a complete fingerprint for a string column", () => {
    const fp = fingerprintColumn("name", [
      "alice",
      "bob",
      "charlie",
      "alice",
      "bob",
    ]);
    expect(fp.name).toBe("name");
    expect(fp.dataType).toBe("string");
    expect(fp.cardinality).toBe(3); // 3 unique values
    expect(fp.avgLength).toBeCloseTo(4.6, 0); // avg of 5,3,7,5,3
  });

  it("computes correct nullRate", () => {
    const fp = fingerprintColumn("sparse", [1, null, 2, null, null]);
    expect(fp.nullRate).toBeCloseTo(0.6, 2);
  });

  it("computes topValues for low-cardinality columns", () => {
    const fp = fingerprintColumn("Status", [
      "Active", "Inactive", "Active", "Active", "Inactive",
      "Pending", "Active", "Inactive",
    ]);
    expect(fp.topValues).toBeDefined();
    expect(fp.topValues![0]).toEqual({ value: "Active", count: 4 });
    expect(fp.topValues![1]).toEqual({ value: "Inactive", count: 3 });
    expect(fp.topValues![2]).toEqual({ value: "Pending", count: 1 });
  });

  it("omits topValues for high-cardinality columns (>= 100)", () => {
    const values = Array.from({ length: 200 }, (_, i) => `unique_${i}`);
    const fp = fingerprintColumn("ID", values);
    expect(fp.topValues).toBeUndefined();
  });

  it("limits topValues to 10 entries", () => {
    // 20 distinct values, each appearing twice
    const values: string[] = [];
    for (let i = 0; i < 20; i++) {
      values.push(`val_${i}`, `val_${i}`);
    }
    const fp = fingerprintColumn("Multi", values);
    expect(fp.topValues).toBeDefined();
    expect(fp.topValues!.length).toBe(10);
  });

  it("detects date pattern in date columns", () => {
    const fp = fingerprintColumn("created_at", [
      "2024-01-15",
      "2024-02-20",
      "2024-03-10",
      "2024-04-01",
      "2024-05-05",
    ]);
    expect(fp.dataType).toBe("date");
    expect(fp.datePattern).toBe("YYYY-MM-DD");
    expect(fp.minValue).toBe("2024-01-15");
    expect(fp.maxValue).toBe("2024-05-05");
  });
});

// ─── fingerprintAllColumns ───────────────────────────

describe("fingerprintAllColumns", () => {
  it("fingerprints all columns in a dataset", () => {
    const columns = ["id", "name", "amount"];
    const rows = [
      { id: 1, name: "alice", amount: 100 },
      { id: 2, name: "bob", amount: 200 },
      { id: 3, name: "charlie", amount: 300 },
      { id: 4, name: "dana", amount: 400 },
      { id: 5, name: "eve", amount: 500 },
    ];

    const fps = fingerprintAllColumns(columns, rows);
    expect(fps).toHaveLength(3);
    expect(fps[0].name).toBe("id");
    expect(fps[0].dataType).toBe("number");
    expect(fps[1].name).toBe("name");
    expect(fps[1].dataType).toBe("string");
    expect(fps[2].name).toBe("amount");
    expect(fps[2].dataType).toBe("number");
  });

  it("handles empty rows", () => {
    const fps = fingerprintAllColumns(["col_a"], []);
    expect(fps).toHaveLength(1);
    expect(fps[0].dataType).toBe("empty");
    expect(fps[0].cardinality).toBe(0);
  });
});
