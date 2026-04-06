/**
 * Mjolnir — Step config validator.
 *
 * Validates that AI-generated ForgeStep configs match the executor's
 * expected shapes. Normalizes common mismatches (e.g., "renames" → "mapping",
 * "outputColumn" → "column") so steps don't silently fail at execution time.
 */

import type { ForgeStep, ForgeStepType } from "../types";

// ─── Validation Result ──────────────────────────────

export interface StepValidationResult {
  valid: boolean;
  step: ForgeStep;
  warnings: string[];
}

// ─── Config Requirements ────────────────────────────

interface ConfigRequirement {
  required: string[];
  optional?: string[];
  /** Key normalization map: { wrongKey → correctKey } */
  normalize?: Record<string, string>;
}

const CONFIG_REQUIREMENTS: Partial<Record<ForgeStepType, ConfigRequirement>> = {
  remove_columns: {
    required: ["columns"],
  },
  rename_columns: {
    required: ["mapping"],
    normalize: { renames: "mapping" },
  },
  reorder_columns: {
    required: ["order"],
  },
  filter_rows: {
    required: ["column", "operator"],
    optional: ["value"],
  },
  format: {
    required: ["column", "formatType"],
    optional: ["pattern"],
  },
  calculate: {
    required: ["column", "formula"],
    optional: ["sourceColumns"],
    normalize: { outputColumn: "column" },
  },
  sort: {
    required: ["column"],
    optional: ["direction"],
  },
  deduplicate: {
    required: [],
    optional: ["columns"],
  },
  aggregate: {
    required: ["groupBy", "aggregations"],
  },
  split_column: {
    required: ["column", "delimiter", "outputColumns"],
    optional: ["keepOriginal"],
  },
  merge_columns: {
    required: ["columns", "delimiter", "outputColumn"],
    optional: ["keepOriginals"],
  },
};

// ─── Validator ──────────────────────────────────────

/**
 * Validate and normalize a single ForgeStep's config.
 *
 * - Normalizes known wrong keys (e.g., "renames" → "mapping")
 * - Checks required fields are present
 * - Returns the (possibly corrected) step with warnings
 */
export function validateStepConfig(step: ForgeStep): StepValidationResult {
  const warnings: string[] = [];
  const req = CONFIG_REQUIREMENTS[step.type];

  // No requirements defined — pass through (stubs like lookup/pivot)
  if (!req) {
    return { valid: true, step, warnings };
  }

  // Clone config to avoid mutating the original
  const config = { ...step.config };

  // Normalize keys
  if (req.normalize) {
    for (const [wrong, correct] of Object.entries(req.normalize)) {
      if (wrong in config && !(correct in config)) {
        config[correct] = config[wrong];
        delete config[wrong];
        warnings.push(
          `Step "${step.type}": normalized config key "${wrong}" → "${correct}"`
        );
      }
    }
  }

  // Check required fields
  const missing: string[] = [];
  for (const field of req.required) {
    if (!(field in config) || config[field] === undefined || config[field] === null) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    warnings.push(
      `Step "${step.type}": missing required config field(s): ${missing.join(", ")}`
    );
    return {
      valid: false,
      step: { ...step, config },
      warnings,
    };
  }

  return {
    valid: true,
    step: { ...step, config },
    warnings,
  };
}

/**
 * Validate and normalize an array of ForgeSteps.
 * Invalid steps are excluded from the result array.
 */
export function validateAndNormalizeSteps(
  steps: ForgeStep[]
): { steps: ForgeStep[]; warnings: string[] } {
  const validSteps: ForgeStep[] = [];
  const allWarnings: string[] = [];

  for (const step of steps) {
    const result = validateStepConfig(step);
    allWarnings.push(...result.warnings);

    if (result.valid) {
      validSteps.push(result.step);
    }
  }

  return { steps: validSteps, warnings: allWarnings };
}
