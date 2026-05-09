import { describe, expect, it } from "vitest";
import { gateValidationFailureMessage } from "@/lib/gates/validation-copy";

describe("Gate validation copy", () => {
  it("adds a worker hint for validation timeouts", () => {
    expect(gateValidationFailureMessage("Gate push validation timed out.")).toBe(
      "Gate validation timed out. In development, make sure npm run worker is running in a separate terminal."
    );
  });

  it("keeps non-timeout validation errors specific", () => {
    expect(gateValidationFailureMessage("Temp file expired or missing.")).toBe(
      "Temp file expired or missing."
    );
  });
});
