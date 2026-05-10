import { describe, expect, it } from "vitest";
import {
  gateValidationFailureMessage,
  gateValidationWorkerHealthMessage,
  gateValidationWorkerProgressMessage,
} from "@/lib/gates/validation-copy";

describe("Gate validation copy", () => {
  it("uses production-safe copy for validation timeouts by default", () => {
    expect(gateValidationFailureMessage("Gate push validation timed out.")).toBe(
      "Gate validation timed out before the worker finished. Please try again. If this continues, contact support."
    );
  });

  it("adds a worker command hint only in development", () => {
    expect(
      gateValidationFailureMessage("Gate push validation timed out.", { nodeEnv: "development" })
    ).toBe(
      "Gate validation timed out. Make sure npm run worker is running in a separate terminal."
    );
  });

  it("keeps non-timeout validation errors specific", () => {
    expect(gateValidationFailureMessage("Temp file expired or missing.")).toBe(
      "Temp file expired or missing."
    );
  });

  it("keeps worker progress and health copy environment-aware", () => {
    expect(gateValidationWorkerProgressMessage()).toBe(
      "Validation runs in the Hermod worker and may take a few moments."
    );
    expect(gateValidationWorkerHealthMessage()).toBe(
      "Gate validation is processed by the Hermod worker."
    );
    expect(gateValidationWorkerProgressMessage({ nodeEnv: "development" })).toContain(
      "npm run worker"
    );
    expect(gateValidationWorkerHealthMessage({ nodeEnv: "development" })).toContain(
      "npm run worker"
    );
  });
});
