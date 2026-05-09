const GATE_VALIDATION_TIMEOUT_MESSAGE = "Gate push validation timed out.";

export function gateValidationFailureMessage(message: string | null | undefined): string {
  if (message?.includes(GATE_VALIDATION_TIMEOUT_MESSAGE)) {
    return "Gate validation timed out. In development, make sure npm run worker is running in a separate terminal.";
  }

  return message || "Validation failed";
}
