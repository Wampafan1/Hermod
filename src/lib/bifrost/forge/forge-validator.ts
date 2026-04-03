/**
 * Validates that a blueprint only contains stateless steps
 * suitable for chunk-by-chunk streaming in Bifrost routes.
 *
 * Stateful operations (sort, dedup, aggregate) belong in the
 * source query where BigQuery handles them natively.
 */

import type { ForgeStepType } from "@/lib/mjolnir/types";
import type { ForgeStreamingValidation } from "../types";

const STATELESS_STEPS = new Set<string>([
  "remove_columns",
  "rename_columns",
  "reorder_columns",
  "filter_rows",
  "calculate",
  "format",
  "split_column",
  "merge_columns",
]);

const STATEFUL_STEPS = new Set<string>([
  "sort",
  "deduplicate",
  "aggregate",
  "pivot",
  "unpivot",
  "lookup",
  "custom_sql",
]);

const SUGGESTIONS: Record<string, string> = {
  sort: "Add ORDER BY to your source query",
  deduplicate: "Add SELECT DISTINCT or GROUP BY to your source query",
  aggregate: "Add GROUP BY with aggregation functions to your source query",
  pivot: "Use BigQuery PIVOT operator in your source query",
  unpivot: "Use BigQuery UNPIVOT operator in your source query",
  lookup: "Use a JOIN in your source query",
  custom_sql: "Add the custom SQL logic directly to your source query",
};

export function validateBlueprintForStreaming(
  steps: Array<{ type: ForgeStepType | string }>
): ForgeStreamingValidation {
  const stateful = steps
    .filter((s) => STATEFUL_STEPS.has(s.type))
    .map((s) => s.type);

  if (stateful.length === 0) {
    return { valid: true, statefulSteps: [], suggestion: null };
  }

  const unique = [...new Set(stateful)];
  const suggestions = unique
    .map((step) => SUGGESTIONS[step] ?? `Move "${step}" logic into your source or destination query`)
    .join(". ");

  return {
    valid: false,
    statefulSteps: unique,
    suggestion: suggestions,
  };
}
