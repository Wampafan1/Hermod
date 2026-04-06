import { describe, it, expect } from "vitest";
import { inferSchemaFromRows, normalizeRowDates, getDateColumns } from "@/lib/bifrost/engine";

describe("inferSchemaFromRows", () => {
  it("returns empty fields for empty rows", () => {
    const schema = inferSchemaFromRows([]);
    expect(schema.fields).toEqual([]);
  });

  it("infers STRING for all-null columns", () => {
    const schema = inferSchemaFromRows([
      { name: null },
      { name: null },
    ]);
    expect(schema.fields).toEqual([
      { name: "name", type: "STRING", mode: "NULLABLE" },
    ]);
  });

  it("infers FLOAT64 for integer-only columns", () => {
    const schema = inferSchemaFromRows([
      { qty: 5 },
      { qty: 10 },
      { qty: 0 },
    ]);
    expect(schema.fields[0]).toEqual({
      name: "qty",
      type: "FLOAT64",
      mode: "NULLABLE",
    });
  });

  it("infers FLOAT64 for mixed int/float columns", () => {
    const schema = inferSchemaFromRows([
      { price: 5 },
      { price: 9.99 },
      { price: 0 },
    ]);
    expect(schema.fields[0].type).toBe("FLOAT64");
  });

  it("infers FLOAT64 for float-only columns", () => {
    const schema = inferSchemaFromRows([
      { rate: 1.5 },
      { rate: 2.7 },
    ]);
    expect(schema.fields[0].type).toBe("FLOAT64");
  });

  it("infers BOOLEAN for boolean-only columns", () => {
    const schema = inferSchemaFromRows([
      { active: true },
      { active: false },
      { active: null },
    ]);
    expect(schema.fields[0].type).toBe("BOOLEAN");
  });

  // ─── DATE vs TIMESTAMP ──────────────────────────────

  it("infers DATE for ISO date-only strings", () => {
    const schema = inferSchemaFromRows([
      { created: "2024-01-15" },
      { created: "2024-06-30" },
    ]);
    expect(schema.fields[0].type).toBe("DATE");
  });

  it("infers TIMESTAMP for ISO datetime strings", () => {
    const schema = inferSchemaFromRows([
      { created: "2024-01-15T10:30:00" },
      { created: "2024-06-30T23:59:59.999Z" },
    ]);
    expect(schema.fields[0].type).toBe("TIMESTAMP");
  });

  it("infers TIMESTAMP for ISO datetime with space separator", () => {
    const schema = inferSchemaFromRows([
      { ts: "2024-01-15 10:30:00" },
    ]);
    expect(schema.fields[0].type).toBe("TIMESTAMP");
  });

  it("infers DATE for US date-only format strings", () => {
    const schema = inferSchemaFromRows([
      { date: "6/29/2024" },
      { date: "11/3/2024" },
    ]);
    expect(schema.fields[0].type).toBe("DATE");
  });

  it("infers TIMESTAMP for US datetime format strings", () => {
    const schema = inferSchemaFromRows([
      { date: "1/15/2024 12:00:00 AM" },
      { date: "12/31/2024 3:45:00 PM" },
    ]);
    expect(schema.fields[0].type).toBe("TIMESTAMP");
  });

  it("infers TIMESTAMP when mixing date-only and datetime values", () => {
    const schema = inferSchemaFromRows([
      { date: "6/29/2024" },
      { date: "1/15/2024 12:00:00 AM" },
    ]);
    // Any time component widens to TIMESTAMP
    expect(schema.fields[0].type).toBe("TIMESTAMP");
  });

  it("infers TIMESTAMP when mixing ISO date and US datetime", () => {
    const schema = inferSchemaFromRows([
      { date: "2024-01-15" },
      { date: "6/29/2024 3:00:00 PM" },
    ]);
    expect(schema.fields[0].type).toBe("TIMESTAMP");
  });

  // ─── STRING fallbacks ─────────────────────────────

  it("infers STRING for plain string columns", () => {
    const schema = inferSchemaFromRows([
      { name: "Alice" },
      { name: "Bob" },
    ]);
    expect(schema.fields[0].type).toBe("STRING");
  });

  it("infers STRING for mixed number+string columns", () => {
    const schema = inferSchemaFromRows([
      { val: 42 },
      { val: "hello" },
    ]);
    expect(schema.fields[0].type).toBe("STRING");
  });

  it("infers STRING for mixed boolean+string columns", () => {
    const schema = inferSchemaFromRows([
      { flag: true },
      { flag: "yes" },
    ]);
    expect(schema.fields[0].type).toBe("STRING");
  });

  it("infers STRING for mixed date+non-date string columns", () => {
    const schema = inferSchemaFromRows([
      { val: "2024-01-15" },
      { val: "not a date" },
    ]);
    expect(schema.fields[0].type).toBe("STRING");
  });

  // ─── Multi-column & edge cases ────────────────────

  it("handles multiple columns with different types", () => {
    const schema = inferSchemaFromRows([
      { id: 1, name: "Alice", active: true, created: "2024-01-15", score: 9.5 },
      { id: 2, name: "Bob", active: false, created: "2024-06-30", score: 8.0 },
    ]);
    expect(schema.fields).toEqual([
      { name: "id", type: "FLOAT64", mode: "NULLABLE" },
      { name: "name", type: "STRING", mode: "NULLABLE" },
      { name: "active", type: "BOOLEAN", mode: "NULLABLE" },
      { name: "created", type: "DATE", mode: "NULLABLE" },
      { name: "score", type: "FLOAT64", mode: "NULLABLE" },
    ]);
  });

  it("ignores nulls when determining type (non-null values decide)", () => {
    const schema = inferSchemaFromRows([
      { qty: null },
      { qty: null },
      { qty: 5 },
      { qty: null },
    ]);
    expect(schema.fields[0].type).toBe("FLOAT64");
  });

  it("scans all rows, not just the first", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      val: i === 999 ? 42 : null,
    }));
    const schema = inferSchemaFromRows(rows);
    expect(schema.fields[0].type).toBe("FLOAT64");
  });

  it("uses STRING for columns with only undefined values", () => {
    const schema = inferSchemaFromRows([
      { val: undefined },
      { val: undefined },
    ]);
    expect(schema.fields[0].type).toBe("STRING");
  });

  it("all fields have mode NULLABLE", () => {
    const schema = inferSchemaFromRows([
      { a: 1, b: "x", c: true },
    ]);
    for (const field of schema.fields) {
      expect(field.mode).toBe("NULLABLE");
    }
  });

  it("handles NetSuite-style data with mixed nulls and types", () => {
    const schema = inferSchemaFromRows([
      { internalid: 1, itemid: "SKU-001", quantityonhand: 100, lastpurchasedate: "2024-03-15", isinactive: false },
      { internalid: 2, itemid: "SKU-002", quantityonhand: null, lastpurchasedate: null, isinactive: true },
      { internalid: 3, itemid: "SKU-003", quantityonhand: 50.5, lastpurchasedate: "1/20/2024", isinactive: false },
    ]);
    expect(schema.fields).toEqual([
      { name: "internalid", type: "FLOAT64", mode: "NULLABLE" },
      { name: "itemid", type: "STRING", mode: "NULLABLE" },
      { name: "quantityonhand", type: "FLOAT64", mode: "NULLABLE" },
      { name: "lastpurchasedate", type: "DATE", mode: "NULLABLE" },
      { name: "isinactive", type: "BOOLEAN", mode: "NULLABLE" },
    ]);
  });
});

// ─── normalizeRowDates ────────────────────────────────

describe("normalizeRowDates", () => {
  it("converts US date M/D/YYYY to YYYY-MM-DD", () => {
    const rows = [{ d: "6/29/2024" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29");
  });

  it("converts US date with single-digit month and day", () => {
    const rows = [{ d: "1/3/2024" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-01-03");
  });

  it("converts US date with double-digit month and day", () => {
    const rows = [{ d: "11/25/2024" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-11-25");
  });

  it("converts US datetime with AM", () => {
    const rows = [{ d: "1/15/2024 12:00:00 AM" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-01-15 00:00:00");
  });

  it("converts US datetime with PM", () => {
    const rows = [{ d: "6/29/2024 3:45:00 PM" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29 15:45:00");
  });

  it("converts 12 PM correctly (noon)", () => {
    const rows = [{ d: "1/1/2024 12:30:00 PM" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-01-01 12:30:00");
  });

  it("converts 12 AM correctly (midnight)", () => {
    const rows = [{ d: "1/1/2024 12:00:00 AM" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-01-01 00:00:00");
  });

  it("converts US datetime without AM/PM (24h)", () => {
    const rows = [{ d: "6/29/2024 15:45:00" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29 15:45:00");
  });

  it("leaves ISO dates unchanged", () => {
    const rows = [{ d: "2024-06-29" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29");
  });

  it("leaves ISO datetimes unchanged", () => {
    const rows = [{ d: "2024-06-29T15:45:00" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29T15:45:00");
  });

  it("leaves null values unchanged", () => {
    const rows = [{ d: null }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBeNull();
  });

  it("leaves empty string unchanged", () => {
    const rows = [{ d: "" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("");
  });

  it("leaves undefined unchanged", () => {
    const rows = [{ d: undefined }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBeUndefined();
  });

  it("leaves non-date string columns unchanged", () => {
    const rows = [{ d: "6/29/2024", name: "Alice" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].name).toBe("Alice");
  });

  it("only transforms columns in the dateColumns set", () => {
    const rows = [{ d: "6/29/2024", other: "11/3/2024" }];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29");
    expect(rows[0].other).toBe("11/3/2024"); // not in dateColumns, untouched
  });

  it("handles multiple rows", () => {
    const rows = [
      { d: "6/29/2024" },
      { d: null },
      { d: "11/3/2024" },
      { d: "2024-01-15" },
    ];
    normalizeRowDates(rows, new Set(["d"]));
    expect(rows[0].d).toBe("2024-06-29");
    expect(rows[1].d).toBeNull();
    expect(rows[2].d).toBe("2024-11-03");
    expect(rows[3].d).toBe("2024-01-15");
  });

  it("handles multiple date columns", () => {
    const rows = [{ created: "6/29/2024", modified: "1/15/2024 3:00:00 PM" }];
    normalizeRowDates(rows, new Set(["created", "modified"]));
    expect(rows[0].created).toBe("2024-06-29");
    expect(rows[0].modified).toBe("2024-01-15 15:00:00");
  });
});

// ─── getDateColumns ──────────────────────────────────

describe("getDateColumns", () => {
  it("returns empty set for null schema", () => {
    expect(getDateColumns(null).size).toBe(0);
  });

  it("returns empty set for undefined schema", () => {
    expect(getDateColumns(undefined).size).toBe(0);
  });

  it("returns DATE and TIMESTAMP columns", () => {
    const cols = getDateColumns({
      fields: [
        { name: "id", type: "FLOAT64", mode: "NULLABLE" },
        { name: "created", type: "DATE", mode: "NULLABLE" },
        { name: "updated", type: "TIMESTAMP", mode: "NULLABLE" },
        { name: "name", type: "STRING", mode: "NULLABLE" },
      ],
    });
    expect(cols).toEqual(new Set(["created", "updated"]));
  });

  it("returns empty set when no date columns", () => {
    const cols = getDateColumns({
      fields: [
        { name: "id", type: "FLOAT64", mode: "NULLABLE" },
        { name: "name", type: "STRING", mode: "NULLABLE" },
      ],
    });
    expect(cols.size).toBe(0);
  });
});
