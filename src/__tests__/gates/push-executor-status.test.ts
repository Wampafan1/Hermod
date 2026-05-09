import { describe, expect, it } from "vitest";
import { derivePushStatus } from "@/lib/gates/push-executor";

describe("gate push executor status", () => {
  it("never returns SUCCESS when rowsErrored is greater than zero", () => {
    expect(derivePushStatus({ attemptedRows: 10, rowsErrored: 1 })).not.toBe("SUCCESS");
    expect(derivePushStatus({ attemptedRows: 10, rowsErrored: 10 })).not.toBe("SUCCESS");
  });

  it("marks all-row errors as FAILED", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 4 })).toBe("FAILED");
  });

  it("marks mixed success and errors as PARTIAL", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 2 })).toBe("PARTIAL");
  });

  it("marks zero row errors as SUCCESS", () => {
    expect(derivePushStatus({ attemptedRows: 4, rowsErrored: 0 })).toBe("SUCCESS");
  });
});
