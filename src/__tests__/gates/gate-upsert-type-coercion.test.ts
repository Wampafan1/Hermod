import { describe, expect, it } from "vitest";
import {
  coerceGateRowsForDestination,
  coerceGateValueForDestination,
  derivePushStatus,
  type ColumnMap,
} from "@/lib/gates/push-executor";

describe("gate UPSERT destination type coercion", () => {
  it("accepts bigint-compatible numeric strings", () => {
    expect(
      coerceGateValueForDestination({
        value: "123",
        destType: "bigint",
        column: "__cont",
      })
    ).toEqual({ ok: true, value: "123" });
  });

  it("accepts leading-zero bigint-compatible numeric strings", () => {
    expect(
      coerceGateValueForDestination({
        value: "00123",
        destType: "BIGINT",
        column: "__cont",
      })
    ).toEqual({ ok: true, value: "00123" });
  });

  it("converts blank bigint values to null", () => {
    expect(
      coerceGateValueForDestination({
        value: "   ",
        destType: "INTEGER",
        column: "__cont",
      })
    ).toEqual({ ok: true, value: null });
  });

  it("rejects nonnumeric strings for bigint destinations", () => {
    const result = coerceGateValueForDestination({
      value: "ABC-123",
      destType: "bigint",
      column: "__cont",
      rowIndex: 7,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        column: "__cont",
        destType: "bigint",
        rowIndex: 7,
        valuePreview: "ABC-123",
        reason: "Expected integer-compatible value",
      });
    }
  });

  it("rejects decimal strings for integer destinations", () => {
    const result = coerceGateValueForDestination({
      value: "12.5",
      destType: "integer",
      column: "__cont",
    });

    expect(result.ok).toBe(false);
  });

  it("accepts decimal strings for numeric destinations", () => {
    expect(
      coerceGateValueForDestination({
        value: "12.50",
        destType: "numeric",
        column: "amount",
      })
    ).toEqual({ ok: true, value: "12.50" });
  });

  it("accepts boolean destination values from booleans and common strings", () => {
    expect(
      coerceGateValueForDestination({
        value: true,
        destType: "boolean",
        column: "active",
      })
    ).toEqual({ ok: true, value: true });
    expect(
      coerceGateValueForDestination({
        value: "0",
        destType: "BOOLEAN",
        column: "active",
      })
    ).toEqual({ ok: true, value: false });
    expect(
      coerceGateValueForDestination({
        value: "yes",
        destType: "bool",
        column: "active",
      })
    ).toEqual({ ok: true, value: true });
  });

  it("accepts parseable dates and timestamps and rejects invalid dates", () => {
    expect(
      coerceGateValueForDestination({
        value: "2026-05-11",
        destType: "date",
        column: "posted_at",
      })
    ).toEqual({ ok: true, value: "2026-05-11" });

    const timestamp = coerceGateValueForDestination({
      value: "2026-05-11T12:30:00Z",
      destType: "timestamp",
      column: "posted_at",
    });
    expect(timestamp.ok).toBe(true);
    if (timestamp.ok) {
      expect(timestamp.value).toBe("2026-05-11T12:30:00.000Z");
    }

    const invalid = coerceGateValueForDestination({
      value: "not-a-date",
      destType: "timestamp",
      column: "posted_at",
    });
    expect(invalid.ok).toBe(false);
  });

  it("preserves text destination strings", () => {
    expect(
      coerceGateValueForDestination({
        value: "ABC-123",
        destType: "varchar",
        column: "reference",
      })
    ).toEqual({ ok: true, value: "ABC-123" });
  });

  it("turns invalid numeric values into row errors and not SUCCESS", () => {
    const mapping: ColumnMap[] = [
      {
        sourceColumn: "Customer ID",
        destinationColumn: "customer_id",
        sourceType: "TEXT",
        destType: "TEXT",
      },
      {
        sourceColumn: "__cont",
        destinationColumn: "__cont",
        sourceType: "TEXT",
        destType: "bigint",
      },
    ];

    const result = coerceGateRowsForDestination({
      rows: [
        { rowIndex: 1, row: { customer_id: "C-1", __cont: "100" } },
        { rowIndex: 2, row: { customer_id: "C-2", __cont: "ABC" } },
      ],
      columnMapping: mapping,
    });

    expect(result.rows).toEqual([
      { rowIndex: 1, row: { customer_id: "C-1", __cont: "100" } },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      rowIndex: 2,
      column: "__cont",
      valuePreview: "ABC",
      reason: "Expected integer-compatible value",
    });

    const erroredRows = new Set(result.errors.map((error) => error.rowIndex)).size;
    expect(derivePushStatus({ attemptedRows: 2, rowsErrored: erroredRows })).toBe("PARTIAL");
    expect(derivePushStatus({ attemptedRows: 1, rowsErrored: 1 })).toBe("FAILED");
  });

  it("converts date strings to Excel serials for date-named integer columns", () => {
    // The destination column stores Excel serial day numbers (legacy raw format),
    // but the source now delivers real dates. Convert so it lands consistently.
    expect(
      coerceGateValueForDestination({
        value: "2024-10-30",
        destType: "bigint",
        column: "etd",
      })
    ).toEqual({ ok: true, value: 45595 });

    expect(
      coerceGateValueForDestination({
        value: "2024-11-01",
        destType: "bigint",
        column: "etd",
      })
    ).toEqual({ ok: true, value: 45597 });
  });

  it("converts Date objects to Excel serials for date-named integer columns", () => {
    expect(
      coerceGateValueForDestination({
        value: new Date(Date.UTC(2024, 9, 30)),
        destType: "INTEGER",
        column: "ETD",
      })
    ).toEqual({ ok: true, value: 45595 });
  });

  it("converts US-format date strings to Excel serials for date-named integer columns", () => {
    expect(
      coerceGateValueForDestination({
        value: "10/30/2024",
        destType: "bigint",
        column: "etd",
      })
    ).toEqual({ ok: true, value: 45595 });
  });

  it("passes existing integer serials through unchanged for date-named integer columns", () => {
    expect(
      coerceGateValueForDestination({
        value: "45595",
        destType: "bigint",
        column: "etd",
      })
    ).toEqual({ ok: true, value: "45595" });
  });

  it("does NOT convert dates for integer columns that are not date-named", () => {
    const result = coerceGateValueForDestination({
      value: "2024-10-30",
      destType: "bigint",
      column: "quantity",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("Expected integer-compatible value");
    }
  });

  it("rejects unparseable values even for date-named integer columns", () => {
    const result = coerceGateValueForDestination({
      value: "not-a-date",
      destType: "bigint",
      column: "etd",
    });
    expect(result.ok).toBe(false);
  });

  it("limits row error value previews", () => {
    const result = coerceGateValueForDestination({
      value: "postgres://user:password@example.com/database".repeat(3),
      destType: "bigint",
      column: "__cont",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.valuePreview.length).toBeLessThanOrEqual(51);
      expect(result.error.valuePreview).not.toContain("password");
      expect(result.error.valuePreview).not.toContain("databasepostgres");
    }
  });
});
