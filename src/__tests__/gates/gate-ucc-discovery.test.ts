import { describe, expect, it } from "vitest";
import { discoverGateKeyCandidates } from "@/lib/gates/gate-ucc-discovery";

describe("discoverGateKeyCandidates", () => {
  it("uses UCC discovery to find a single-column unique key", async () => {
    const result = await discoverGateKeyCandidates({
      mappedRows: [
        { order_id: "A1", status: "open" },
        { order_id: "A2", status: "open" },
        { order_id: "A3", status: "closed" },
      ],
      mappedColumns: ["order_id", "status"],
      currentKeyColumns: ["status"],
      thorough: true,
    });

    expect(result.validationStats.discoveryMode).toBe("UCC");
    expect(result.candidateKeys.some((candidate) => candidate.columns.join("|") === "order_id")).toBe(true);
    expect(result.candidateKeys.every((candidate) => candidate.source === "UCC")).toBe(true);
    expect(result.noReliableKeyReason).toBeNull();
  });

  it("uses UCC discovery to find a composite unique key", async () => {
    const result = await discoverGateKeyCandidates({
      mappedRows: [
        { job_number: "J1", line_number: "1", region: "N" },
        { job_number: "J1", line_number: "2", region: "N" },
        { job_number: "J2", line_number: "1", region: "S" },
        { job_number: "J2", line_number: "2", region: "S" },
      ],
      mappedColumns: ["job_number", "line_number", "region"],
      currentKeyColumns: ["job_number"],
      thorough: true,
    });

    expect(result.validationStats.discoveryMode).toBe("UCC");
    expect(result.candidateKeys.some((candidate) =>
      sameColumns(candidate.columns, ["job_number", "line_number"])
    )).toBe(true);
    expect(result.noReliableKeyReason).toBeNull();
  });

  it("prefers the current key plus discriminator when UCC verifies it", async () => {
    const result = await discoverGateKeyCandidates({
      mappedRows: [
        { job_number: "J1", line_number: "1", line_entered_value: "A" },
        { job_number: "J1", line_number: "1", line_entered_value: "B" },
        { job_number: "J1", line_number: "2", line_entered_value: "A" },
        { job_number: "J2", line_number: "1", line_entered_value: "A" },
      ],
      mappedColumns: ["job_number", "line_number", "line_entered_value"],
      currentKeyColumns: ["job_number", "line_number"],
      thorough: true,
    });

    expect(result.candidateKeys[0]?.columns).toEqual([
      "job_number",
      "line_number",
      "line_entered_value",
    ]);
    expect(result.recommendation?.columns).toEqual([
      "job_number",
      "line_number",
      "line_entered_value",
    ]);
    expect(result.validationStats.discriminatorColumns.map((column) => column.column)).toContain(
      "line_entered_value"
    );
  });

  it("analyzes all mapped columns instead of the custom 24-column cap", async () => {
    const fillerColumns = Array.from({ length: 30 }, (_, index) => `filler_${index + 1}`);
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...Object.fromEntries(fillerColumns.map((column) => [column, "same"])),
      tail_unique_key: `row-${index + 1}`,
    }));

    const result = await discoverGateKeyCandidates({
      mappedRows: rows,
      mappedColumns: [...fillerColumns, "tail_unique_key"],
      currentKeyColumns: ["filler_1"],
      thorough: true,
    });

    expect(result.validationStats.discoveryMode).toBe("UCC");
    expect(result.validationStats.columnsAnalyzed).toBe(31);
    expect(result.validationStats.columnsConsidered).toContain("tail_unique_key");
    expect(result.candidateKeys.some((candidate) => candidate.columns.join("|") === "tail_unique_key")).toBe(true);
  });

  it("reports UCC search stats", async () => {
    const result = await discoverGateKeyCandidates({
      mappedRows: [
        { a: "1", b: "x" },
        { a: "2", b: "x" },
      ],
      mappedColumns: ["a", "b"],
      currentKeyColumns: ["b"],
      thorough: true,
    });

    expect(result.validationStats.levelsSearched).toBeGreaterThanOrEqual(1);
    expect(result.validationStats.combinationsTested).toBeGreaterThanOrEqual(1);
    expect(typeof result.validationStats.timedOut).toBe("boolean");
    expect(result.validationStats.durationMs).toBeGreaterThanOrEqual(0);
  });
});

function sameColumns(actual: string[], expected: string[]): boolean {
  return actual.map((column) => column.toLowerCase()).sort().join("|") ===
    expected.map((column) => column.toLowerCase()).sort().join("|");
}
