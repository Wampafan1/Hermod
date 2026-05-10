const GATE_VALIDATION_TIMEOUT_MESSAGE = "Gate push validation timed out.";
const GATE_VALIDATION_HEARTBEAT_TIMEOUT_FRAGMENT =
  "The worker did not refresh validation heartbeat before the timeout.";

function isDevelopment(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "development";
}

export function gateValidationFailureMessage(
  message: string | null | undefined,
  options?: { nodeEnv?: string }
): string {
  if (message?.includes(GATE_VALIDATION_HEARTBEAT_TIMEOUT_FRAGMENT)) {
    return message;
  }

  if (message?.includes(GATE_VALIDATION_TIMEOUT_MESSAGE)) {
    if (isDevelopment(options?.nodeEnv)) {
      return "Gate validation timed out. Make sure npm run worker is running in a separate terminal.";
    }

    return "Gate validation timed out before the worker finished. Please try again. If this continues, contact support.";
  }

  return message || "Validation failed";
}

export function gateValidationWorkerProgressMessage(options?: { nodeEnv?: string }): string {
  if (isDevelopment(options?.nodeEnv)) {
    return "Validation runs in the Hermod worker. Keep npm run worker running in development.";
  }

  return "Validation runs in the Hermod worker and may take a few moments.";
}

export function gateValidationWorkerHealthMessage(options?: { nodeEnv?: string }): string {
  if (isDevelopment(options?.nodeEnv)) {
    return "Gate validation requires npm run worker in development.";
  }

  return "Gate validation is processed by the Hermod worker.";
}
