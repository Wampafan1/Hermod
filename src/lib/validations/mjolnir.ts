import { z } from "zod";

export const MAX_BLUEPRINT_STEPS = 100;
export const MAX_STEP_CONFIG_DEPTH = 8;
export const MAX_STEP_CONFIG_JSON_BYTES = 250_000;
export const MAX_ANALYSIS_LOG_JSON_BYTES = 500_000;
export const MAX_AFTER_FORMATTING_JSON_BYTES = 500_000;
export const MAX_BLUEPRINT_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_UPLOAD_ROWS_FOR_ANALYSIS = 10_000;
export const MAX_UPLOAD_COLUMNS_FOR_ANALYSIS = 500;

const MAX_JSON_OBJECT_KEYS = 10_000;
const MAX_JSON_ARRAY_ITEMS = 10_000;
const MAX_METADATA_JSON_DEPTH = 16;
const MAX_ROLLBACK_VERSION = 1_000_000;
const MAX_ROLLBACK_REASON_LENGTH = 1000;

type JsonGuardResult = { ok: true } | { ok: false; error: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function guardJsonValue(
  value: unknown,
  options: { maxDepth: number; maxBytes: number; label: string }
): JsonGuardResult {
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number): JsonGuardResult {
    if (depth > options.maxDepth) {
      return { ok: false, error: `${options.label} exceeds maximum depth of ${options.maxDepth}` };
    }

    if (current === null) return { ok: true };

    const valueType = typeof current;
    if (valueType === "string" || valueType === "boolean") return { ok: true };
    if (valueType === "number") {
      return Number.isFinite(current)
        ? { ok: true }
        : { ok: false, error: `${options.label} contains a non-finite number` };
    }

    if (Array.isArray(current)) {
      if (current.length > MAX_JSON_ARRAY_ITEMS) {
        return { ok: false, error: `${options.label} contains too many array items` };
      }
      if (seen.has(current)) {
        return { ok: false, error: `${options.label} contains circular references` };
      }
      seen.add(current);
      for (const item of current) {
        const result = visit(item, depth + 1);
        if (!result.ok) return result;
      }
      return { ok: true };
    }

    if (isPlainRecord(current)) {
      const entries = Object.entries(current);
      if (entries.length > MAX_JSON_OBJECT_KEYS) {
        return { ok: false, error: `${options.label} contains too many object keys` };
      }
      if (seen.has(current)) {
        return { ok: false, error: `${options.label} contains circular references` };
      }
      seen.add(current);
      for (const [, item] of entries) {
        const result = visit(item, depth + 1);
        if (!result.ok) return result;
      }
      return { ok: true };
    }

    return { ok: false, error: `${options.label} must contain JSON-compatible values only` };
  }

  const structural = visit(value, 0);
  if (!structural.ok) return structural;

  const byteLength = jsonByteLength(value);
  if (byteLength > options.maxBytes) {
    return { ok: false, error: `${options.label} exceeds maximum JSON size of ${options.maxBytes} bytes` };
  }

  return { ok: true };
}

function jsonRecordSchema(label: string, maxBytes: number, maxDepth = MAX_METADATA_JSON_DEPTH) {
  return z.custom<Record<string, unknown>>(
    (value) => isPlainRecord(value),
    { message: `${label} must be a JSON object` }
  ).superRefine((value, ctx) => {
    const result = guardJsonValue(value, { label, maxBytes, maxDepth });
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
    }
  });
}

const stepConfigSchema = jsonRecordSchema(
  "Step config",
  MAX_STEP_CONFIG_JSON_BYTES,
  MAX_STEP_CONFIG_DEPTH
);

const validationEvidenceSchema = z.object({
  passed: z.boolean(),
  overallMatchRate: z.number().min(0).max(1),
});

// ForgeStep validation
export const forgeStepSchema = z.object({
  stepId: z.string().optional(),
  order: z.number().int().min(0),
  type: z.enum([
    "remove_columns",
    "rename_columns",
    "reorder_columns",
    "filter_rows",
    "format",
    "calculate",
    "sort",
    "deduplicate",
    "aggregate",
    "split_column",
    "merge_columns",
    "lookup",
    "pivot",
    "unpivot",
    "custom_sql",
  ]),
  confidence: z.number().min(0).max(1),
  config: stepConfigSchema,
  description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),
});

export const createBlueprintSchema = z.object({
  name: z.string().trim().min(1, "Blueprint name is required").max(MAX_BLUEPRINT_NAME_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  steps: z.array(forgeStepSchema)
    .min(1, "At least one step is required")
    .max(MAX_BLUEPRINT_STEPS, `Blueprints can contain at most ${MAX_BLUEPRINT_STEPS} steps`),
  sourceSchema: jsonRecordSchema("Source schema", MAX_ANALYSIS_LOG_JSON_BYTES).optional(),
  analysisLog: jsonRecordSchema("Analysis log", MAX_ANALYSIS_LOG_JSON_BYTES).optional(),
  afterFormatting: jsonRecordSchema("After formatting", MAX_AFTER_FORMATTING_JSON_BYTES).optional(),
  beforeSample: z.string().nullable().optional(),
  afterSample: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "VALIDATED", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  validation: validationEvidenceSchema.optional(),
});

export const updateBlueprintSchema = z.object({
  name: z.string().trim().min(1).max(MAX_BLUEPRINT_NAME_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().nullable(),
  steps: z.array(forgeStepSchema)
    .min(1)
    .max(MAX_BLUEPRINT_STEPS, `Blueprints can contain at most ${MAX_BLUEPRINT_STEPS} steps`)
    .optional(),
  sourceSchema: jsonRecordSchema("Source schema", MAX_ANALYSIS_LOG_JSON_BYTES).optional().nullable(),
  analysisLog: jsonRecordSchema("Analysis log", MAX_ANALYSIS_LOG_JSON_BYTES).optional().nullable(),
  afterFormatting: jsonRecordSchema("After formatting", MAX_AFTER_FORMATTING_JSON_BYTES).optional().nullable(),
  beforeSample: z.string().optional().nullable(),
  afterSample: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "VALIDATED", "ACTIVE", "ARCHIVED"]).optional(),
  validation: validationEvidenceSchema.optional(),
});

export const detachBlueprintSchema = z.object({
  type: z.enum(["report", "bifrost_route"]),
  targetId: z.string().min(1),
});

export const analyzeSchema = z.object({
  beforeFileId: z.string().uuid("Invalid before file ID"),
  afterFileId: z.string().uuid("Invalid after file ID"),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
});

export const validateSchema = z.object({
  steps: z.array(forgeStepSchema)
    .min(1, "At least one step is required")
    .max(MAX_BLUEPRINT_STEPS, `Blueprints can contain at most ${MAX_BLUEPRINT_STEPS} steps`),
  beforeFileId: z.string().uuid("Invalid before file ID"),
  afterFileId: z.string().uuid("Invalid after file ID"),
  mode: z.enum(["pattern", "strict"]).optional().default("pattern"),
});

export const rollbackBlueprintSchema = z.object({
  targetVersion: z.number()
    .int("targetVersion must be an integer")
    .min(1, "targetVersion must be at least 1")
    .max(MAX_ROLLBACK_VERSION, `targetVersion must be ${MAX_ROLLBACK_VERSION} or lower`),
  reason: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(MAX_ROLLBACK_REASON_LENGTH).optional()
  ),
});

export function validateParsedFileAnalysisLimits(input: {
  columns: unknown[];
  rowCount: number;
  label?: string;
}): { ok: true } | { ok: false; error: string } {
  const label = input.label ?? "Workbook";

  if (input.columns.length > MAX_UPLOAD_COLUMNS_FOR_ANALYSIS) {
    return {
      ok: false,
      error: `${label} has ${input.columns.length} columns; Mjolnir analysis supports at most ${MAX_UPLOAD_COLUMNS_FOR_ANALYSIS}.`,
    };
  }

  if (input.rowCount > MAX_UPLOAD_ROWS_FOR_ANALYSIS) {
    return {
      ok: false,
      error: `${label} has ${input.rowCount} rows; Mjolnir analysis supports at most ${MAX_UPLOAD_ROWS_FOR_ANALYSIS}.`,
    };
  }

  return { ok: true };
}

// Export inferred types
export type CreateBlueprintInput = z.infer<typeof createBlueprintSchema>;
export type UpdateBlueprintInput = z.infer<typeof updateBlueprintSchema>;
export type DetachBlueprintInput = z.infer<typeof detachBlueprintSchema>;
export type AnalyzeInput = z.infer<typeof analyzeSchema>;
export type ValidateInput = z.infer<typeof validateSchema>;
export type RollbackBlueprintInput = z.infer<typeof rollbackBlueprintSchema>;
