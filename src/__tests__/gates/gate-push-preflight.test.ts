import { describe, expect, it } from "vitest";
import {
  prepareMappedRowsForPush,
  preflightUpsertKey,
  type ColumnMap,
} from "@/lib/gates/push-executor";

const mapping: ColumnMap[] = [
  { sourceColumn: "Customer ID", destinationColumn: "customer_id", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "Name", destinationColumn: "name", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "Email", destinationColumn: "email", sourceType: "TEXT", destType: "TEXT" },
];

describe("gate push key preflight", () => {
  it("skips fully blank mapped rows and counts them", () => {
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": "C-1", Name: "Ada", Email: "ada@example.com" },
        { "Customer ID": "   ", Name: "", Email: null },
        { "Customer ID": undefined, Name: undefined, Email: undefined },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "APPEND",
    });

    expect(prepared.blankRowsSkipped).toBe(2);
    expect(prepared.mappedRows).toEqual([
      { customer_id: "C-1", name: "Ada", email: "ada@example.com" },
    ]);
    expect(prepared.keyDrift).toBeUndefined();
  });

  it("treats nonblank rows with blank current-key values as KEY_DRIFT", () => {
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": "", Name: "Ada", Email: "ada@example.com" },
        { "Customer ID": "C-2", Name: "Grace", Email: "grace@example.com" },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "UPSERT",
    });

    expect(prepared.blankRowsSkipped).toBe(0);
    expect(prepared.keyDrift?.oldKey).toEqual(["customer_id"]);
    expect(prepared.keyDrift?.nullKeyExamples).toEqual([
      {
        rowIndex: 1,
        keyValues: { customer_id: "" },
        missingColumns: ["customer_id"],
      },
    ]);
  });

  it("detects duplicate current-key combinations before UPSERT", () => {
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": "C-1", Name: "Ada", Email: "ada@example.com" },
        { "Customer ID": "C-1", Name: "Ada Updated", Email: "secret@example.com" },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "UPSERT",
    });

    expect(prepared.keyDrift?.duplicateExamples).toEqual([
      {
        keyValues: { customer_id: "C-1" },
        rowIndexes: [1, 2],
      },
    ]);
    expect(JSON.stringify(prepared.keyDrift)).not.toContain("secret@example.com");
    expect(JSON.stringify(prepared.keyDrift)).not.toContain("Ada Updated");
  });

  it("does not report fully blank mapped rows as blank current-key examples", () => {
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": " ", Name: "", Email: null },
        { "Customer ID": "", Name: "Ada", Email: "ada@example.com" },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "UPSERT",
    });

    expect(prepared.blankRowsSkipped).toBe(1);
    expect(prepared.keyDrift?.nullKeyExamples).toEqual([
      {
        rowIndex: 2,
        keyValues: { customer_id: "" },
        missingColumns: ["customer_id"],
      },
    ]);
  });

  it("passes UPSERT preflight when current-key combinations are unique and nonblank", () => {
    const prepared = prepareMappedRowsForPush({
      rows: [
        { "Customer ID": "C-1", Name: "Ada", Email: "ada@example.com" },
        { "Customer ID": "C-2", Name: "Grace", Email: "grace@example.com" },
      ],
      columnMapping: mapping,
      primaryKeyColumns: ["Customer ID"],
      mergeStrategy: "UPSERT",
    });

    expect(prepared.keyDrift).toBeUndefined();
    expect(prepared.mappedRows).toHaveLength(2);
  });

  it("limits duplicate and blank-key examples to safe key fields and row indexes", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      row: { customer_id: index % 2 === 0 ? "DUP" : "", name: `Sensitive ${index}` },
      rowIndex: index + 1,
    }));

    const result = preflightUpsertKey({
      primaryKeyColumns: ["customer_id"],
      rows,
      maxExamples: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.keyDrift.duplicateExamples).toHaveLength(1);
      expect(result.keyDrift.nullKeyExamples).toHaveLength(2);
      expect(JSON.stringify(result.keyDrift)).not.toContain("Sensitive");
    }
  });

  it("does not run key drift preflight for APPEND or TRUNCATE_RELOAD", () => {
    for (const mergeStrategy of ["APPEND", "TRUNCATE_RELOAD"]) {
      const prepared = prepareMappedRowsForPush({
        rows: [
          { "Customer ID": "", Name: "Ada", Email: "ada@example.com" },
          { "Customer ID": "", Name: "Grace", Email: "grace@example.com" },
          { "Customer ID": "", Name: "", Email: " " },
        ],
        columnMapping: mapping,
        primaryKeyColumns: ["Customer ID"],
        mergeStrategy,
      });

      expect(prepared.blankRowsSkipped).toBe(1);
      expect(prepared.mappedRows).toHaveLength(2);
      expect(prepared.keyDrift).toBeUndefined();
    }
  });
});
