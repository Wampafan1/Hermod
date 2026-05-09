import { z } from "zod";

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
  config: z.record(z.unknown()),
  description: z.string().min(1),
});

export const createBlueprintSchema = z.object({
  name: z.string().min(1, "Blueprint name is required").max(200),
  description: z.string().max(2000).optional(),
  steps: z.array(forgeStepSchema).min(1, "At least one step is required"),
  sourceSchema: z.record(z.unknown()).optional(),
  analysisLog: z.record(z.unknown()).optional(),
  afterFormatting: z.record(z.unknown()).optional(),
  beforeSample: z.string().nullable().optional(),
  afterSample: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "VALIDATED", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  validation: z.object({
    passed: z.boolean(),
    overallMatchRate: z.number(),
  }).optional(),
});

export const updateBlueprintSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  steps: z.array(forgeStepSchema).min(1).optional(),
  sourceSchema: z.record(z.unknown()).optional().nullable(),
  analysisLog: z.record(z.unknown()).optional().nullable(),
  afterFormatting: z.record(z.unknown()).optional().nullable(),
  beforeSample: z.string().optional().nullable(),
  afterSample: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "VALIDATED", "ACTIVE", "ARCHIVED"]).optional(),
  validation: z.object({
    passed: z.boolean(),
    overallMatchRate: z.number(),
  }).optional(),
});

export const detachBlueprintSchema = z.object({
  type: z.enum(["report", "bifrost_route"]),
  targetId: z.string().min(1),
});

export const analyzeSchema = z.object({
  beforeFileId: z.string().uuid("Invalid before file ID"),
  afterFileId: z.string().uuid("Invalid after file ID"),
  description: z.string().max(5000).optional(),
});

export const validateSchema = z.object({
  steps: z.array(forgeStepSchema).min(1, "At least one step is required"),
  beforeFileId: z.string().uuid("Invalid before file ID"),
  afterFileId: z.string().uuid("Invalid after file ID"),
  mode: z.enum(["pattern", "strict"]).optional().default("pattern"),
});

// Export inferred types
export type CreateBlueprintInput = z.infer<typeof createBlueprintSchema>;
export type UpdateBlueprintInput = z.infer<typeof updateBlueprintSchema>;
export type DetachBlueprintInput = z.infer<typeof detachBlueprintSchema>;
export type AnalyzeInput = z.infer<typeof analyzeSchema>;
export type ValidateInput = z.infer<typeof validateSchema>;
