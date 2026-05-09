import { describe, expect, it } from "vitest";
import { discoverUniqueColumnCombinations } from "@/lib/gates/key-discovery";
import { prepareMappedRowsForPush } from "@/lib/gates/push-executor";
import {
  buildJobLineValueRows,
  jobLineValueCurrentKey,
  jobLineValueHardenedKey,
  jobLineValueMapping,
} from "./fixtures/key-drift-job-line-value";

describe("Gate key discovery regression", () => {
  it("finds job_number + 7501_line_number + line_entered_value for duplicate current keys", () => {
    const rows = buildJobLineValueRows();

    const prepared = prepareMappedRowsForPush({
      rows,
      columnMapping: jobLineValueMapping,
      primaryKeyColumns: jobLineValueCurrentKey,
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
      jobLineValueHardenedKey,
      { currentKeyColumns: jobLineValueCurrentKey }
    );

    expect(discovery.noReliableKeyReason).toBeNull();
    expect(discovery.candidates.some((candidate) =>
      candidate.columns.join("|") === jobLineValueHardenedKey.join("|")
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
