import { describe, expect, it } from "vitest";
import { discoverUniqueColumnCombinations, validateSelectedGateKey } from "@/lib/gates/key-discovery";
import { prepareMappedRowsForPush } from "@/lib/gates/push-executor";
import {
  buildJobLineValueRows,
  jobLineValueCurrentKey,
  jobLineValueHardenedKey,
  jobLineValueMapping,
} from "./fixtures/key-drift-job-line-value";

describe("Gate key hardening manual selection", () => {
  it("validates the real-world job line value key after current-key drift", () => {
    const prepared = prepareMappedRowsForPush({
      rows: buildJobLineValueRows(),
      columnMapping: jobLineValueMapping,
      primaryKeyColumns: jobLineValueCurrentKey,
      mergeStrategy: "UPSERT",
    });

    expect(prepared.blankRowsSkipped).toBe(1);
    expect(prepared.keyDrift?.duplicateExamples.length).toBeGreaterThan(0);
    expect(prepared.keyDrift?.nullKeyExamples).toEqual([]);

    const discovery = discoverUniqueColumnCombinations(
      prepared.mappedRows,
      jobLineValueHardenedKey,
      { currentKeyColumns: jobLineValueCurrentKey }
    );
    expect(discovery.candidates.some((candidate) =>
      candidate.columns.join("|") === jobLineValueHardenedKey.join("|")
    )).toBe(true);

    expect(
      validateSelectedGateKey({
        rows: prepared.mappedRows,
        selectedKey: jobLineValueHardenedKey,
        blankRowsAlreadyRemoved: true,
      })
    ).toMatchObject({
      ok: true,
      nullCount: 0,
      duplicateCount: 0,
      duplicateExamples: [],
      nullKeyExamples: [],
    });
  });

  it("keeps the staged upload in review when a manual key is not unique", () => {
    const prepared = prepareMappedRowsForPush({
      rows: buildJobLineValueRows(),
      columnMapping: jobLineValueMapping,
      primaryKeyColumns: jobLineValueCurrentKey,
      mergeStrategy: "UPSERT",
    });

    const validation = validateSelectedGateKey({
      rows: prepared.mappedRows,
      selectedKey: jobLineValueCurrentKey,
      blankRowsAlreadyRemoved: true,
    });

    expect(validation.ok).toBe(false);
    expect(validation.duplicateCount).toBeGreaterThan(0);
    expect(JSON.stringify(validation)).not.toContain("line_entered_value");
  });
});
