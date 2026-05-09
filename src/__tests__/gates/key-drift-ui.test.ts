import { describe, expect, it } from "vitest";
import {
  buildResolvePayload,
  canApproveKeyHardening,
  formatBlankRowsSkipped,
  formatDuplicateExample,
  getDiscoveryDiagnostics,
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
  });

  it("falls back to the first candidate when recommendation is unavailable", () => {
    const candidate = selectDefaultCandidate({
      ...baseKeyDrift,
      recommendation: null,
    });

    expect(candidate?.columns).toEqual(["job_number", "line_number", "line_value"]);
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
    ).toBe("No null-free unique column combination was found.");

    expect(formatBlankRowsSkipped(2)).toBe("2 fully blank mapped rows were skipped and counted.");
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
