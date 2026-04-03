/**
 * Mjolnir — Public API re-exports.
 *
 * Barrel file for the Mjolnir forge engine. Import from "@/lib/mjolnir"
 * to access types, engines, file parsing, and fingerprinting.
 */

// Types
export type {
  ForgeStep,
  ForgeStepType,
  StepMetric,
  ColumnFingerprint,
  StructuralDiffResult,
  ColumnMatch,
  FormatChange,
  AmbiguousCase,
  ParsedFileData,
  BlueprintData,
  BlueprintFormatting,
  CapturedCellStyle,
  InferredDataType,
} from "./types";

// Engines
export { computeStructuralDiff } from "./engine/structural-diff";
export { runAiInference } from "./engine/ai-inference";
export { executeBlueprint } from "./engine/blueprint-executor";
export type { ExecutionResult } from "./engine/blueprint-executor";
export { validateBlueprint } from "./engine/validation";
export type { ValidationResult, ColumnValidation, Mismatch } from "./engine/validation";

// File parsing
export { parseExcelBuffer } from "./file-parser";

// Schema enforcement
export { validateInputSchema } from "./engine/schema-guard";
export type { SchemaValidationResult } from "./engine/schema-guard";

// Fingerprinting
export { fingerprintColumn, fingerprintAllColumns } from "./engine/fingerprint";

// Style extraction
export { extractStyleTemplate } from "./engine/style-extractor";
