import { describe, expect, it } from "vitest";
import {
  buildResolvePayload,
  canApproveKeyHardening,
  formatBlankRowsSkipped,
  formatDuplicateExample,
  getDefaultManualSelection,
  getDiscoveryDiagnostics,
  getMappedColumnsForManualSelection,
  formatKeyDriftReason,
  formatNullKeyExample,
  getNoReliableKeyMessage,
  selectDefaultCandidate,
  type KeyDriftDetails,
} from "@/components/gates/key-drift-review-panel";

const baseKeyDrift: KeyDriftDetails = {
  oldKey: ["job_number", "line_number"],
  reason: "Current UPSERT key has duplicate values in this upload.",
  candidateKeys: [
    {
      columns: ["job_number", "line_number", "line_value"],
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      coverage: 1,
      width: 3,
      score: 980,
    },
    {
      columns: ["job_number", "line_value", "entered_at"],
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      coverage: 1,
      width: 3,
      score: 900,
    },
  ],
  recommendation: {
    columns: ["job_number", "line_number", "line_value"],
    source: "DETERMINISTIC",
    reason: "Selected verified composite key.",
  },
  mappedColumns: [
    {
      name: "job_number",
      sourceColumn: "Job Number",
      destinationColumn: "job_number",
      nonBlankCount: 2,
      nullCount: 0,
      distinctCount: 1,
      isCurrentKey: true,
      isDiscriminator: false,
    },
    {
      name: "line_number",
      sourceColumn: "Line Number",
      destinationColumn: "line_number",
      nonBlankCount: 2,
      nullCount: 0,
      distinctCount: 1,
      isCurrentKey: true,
      isDiscriminator: false,
    },
    {
      name: "line_value",
      sourceColumn: "Line Value",
      destinationColumn: "line_value",
      nonBlankCount: 2,
      nullCount: 0,
      distinctCount: 2,
      isCurrentKey: false,
      isDiscriminator: true,
    },
  ],
};

describe("Gate key drift UI helpers", () => {
  it("formats duplicate and null examples safely", () => {
    const duplicate = formatDuplicateExample({
      keyValues: { job_number: "J1", line_number: "1" },
      rowIndexes: [2, 7],
      fullRow: { secret_customer_email: "person@example.com" },
    } as never);
    const blank = formatNullKeyExample({
      rowIndex: 4,
      missingColumns: ["line_number"],
      keyValues: { job_number: "J2", line_number: "" },
      fullRow: { secret_customer_email: "person@example.com" },
    } as never);

    expect(duplicate).toBe("Rows 2, 7 - job_number=J1, line_number=1");
    expect(blank).toBe("Row 4 - missing line_number - job_number=J2, line_number=blank");
    expect(`${duplicate} ${blank}`).not.toContain("person@example.com");
  });

  it("selects the recommendation by default", () => {
    expect(selectDefaultCandidate(baseKeyDrift)?.columns).toEqual([
      "job_number",
      "line_number",
      "line_value",
    ]);
    expect(getDefaultManualSelection(baseKeyDrift)).toEqual([
      "job_number",
      "line_number",
      "line_value",
    ]);
  });

  it("falls back to the current key for manual selection when recommendation is unavailable", () => {
    const candidate = selectDefaultCandidate({
      ...baseKeyDrift,
      recommendation: null,
    });

    expect(candidate?.columns).toEqual(["job_number", "line_number", "line_value"]);
    expect(
      getDefaultManualSelection({
        ...baseKeyDrift,
        recommendation: null,
      })
    ).toEqual(["job_number", "line_number"]);
  });

  it("keeps approve disabled until confirmed and nonblocked DDL is loaded", () => {
    expect(
      canApproveKeyHardening({
        selectedKey: ["job_number"],
        ddlPreview: {
          selectedKey: ["job_number"],
          ddl: ['ALTER TABLE "public"."orders" ADD CONSTRAINT "x" UNIQUE ("job_number");'],
          warnings: [],
          blocked: false,
          requiresConfirmation: true,
        },
        approvalChecked: false,
        loading: false,
      })
    ).toBe(false);

    expect(
      canApproveKeyHardening({
        selectedKey: ["job_number"],
        ddlPreview: {
          selectedKey: ["job_number"],
          ddl: ['ALTER TABLE "public"."orders" ADD CONSTRAINT "x" UNIQUE ("job_number");'],
          warnings: [],
          blocked: false,
          requiresConfirmation: true,
          manualValidation: {
            ok: false,
            nullCount: 0,
            duplicateCount: 1,
            duplicateExamples: [{ keyValues: { job_number: "J1" }, rowIndexes: [1, 2] }],
            nullKeyExamples: [],
          },
        },
        approvalChecked: true,
        loading: false,
      })
    ).toBe(false);

    expect(
      canApproveKeyHardening({
        selectedKey: ["job_number"],
        ddlPreview: {
          selectedKey: ["job_number"],
          ddl: ['ALTER TABLE "public"."orders" ADD CONSTRAINT "x" UNIQUE ("job_number");'],
          warnings: [],
          blocked: true,
          blockReason: "Foreign key dependency detected.",
          requiresConfirmation: true,
        },
        approvalChecked: true,
        loading: false,
      })
    ).toBe(false);

    expect(
      canApproveKeyHardening({
        selectedKey: ["job_number"],
        ddlPreview: {
          selectedKey: ["job_number"],
          ddl: ['ALTER TABLE "public"."orders" ADD CONSTRAINT "x" UNIQUE ("job_number");'],
          warnings: [],
          blocked: false,
          requiresConfirmation: true,
        },
        approvalChecked: true,
        loading: false,
      })
    ).toBe(true);
  });

  it("renders no reliable key and blank row messages", () => {
    expect(
      getNoReliableKeyMessage({
        oldKey: ["job_number"],
        reason: "",
        candidateKeys: [],
        noReliableKeyReason: "No null-free unique column combination was found.",
      })
    ).toBe("No null-free unique column combination was found. Select columns manually to validate a key.");

    expect(formatBlankRowsSkipped(2)).toBe("2 fully blank mapped rows were skipped and counted.");
  });

  it("exposes mapped columns for manual selection without raw rows", () => {
    const columns = getMappedColumnsForManualSelection({
      ...baseKeyDrift,
      mappedColumns: [
        ...baseKeyDrift.mappedColumns!,
        {
          name: "secret_value",
          sourceColumn: "Secret Value",
          destinationColumn: "secret_value",
          nonBlankCount: 2,
          nullCount: 0,
          distinctCount: 2,
          isCurrentKey: false,
          isDiscriminator: false,
          fullRows: [{ customerEmail: "person@example.com" }],
        } as never,
      ],
    });

    expect(columns.map((column) => column.destinationColumn)).toContain("secret_value");
    expect(JSON.stringify(columns)).not.toContain("person@example.com");
  });

  it("builds the reviewed resolve payload", () => {
    expect(
      buildResolvePayload(["job_number", "line_number"], ["ALTER TABLE example;"])
    ).toEqual({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["job_number", "line_number"],
      confirmedDdl: ["ALTER TABLE example;"],
      confirm: true,
    });
  });

  it("exposes discovery diagnostics without raw rows", () => {
    const diagnostics = getDiscoveryDiagnostics({
      ...baseKeyDrift,
      discoveryMode: "CAPPED",
      searchExhaustive: false,
      columnsConsidered: ["job_number", "line_number", "line_value"],
      discriminatorColumns: [
        {
          column: "line_value",
          duplicateGroupsSeparated: 2,
          nullCount: 0,
          distinctCount: 3,
          rawRows: [{ secret: "hidden" }],
        } as never,
      ],
      candidateSearchLimits: {
        maxWidth: 6,
        maxColumns: 3,
        maxCombinations: 10,
        combinationsTested: 10,
      },
    });

    expect(diagnostics.discoveryMode).toBe("CAPPED");
    expect(diagnostics.searchExhaustive).toBe(false);
    expect(diagnostics.columnsConsidered).toHaveLength(3);
    expect(JSON.stringify(diagnostics)).not.toContain("hidden");
  });

  it("formats fallback reason without raw row values", () => {
    const reason = formatKeyDriftReason({
      oldKey: ["job_number"],
      reason: "",
      duplicateExamples: [
        {
          keyValues: { job_number: "J1" },
          rowIndexes: [1, 2],
          row: { sensitive_value: "hidden" },
        } as never,
      ],
    });

    expect(reason).toBe("The current key has duplicate values in this upload.");
    expect(reason).not.toContain("hidden");
  });
});
