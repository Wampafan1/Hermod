import { describe, expect, it } from "vitest";
import {
  buildFinalPushMissionSummary,
  buildGatePushTimeline,
  buildKeyDriftMissionSummary,
  type MissionControlPush,
} from "@/components/gates/gate-push-mission-control";
import type { KeyDriftDetails } from "@/components/gates/key-drift-review-panel";

const baseKeyDrift: KeyDriftDetails = {
  oldKey: ["job_number", "7501_line_number"],
  driftType: "DUPLICATE_KEY",
  duplicateExamples: [
    {
      keyValues: { job_number: "SNGB0097414", "7501_line_number": "0001" },
      rowIndexes: [1144, 1145],
    },
  ],
  nullKeyExamples: [],
  reason: "Current UPSERT key has duplicate values in this upload.",
  candidateKeys: [
    {
      columns: ["job_number", "7501_line_number", "line_entered_value"],
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      coverage: 1,
      width: 3,
      score: 980,
      source: "UCC",
    },
  ],
  recommendation: {
    columns: ["job_number", "7501_line_number", "line_entered_value"],
    source: "DETERMINISTIC",
    reason: "Verified UCC extends the failed current key.",
  },
};

function cardValue(cards: Array<{ label: string; value: string }>, label: string): string {
  const card = cards.find((candidate) => candidate.label === label);
  if (!card) throw new Error(`Missing card ${label}`);
  return card.value;
}

describe("Gate Push Mission Control helpers", () => {
  it("builds a validating timeline with the active validation stage", () => {
    const timeline = buildGatePushTimeline(
      {
        id: "push_1",
        fileName: "loves-2025.xlsx",
        status: "VALIDATING",
        createdAt: "2026-05-11T12:00:00.000Z",
        validationStage: "ANALYZING_FILE",
        validationStartedAt: "2026-05-11T12:00:00.000Z",
        validationHeartbeatAt: "2026-05-11T12:00:10.000Z",
      },
      Date.parse("2026-05-11T12:00:30.000Z")
    );

    expect(timeline.map((stage) => stage.label)).toEqual([
      "Upload staged",
      "File analyzed",
      "Schema checked",
      "Key checked",
      "Review or ready",
      "Final result",
    ]);
    expect(timeline.find((stage) => stage.id === "file")).toMatchObject({
      state: "active",
      detail: expect.stringContaining("Current stage: Analyzing file"),
    });
    expect(timeline.find((stage) => stage.id === "schema")?.state).toBe("pending");
  });

  it("summarizes duplicate key drift as key hardening required", () => {
    const cards = buildKeyDriftMissionSummary(baseKeyDrift, 2);

    expect(cardValue(cards, "Drift type")).toBe("Duplicate Key");
    expect(cardValue(cards, "Recommended action")).toBe("Harden destination key");
    expect(cardValue(cards, "Candidate count")).toBe("1");
    expect(cardValue(cards, "Blank rows skipped")).toBe("2");
    expect(cardValue(cards, "DDL required")).toBe("Yes");
    expect(cardValue(cards, "Current key can be kept")).toBe("No");
  });

  it("summarizes blank-only key drift as keeping the current key", () => {
    const cards = buildKeyDriftMissionSummary(
      {
        ...baseKeyDrift,
        driftType: "BLANK_KEY",
        duplicateExamples: [],
        nullKeyExamples: [
          {
            rowIndex: 5491,
            keyValues: {
              job_number: "",
              "7501_line_number": "",
              line_entered_value: "22901728",
            },
            missingColumns: ["job_number", "7501_line_number"],
          },
        ],
        candidateKeys: [],
        recommendation: null,
        currentKeyStillUniqueForBusinessRows: true,
        requiresIncompleteRowApproval: true,
        incompleteRowsHeld: 1,
        recommendedAction: "REVIEW_INCOMPLETE_ROWS",
      },
      1
    );

    expect(cardValue(cards, "Recommended action")).toBe("Review incomplete rows");
    expect(cardValue(cards, "Incomplete rows held")).toBe("1");
    expect(cardValue(cards, "DDL required")).toBe("No");
    expect(cardValue(cards, "Current key can be kept")).toBe("Yes");
  });

  it("summarizes successful push row counts", () => {
    const cards = buildFinalPushMissionSummary({
      id: "push_2",
      fileName: "loves-2025.xlsx",
      status: "SUCCESS",
      rowsInserted: 10,
      rowsUpdated: 42,
      rowsErrored: 0,
      blankRowsSkipped: 1,
      duration: 1525,
      keyDrift: {
        ...baseKeyDrift,
        incompleteRowsExcluded: 1,
      } as KeyDriftDetails & { incompleteRowsExcluded: number },
    });

    expect(cardValue(cards, "Rows inserted")).toBe("10");
    expect(cardValue(cards, "Rows updated")).toBe("42");
    expect(cardValue(cards, "Rows errored")).toBe("0");
    expect(cardValue(cards, "Blank rows skipped")).toBe("1");
    expect(cardValue(cards, "Incomplete rows excluded")).toBe("1");
    expect(cardValue(cards, "Duration")).toBe("1.5s");
  });

  it("renders failed status with a safe error and ignores raw row payload fields", () => {
    const push = {
      id: "push_3",
      fileName: "loves-2025.xlsx",
      status: "FAILED",
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsErrored: 5,
      blankRowsSkipped: 0,
      duration: 900,
      errorMessage: "Provider rejected the batch after validation.",
      rawRows: [{ customer_email: "person@example.com" }],
      credentials: { password: "secret" },
      sourceConfig: { sql: "select * from private_table" },
    } as MissionControlPush & {
      rawRows: unknown[];
      credentials: unknown;
      sourceConfig: unknown;
    };

    const cards = buildFinalPushMissionSummary(push);
    const output = JSON.stringify(cards);

    expect(cardValue(cards, "Rows errored")).toBe("5");
    expect(cardValue(cards, "Failure")).toBe("Provider rejected the batch after validation.");
    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private_table");
  });
});
