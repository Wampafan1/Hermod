import { describe, expect, it } from "vitest";
import {
  buildKeyDriftRecommendation,
  discoverUniqueColumnCombinations,
} from "@/lib/gates/key-discovery";
import { prepareMappedRowsForPush, type ColumnMap } from "@/lib/gates/push-executor";

describe("Gate key discovery", () => {
  it("detects a single-column unique key", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { customer_id: "C-1", name: "Ada" },
        { customer_id: "C-2", name: "Grace" },
      ],
      ["customer_id", "name"]
    );

    expect(result.candidates[0].columns).toEqual(["customer_id"]);
    expect(result.candidates[0]).toMatchObject({
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      width: 1,
    });
  });

  it("detects a composite unique key", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { job_number: "J1", line_number: "1", value: 10 },
        { job_number: "J1", line_number: "2", value: 10 },
        { job_number: "J2", line_number: "1", value: 10 },
      ],
      ["job_number", "line_number", "value"]
    );

    expect(result.candidates.some((candidate) =>
      candidate.columns.join("|") === "job_number|line_number"
    )).toBe(true);
  });

  it("rejects candidates with nulls", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { customer_id: "C-1" },
        { customer_id: null },
      ],
      ["customer_id"]
    );

    expect(result.candidates).toEqual([]);
    expect(result.noReliableKeyReason).toContain("No null-free unique");
  });

  it("rejects candidates with duplicates", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { customer_id: "C-1" },
        { customer_id: "C-1" },
      ],
      ["customer_id"]
    );

    expect(result.candidates).toEqual([]);
    expect(result.noReliableKeyReason).toContain("No null-free unique");
  });

  it("ranks narrower candidates higher when both are valid", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { customer_id: "C-1", line_number: "1" },
        { customer_id: "C-2", line_number: "1" },
      ],
      ["customer_id", "line_number"]
    );

    expect(result.candidates[0].columns).toEqual(["customer_id"]);
  });

  it("builds deterministic fallback recommendation", () => {
    const discovery = discoverUniqueColumnCombinations(
      [
        { customer_id: "C-1" },
        { customer_id: "C-2" },
      ],
      ["customer_id"]
    );

    const recommendation = buildKeyDriftRecommendation({
      candidateKeys: discovery.candidates,
      validationStats: discovery.stats,
      noReliableKeyReason: discovery.noReliableKeyReason,
    });

    expect(recommendation.recommendation).toMatchObject({
      columns: ["customer_id"],
      source: "DETERMINISTIC",
    });
  });

  it("returns a clear reason when no key is found", () => {
    const discovery = discoverUniqueColumnCombinations(
      [
        { status: "open" },
        { status: "open" },
      ],
      ["status"]
    );

    const recommendation = buildKeyDriftRecommendation({
      candidateKeys: discovery.candidates,
      validationStats: discovery.stats,
      noReliableKeyReason: discovery.noReliableKeyReason,
    });

    expect(recommendation.recommendation).toBeNull();
    expect(recommendation.noReliableKeyReason).toContain("No null-free unique");
  });

  it("runs discovery on mapped destination rows only and excludes fully blank mapped rows", () => {
    const mapping: ColumnMap[] = [
      { sourceColumn: "Customer ID", destinationColumn: "customer_id", sourceType: "TEXT", destType: "TEXT" },
      { sourceColumn: "Name", destinationColumn: "name", sourceType: "TEXT", destType: "TEXT" },
    ];
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": "C-1", Name: "Ada", UnmappedSecret: "secret-one" },
        { "Customer ID": "C-2", Name: "Grace", UnmappedSecret: "secret-two" },
        { "Customer ID": "", Name: " ", UnmappedSecret: "not considered" },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "APPEND",
    });

    const result = discoverUniqueColumnCombinations(
      prepared.mappedRows,
      ["customer_id", "name", "UnmappedSecret"]
    );

    expect(prepared.blankRowsSkipped).toBe(1);
    expect(result.candidates[0].columns).toEqual(["customer_id"]);
    expect(JSON.stringify(result)).not.toContain("secret-one");
  });

  it("finds the hardened Job Number + 7501 Line Number + Line Entered Value key", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { "Job Number": "J1", "7501 Line Number": "1", "Line Entered Value": "A" },
        { "Job Number": "J1", "7501 Line Number": "1", "Line Entered Value": "B" },
        { "Job Number": "J1", "7501 Line Number": "2", "Line Entered Value": "A" },
        { "Job Number": "J2", "7501 Line Number": "1", "Line Entered Value": "A" },
      ],
      ["Job Number", "7501 Line Number", "Line Entered Value"]
    );

    expect(result.candidates[0].columns).toEqual([
      "Job Number",
      "7501 Line Number",
      "Line Entered Value",
    ]);
  });
});
