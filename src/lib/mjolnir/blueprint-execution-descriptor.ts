import { createHash } from "crypto";

export type BlueprintExecutionMode = "MUTABLE_LEGACY" | "PINNED_VERSION";

export interface BlueprintExecutionDescriptor {
  blueprintId: string;
  blueprintName: string;
  blueprintStatus: string;
  blueprintVersionId: string | null;
  stepsHash: string;
  executionMode: BlueprintExecutionMode;
  warning?: string;
}

export interface BlueprintExecutionDescriptorInput {
  blueprint: {
    id: string;
    name: string;
    status: string;
    steps: unknown;
  };
  blueprintVersionId?: string | null;
  stepsHash?: string | null;
  executionMode?: BlueprintExecutionMode;
}

export function getBlueprintExecutionDescriptor(
  input: BlueprintExecutionDescriptorInput
): BlueprintExecutionDescriptor {
  const executionMode = input.executionMode ?? (
    input.blueprintVersionId ? "PINNED_VERSION" : "MUTABLE_LEGACY"
  );

  const descriptor: BlueprintExecutionDescriptor = {
    blueprintId: input.blueprint.id,
    blueprintName: input.blueprint.name,
    blueprintStatus: input.blueprint.status,
    blueprintVersionId: input.blueprintVersionId ?? null,
    stepsHash: input.stepsHash ?? hashBlueprintSteps(input.blueprint.steps),
    executionMode,
  };

  const warning = buildLegacyBlueprintExecutionWarning(descriptor);
  if (warning) descriptor.warning = warning;

  return descriptor;
}

export function buildLegacyBlueprintExecutionWarning(
  descriptor: Pick<
    BlueprintExecutionDescriptor,
    "blueprintId" | "blueprintName" | "executionMode" | "stepsHash"
  >
): string | undefined {
  if (descriptor.executionMode !== "MUTABLE_LEGACY") return undefined;

  return (
    `Mutable legacy blueprint execution: "${descriptor.blueprintName}" ` +
    `(${descriptor.blueprintId}) loaded current Blueprint.steps at run time. ` +
    `stepsHash=${descriptor.stepsHash}. Future blueprint edits can change ` +
    "execution behavior until immutable version pinning is implemented."
  );
}

export function hashBlueprintSteps(steps: unknown): string {
  const normalized = Array.isArray(steps)
    ? steps.map(normalizeStepForHash)
    : normalizeForHash(steps);

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function normalizeStepForHash(step: unknown): unknown {
  if (!isPlainRecord(step)) return normalizeForHash(step);

  return {
    order: normalizeForHash(step.order),
    type: normalizeForHash(step.type),
    confidence: normalizeForHash(step.confidence),
    config: normalizeForHash(step.config ?? {}),
  };
}

function normalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!isPlainRecord(value)) return String(value);

  return Object.keys(value)
    .sort()
    .reduce((acc: Record<string, unknown>, key) => {
      acc[key] = normalizeForHash(value[key]);
      return acc;
    }, {});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
