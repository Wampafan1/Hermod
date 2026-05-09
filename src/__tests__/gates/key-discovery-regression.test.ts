import { describe, expect, it } from "vitest";
import { discoverUniqueColumnCombinations } from "@/lib/gates/key-discovery";
import { prepareMappedRowsForPush, type ColumnMap } from "@/lib/gates/push-executor";

const mapping: ColumnMap[] = [
  { sourceColumn: "job_number", destinationColumn: "job_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "7501_line_number", destinationColumn: "7501_line_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "line_entered_value", destinationColumn: "line_entered_value", sourceType: "TEXT", destType: "TEXT" },
];

function ordinaryRow(index: number) {
  return {
    job_number: `SNGB${String(index).padStart(7, "0")}`,
    "7501_line_number": String((index % 17) + 1).padStart(4, "0"),
    line_entered_value: `VALUE-${index % 41}`,
  };
}

describe("Gate key discovery regression", () => {
  it("finds job_number + 7501_line_number + line_entered_value for duplicate current keys", () => {
    const rows = Array.from({ length: 1550 }, (_, index) => ordinaryRow(index + 1));
    rows[1143] = {
      job_number: "SNGB0097414",
      "7501_line_number": "0001",
      line_entered_value: "110.25",
    };
    rows[1144] = {
      job_number: "SNGB0097414",
      "7501_line_number": "0001",
      line_entered_value: "115.75",
    };
    rows[1204] = {
      job_number: "SNGB0097746",
      "7501_line_number": "0001",
      line_entered_value: "210.00",
    };
    rows[1205] = {
      job_number: "SNGB0097746",
      "7501_line_number": "0001",
      line_entered_value: "211.00",
    };
    rows[1547] = {
      job_number: "SNGB0102183",
      "7501_line_number": "0007",
      line_entered_value: "310.00",
    };
    rows[1548] = {
      job_number: "SNGB0102183",
      "7501_line_number": "0007",
      line_entered_value: "315.00",
    };
    rows.push({
      job_number: " ",
      "7501_line_number": "",
      line_entered_value: " ",
    });

    const prepared = prepareMappedRowsForPush({
      rows,
      columnMapping: mapping,
      primaryKeyColumns: ["job_number", "7501_line_number"],
      mergeStrategy: "UPSERT",
    });

    expect(prepared.blankRowsSkipped).toBe(1);
    expect(prepared.keyDrift?.duplicateExamples).toEqual([
      {
        keyValues: { job_number: "SNGB0097414", "7501_line_number": "0001" },
        rowIndexes: [1144, 1145],
      },
      {
        keyValues: { job_number: "SNGB0097746", "7501_line_number": "0001" },
        rowIndexes: [1205, 1206],
      },
      {
        keyValues: { job_number: "SNGB0102183", "7501_line_number": "0007" },
        rowIndexes: [1548, 1549],
      },
    ]);
    expect(prepared.keyDrift?.nullKeyExamples).toEqual([]);

    const discovery = discoverUniqueColumnCombinations(
      prepared.mappedRows,
      ["job_number", "7501_line_number", "line_entered_value"],
      { currentKeyColumns: ["job_number", "7501_line_number"] }
    );

    expect(discovery.noReliableKeyReason).toBeNull();
    expect(discovery.candidates.some((candidate) =>
      candidate.columns.join("|") === "job_number|7501_line_number|line_entered_value"
    )).toBe(true);
    expect(discovery.stats.discoveryMode).toMatch(/DUPLICATE_DISCRIMINATOR|THOROUGH/);
    expect(
      discovery.stats.searchExhaustive || discovery.candidates.length > 0
    ).toBe(true);
    expect(discovery.stats.discriminatorColumns.map((column) => column.column)).toContain(
      "line_entered_value"
    );
  });
});
