import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type GatePushValidationStage =
  | "RECEIVED"
  | "READING_FILE"
  | "ANALYZING_FILE"
  | "VALIDATING_SCHEMA"
  | "CHECKING_KEY"
  | "DISCOVERING_KEY"
  | "READY"
  | "FAILED";

export interface GatePushValidationDetails {
  validationStage?: GatePushValidationStage;
  validationStartedAt?: string;
  validationHeartbeatAt?: string;
  validationTimeoutAt?: string;
  validationError?: string;
}

export interface GatePushValidationLike {
  id: string;
  status: string;
  createdAt: Date;
  errorDetails?: unknown;
}

const DEFAULT_GATE_PUSH_VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;

export function getGatePushValidationTimeoutMs(): number {
  const raw = Number(process.env.GATE_PUSH_VALIDATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_GATE_PUSH_VALIDATION_TIMEOUT_MS;
}

export function getGatePushValidationDetails(errorDetails: unknown): GatePushValidationDetails {
  if (!isPlainObject(errorDetails)) return {};
  const details = errorDetails.gateValidation;
  if (!isPlainObject(details)) return {};

  return {
    validationStage: isGatePushValidationStage(details.validationStage)
      ? details.validationStage
      : undefined,
    validationStartedAt: typeof details.validationStartedAt === "string"
      ? details.validationStartedAt
      : undefined,
    validationHeartbeatAt: typeof details.validationHeartbeatAt === "string"
      ? details.validationHeartbeatAt
      : undefined,
    validationTimeoutAt: typeof details.validationTimeoutAt === "string"
      ? details.validationTimeoutAt
      : undefined,
    validationError: typeof details.validationError === "string"
      ? details.validationError
      : undefined,
  };
}

export function inferGatePushValidationStage(input: {
  status: string;
  errorDetails?: unknown;
}): GatePushValidationStage | null {
  const details = getGatePushValidationDetails(input.errorDetails);
  if (details.validationStage) return details.validationStage;
  if (input.status === "VALIDATING") return "RECEIVED";
  if (input.status === "FAILED") return "FAILED";
  if (["VALIDATED", "SCHEMA_DRIFT", "KEY_DRIFT"].includes(input.status)) return "READY";
  return null;
}

export function buildGatePushValidationErrorDetails(input: {
  stage: GatePushValidationStage;
  now?: Date;
  startedAt?: Date | string;
  validationError?: string | null;
}): Prisma.InputJsonValue {
  const now = input.now ?? new Date();
  const startedAt = typeof input.startedAt === "string"
    ? input.startedAt
    : (input.startedAt ?? now).toISOString();
  const timeoutAt = new Date(
    new Date(startedAt).getTime() + getGatePushValidationTimeoutMs()
  ).toISOString();

  return {
    gateValidation: {
      validationStage: input.stage,
      validationStartedAt: startedAt,
      validationHeartbeatAt: now.toISOString(),
      validationTimeoutAt: timeoutAt,
      ...(input.validationError ? { validationError: input.validationError } : {}),
    },
  };
}

export async function updateGatePushValidationStage(input: {
  pushId: string;
  stage: GatePushValidationStage;
  startedAt?: Date | string;
}): Promise<void> {
  await prisma.gatePush.update({
    where: { id: input.pushId },
    data: {
      errorDetails: buildGatePushValidationErrorDetails({
        stage: input.stage,
        startedAt: input.startedAt,
      }),
    },
  });
}

export function isGatePushValidationStale(
  push: GatePushValidationLike,
  now = new Date()
): boolean {
  if (push.status !== "VALIDATING") return false;

  const details = getGatePushValidationDetails(push.errorDetails);
  const baseline = details.validationHeartbeatAt ?? details.validationStartedAt;
  const baselineMs = baseline ? Date.parse(baseline) : push.createdAt.getTime();
  if (!Number.isFinite(baselineMs)) {
    return now.getTime() - push.createdAt.getTime() > getGatePushValidationTimeoutMs();
  }

  return now.getTime() - baselineMs > getGatePushValidationTimeoutMs();
}

export async function markStaleGatePushValidationFailed(
  pushId: string,
  now = new Date(),
  scope?: { gateId?: string; tenantId?: string }
): Promise<boolean> {
  const push = await prisma.gatePush.findFirst({
    where: {
      id: pushId,
      ...(scope?.gateId ? { gateId: scope.gateId } : {}),
      ...(scope?.tenantId ? { tenantId: scope.tenantId } : {}),
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      errorDetails: true,
    },
  });

  if (!push || !isGatePushValidationStale(push, now)) return false;

  await prisma.gatePush.update({
    where: { id: pushId },
    data: {
      status: "FAILED",
      errorMessage: "Gate push validation timed out.",
      errorDetails: buildGatePushValidationErrorDetails({
        stage: "FAILED",
        now,
        startedAt: getGatePushValidationDetails(push.errorDetails).validationStartedAt ?? push.createdAt,
        validationError: "Gate push validation timed out.",
      }),
      completedAt: now,
    },
  });
  return true;
}

export async function markStaleGatePushValidationsFailed(
  now = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - getGatePushValidationTimeoutMs());
  const result = await prisma.gatePush.updateMany({
    where: {
      status: "VALIDATING",
      createdAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      errorMessage: "Gate push validation timed out.",
      errorDetails: buildGatePushValidationErrorDetails({
        stage: "FAILED",
        now,
        startedAt: cutoff,
        validationError: "Gate push validation timed out.",
      }),
      completedAt: now,
    },
  });

  return result.count;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGatePushValidationStage(value: unknown): value is GatePushValidationStage {
  return (
    value === "RECEIVED" ||
    value === "READING_FILE" ||
    value === "ANALYZING_FILE" ||
    value === "VALIDATING_SCHEMA" ||
    value === "CHECKING_KEY" ||
    value === "DISCOVERING_KEY" ||
    value === "READY" ||
    value === "FAILED"
  );
}
