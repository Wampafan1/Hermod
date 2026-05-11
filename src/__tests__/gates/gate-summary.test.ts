import { describe, expect, it } from "vitest";
import {
  buildGateSummary,
  formatGateKey,
  humanizeGateColumnName,
  type GateSummaryInput,
} from "@/lib/gates/gate-summary";

const normalGate: GateSummaryInput = {
  targetSchema: "public",
  targetTable: "loves_line_report",
  mergeStrategy: "UPSERT",
  primaryKeyColumns: ["job_number", "7501_line_number", "line_entered_value"],
};

describe("Gate summary", () => {
  it("builds a normal gate summary", () => {
    const summary = buildGateSummary(normalGate);

    expect(summary.overview).toBe(
      "This gate loads updated files into public.loves_line_report using UPSERT. Rows are matched by Job Number + 7501 Line Number + Line Entered Value."
    );
    expect(summary.target).toBe("public.loves_line_report");
    expect(summary.currentKey).toBe("Job Number + 7501 Line Number + Line Entered Value");
    expect(summary.mergeStrategy).toBe("UPSERT");
    expect(summary.latestPushResult).toBe("No pushes have run yet.");
  });

  it("humanizes destination key columns deterministically", () => {
    expect(humanizeGateColumnName("7501_line_number")).toBe("7501 Line Number");
    expect(formatGateKey(["job_number", "line-entered-value"])).toBe(
      "Job Number + Line Entered Value"
    );
  });

  it("explains duplicate KEY_DRIFT as requiring a stronger key", () => {
    const summary = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "KEY_DRIFT",
        keyDrift: {
          oldKey: ["job_number", "7501_line_number"],
          driftType: "DUPLICATE_KEY",
          duplicateExamples: [
            {
              keyValues: { job_number: "SNGB0097414", "7501_line_number": "0001" },
              rowIndexes: [1144, 1145],
            },
          ],
        },
      },
    });

    expect(summary.latestPushResult).toBe(
      "Hermod found duplicate rows under the current key. A stronger key is required before this file can be loaded."
    );
    expect(summary.recommendedNextAction).toBe(
      "Review the recommended key and DDL preview before approving key hardening."
    );
    expect(summary.tone).toBe("warning");
  });

  it("explains blank-key KEY_DRIFT as incomplete-row review", () => {
    const summary = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "KEY_DRIFT",
        keyDrift: {
          oldKey: ["job_number", "7501_line_number", "line_entered_value"],
          driftType: "BLANK_KEY",
          currentKeyStillUniqueForBusinessRows: true,
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
        },
      },
    });

    expect(summary.latestPushResult).toBe(
      "The current key is still unique for business rows, but some rows are missing key values. Review and exclude those rows, or fix the file."
    );
    expect(summary.recommendedNextAction).toBe(
      "Approve reviewed incomplete-row exclusion, or cancel and upload a corrected file."
    );
  });

  it("summarizes successful pushes with reviewed exclusions", () => {
    const summary = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "SUCCESS",
        rowCount: 5490,
        rowsInserted: 5480,
        rowsUpdated: 10,
        rowsErrored: 0,
        keyDrift: {
          oldKey: ["job_number"],
          incompleteRowsExcluded: 1,
        },
      },
    });

    expect(summary.latestPushResult).toBe(
      "The latest push loaded 5,490 rows successfully. 1 incomplete row was excluded after review."
    );
    expect(summary.recommendedNextAction).toBe("No review is needed for the latest push.");
    expect(summary.tone).toBe("success");
  });

  it("summarizes partial and failed pushes", () => {
    const partial = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "PARTIAL",
        rowCount: 20,
        rowsErrored: 2,
      },
    });
    const failed = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "FAILED",
        errorMessage: "Destination rejected the batch.",
      },
    });

    expect(partial.latestPushResult).toBe(
      "The latest push partially loaded. Some rows failed and Hermod did not mark it as successful."
    );
    expect(partial.tone).toBe("warning");
    expect(failed.latestPushResult).toBe("The latest push failed. Destination rejected the batch.");
    expect(failed.tone).toBe("danger");
  });

  it("does not include raw row payloads, credentials, or SQL configs", () => {
    const summary = buildGateSummary({
      ...normalGate,
      latestPush: {
        status: "FAILED",
        errorMessage: "Destination rejected the batch.",
        rawRows: [{ customer_email: "person@example.com" }],
        credentials: { password: "secret" },
        sourceConfig: { sql: "select * from private_table" },
      } as never,
    });
    const output = JSON.stringify(summary);

    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private_table");
  });
});
