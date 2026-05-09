import { describe, expect, it } from "vitest";
import {
  buildKeyDriftRecommendation,
  discoverUniqueColumnCombinations,
  validateSelectedGateKey,
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
        { customer_id: "C-1", status: "open" },
        { customer_id: null, status: "open" },
      ],
      ["customer_id", "status"]
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

  it("finds a differentiating column outside the quick top 24", () => {
    const fillerColumns = Array.from({ length: 28 }, (_, index) => `stable_number_${index + 1}`);
    const rows = [
      { job_number: "J1", line_number: "1", line_entered_value: "A" },
      { job_number: "J1", line_number: "1", line_entered_value: "B" },
      { job_number: "J2", line_number: "1", line_entered_value: "A" },
      { job_number: "J3", line_number: "1", line_entered_value: "A" },
    ].map((row) => ({
      ...Object.fromEntries(fillerColumns.map((column) => [column, "same"])),
      ...row,
    }));

    const result = discoverUniqueColumnCombinations(
      rows,
      ["job_number", "line_number", ...fillerColumns, "line_entered_value"],
      { currentKeyColumns: ["job_number", "line_number"] }
    );

    expect(result.candidates.some((candidate) =>
      candidate.columns.join("|") === "job_number|line_number|line_entered_value"
    )).toBe(true);
    expect(result.stats.discriminatorColumns.map((column) => column.column)).toContain("line_entered_value");
  });

  it("allows value and amount columns to participate in verified keys", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { job_number: "J1", line_number: "1", entered_amount: 10 },
        { job_number: "J1", line_number: "1", entered_amount: 11 },
        { job_number: "J2", line_number: "1", entered_amount: 10 },
      ],
      ["job_number", "line_number", "entered_amount"],
      { currentKeyColumns: ["job_number", "line_number"] }
    );

    expect(result.candidates.some((candidate) =>
      candidate.columns.join("|") === "job_number|line_number|entered_amount"
    )).toBe(true);
    expect(result.noReliableKeyReason).toBeNull();
  });

  it("reports capped search limits instead of false exhaustive no-key-found", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { a: "1", b: "1", c: "1" },
        { a: "1", b: "1", c: "2" },
        { a: "1", b: "2", c: "1" },
        { a: "1", b: "2", c: "2" },
        { a: "2", b: "1", c: "1" },
        { a: "2", b: "1", c: "2" },
        { a: "2", b: "2", c: "1" },
        { a: "2", b: "2", c: "2" },
      ],
      ["a", "b", "c"],
      { maxWidth: 2, maxCombinations: 100 }
    );

    expect(result.candidates).toEqual([]);
    expect(result.stats.discoveryMode).toBe("CAPPED");
    expect(result.stats.searchExhaustive).toBe(false);
    expect(result.noReliableKeyReason).toContain("current search limits");
  });

  it("validates a manually selected key against nonblank rows", () => {
    const result = validateSelectedGateKey({
      rows: [
        { job_number: "J1", line_number: "1", value: "A" },
        { job_number: "J1", line_number: "1", value: "B" },
        { job_number: "", line_number: "", value: " " },
      ],
      selectedKey: ["job_number", "line_number", "value"],
    });

    expect(result).toMatchObject({
      ok: true,
      nullCount: 0,
      duplicateCount: 0,
      duplicateExamples: [],
      nullKeyExamples: [],
    });
  });

  it("fully blank rows do not produce null-key examples during manual validation", () => {
    const result = validateSelectedGateKey({
      rows: [
        { customer_id: "C-1", name: "Ada" },
        { customer_id: " ", name: " " },
        { customer_id: "", name: "Nonblank name" },
      ],
      selectedKey: ["customer_id"],
    });

    expect(result.ok).toBe(false);
    expect(result.nullCount).toBe(1);
    expect(result.nullKeyExamples).toEqual([
      {
        rowIndex: 2,
        keyValues: { customer_id: "" },
        missingColumns: ["customer_id"],
      },
    ]);
  });

  it("only reports exhaustive no-key-found when all bounded combinations were checked", () => {
    const result = discoverUniqueColumnCombinations(
      [
        { status: "open", type: "invoice" },
        { status: "open", type: "invoice" },
      ],
      ["status", "type"],
      { maxWidth: 2 }
    );

    expect(result.stats.searchExhaustive).toBe(true);
    expect(result.stats.discoveryMode).toBe("THOROUGH");
    expect(result.noReliableKeyReason).toContain("after checking all mapped columns up to width 2");
  });
});
