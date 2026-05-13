import { describe, expect, it } from "vitest";
import {
  coerceGateRowsForDestination,
  derivePushStatus,
  type ColumnMap,
} from "@/lib/gates/push-executor";

describe("gate push executor status", () => {
  it("never returns SUCCESS when rowsErrored is greater than zero", () => {
    expect(derivePushStatus({ attemptedRows: 10, rowsErrored: 1 })).not.toBe("SUCCESS");
    expect(derivePushStatus({ attemptedRows: 10, rowsErrored: 10 })).not.toBe("SUCCESS");
  });

  it("marks all-row errors as FAILED", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 4 })).toBe("FAILED");
  });

  it("marks mixed success and errors as PARTIAL", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 2 })).toBe("PARTIAL");
  });

  it("marks zero row errors as SUCCESS", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 0 })).toBe("SUCCESS");
  });

  it("marks typed row coercion failures as PARTIAL instead of SUCCESS", () => {
    const mapping: ColumnMap[] = [
      { sourceColumn: "ID", destinationColumn: "id", sourceType: "TEXT", destType: "TEXT" },
      { sourceColumn: "__cont", destinationColumn: "__cont", sourceType: "TEXT", destType: "bigint" },
    ];
    const result = coerceGateRowsForDestination({
      rows: [
        { rowIndex: 1, row: { id: "A", __cont: "10" } },
        { rowIndex: 2, row: { id: "B", __cont: "not-numeric" } },
      ],
      columnMapping: mapping,
    });
    const erroredRows = new Set(result.errors.map((error) => error.rowIndex)).size;

    expect(result.rows).toHaveLength(1);
    expect(derivePushStatus({ attemptedRows: 2, rowsErrored: erroredRows })).toBe("PARTIAL");
  });
});
