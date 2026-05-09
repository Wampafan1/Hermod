import {
  REDACTED_SAMPLE_VALUE,
  isSensitiveSampleValueLike,
  redactSampleValue,
  redactSensitiveFragments,
} from "./retention";

export type MjolnirAiSampleMode =
  | "REDACTED"
  | "STRUCTURAL_ONLY"
  | "FULL_DEBUG";

export interface MjolnirAiSamplePolicyDescription {
  mode: MjolnirAiSampleMode;
  message: string;
  warning?: string;
}

const DEFAULT_AI_SAMPLE_MODE: MjolnirAiSampleMode = "REDACTED";
const OMIT = Symbol("omit");

type SanitizedValue = unknown | typeof OMIT;

const ROW_SAMPLE_KEYS = new Set([
  "afterrow",
  "afterrows",
  "beforerow",
  "beforerows",
  "keptrows",
  "rawrows",
  "removedrows",
  "rows",
  "sampledata",
  "samplerows",
]);

const SAMPLE_VALUE_KEYS = new Set([
  "aftersample",
  "aftervalue",
  "beforesample",
  "beforevalue",
  "example",
  "examples",
  "maxvalue",
  "minvalue",
  "newvalue",
  "oldvalue",
  "sample",
  "samplehash",
  "samplevalue",
  "samplevalues",
  "sourcevalue",
  "targetvalue",
  "topvalues",
  "value",
  "values",
]);

const FORMULA_KEYS = new Set([
  "expression",
  "formula",
  "formulatext",
  "rawformula",
]);

const DESCRIPTION_KEYS = new Set([
  "description",
  "explanation",
  "reasoning",
  "userdescription",
  "warning",
]);

// FULL_DEBUG deliberately preserves rich workbook-derived prompt context.
// Keep it as an explicit environment opt-in because it can send raw sample data
// to the configured AI provider.
export function getMjolnirAiSampleMode(
  env: NodeJS.ProcessEnv = process.env
): MjolnirAiSampleMode {
  const raw = (env.MJOLNIR_AI_SAMPLE_MODE ?? "").trim().toUpperCase();

  if (raw === "FULL_DEBUG") return "FULL_DEBUG";
  if (raw === "STRUCTURAL_ONLY") return "STRUCTURAL_ONLY";
  if (raw === "REDACTED") return "REDACTED";
  return DEFAULT_AI_SAMPLE_MODE;
}

export function sanitizeAiAnalysisContext<T>(
  context: T,
  mode: MjolnirAiSampleMode = getMjolnirAiSampleMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(context);
  return sanitizeContextValue(context, mode) as T;
}

export function sanitizeFormulaContext<T>(
  context: T,
  mode: MjolnirAiSampleMode = getMjolnirAiSampleMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(context);

  if (typeof context === "string") {
    return sanitizeFormulaString(context, mode) as T;
  }

  return sanitizeAiAnalysisContext(context, mode);
}

export function sanitizeRowSamples<T>(
  rows: T,
  mode: MjolnirAiSampleMode = getMjolnirAiSampleMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(rows);
  if (mode === "STRUCTURAL_ONLY") return [] as T;

  if (!Array.isArray(rows)) {
    return sanitizeSampleCell(rows) as T;
  }

  return rows.map((row) => {
    if (!isPlainRecord(row)) return sanitizeSampleCell(row);

    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, sanitizeSampleCell(value)])
    );
  }) as T;
}

export function shouldUseAiForSampleAnalysis(input?: {
  ambiguousCaseCount?: number;
  mode?: MjolnirAiSampleMode;
}): boolean {
  const ambiguousCaseCount = input?.ambiguousCaseCount;
  if (ambiguousCaseCount !== undefined && ambiguousCaseCount <= 0) {
    return false;
  }

  return Boolean(input?.mode ?? getMjolnirAiSampleMode());
}

export function describeAiSamplePolicyForUi(
  mode: MjolnirAiSampleMode = getMjolnirAiSampleMode()
): MjolnirAiSamplePolicyDescription {
  if (mode === "STRUCTURAL_ONLY") {
    return {
      mode,
      message: "AI receives structural metadata only.",
    };
  }

  if (mode === "FULL_DEBUG") {
    return {
      mode,
      message: "AI sample analysis is running in FULL_DEBUG mode.",
      warning: "Raw workbook-derived values may be sent to the configured AI provider.",
    };
  }

  return {
    mode,
    message: "AI analysis uses redacted samples by default.",
  };
}

function sanitizeContextValue(
  value: unknown,
  mode: MjolnirAiSampleMode,
  key = ""
): SanitizedValue {
  if (mode === "FULL_DEBUG") return cloneJson(value);

  const normalizedKey = normalizeKey(key);

  if (ROW_SAMPLE_KEYS.has(normalizedKey)) {
    return mode === "STRUCTURAL_ONLY"
      ? OMIT
      : sanitizeRowSamples(value, mode);
  }

  if (FORMULA_KEYS.has(normalizedKey)) {
    return sanitizeFormulaContext(value, mode);
  }

  if (SAMPLE_VALUE_KEYS.has(normalizedKey)) {
    return mode === "STRUCTURAL_ONLY"
      ? OMIT
      : redactSampleValue(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeContextValue(item, mode, key))
      .filter((item) => item !== OMIT);
  }

  if (!isPlainRecord(value)) {
    if (typeof value === "string") {
      return redactSensitiveFragments(value);
    }
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, nested] of Object.entries(value)) {
    const normalizedEntryKey = normalizeKey(entryKey);

    if (normalizedEntryKey === "fingerprints" && Array.isArray(nested)) {
      output[entryKey] = nested.map((item) => sanitizeFingerprint(item, mode));
      continue;
    }

    if (normalizedEntryKey === "formatchanges" && Array.isArray(nested)) {
      output[entryKey] = nested.map((item) => sanitizeFormatChange(item, mode));
      continue;
    }

    if (DESCRIPTION_KEYS.has(normalizedEntryKey) && typeof nested === "string") {
      output[entryKey] = redactSensitiveFragments(nested);
      continue;
    }

    const sanitized = sanitizeContextValue(nested, mode, entryKey);
    if (sanitized !== OMIT) output[entryKey] = sanitized;
  }

  return output;
}

function sanitizeFingerprint(
  value: unknown,
  mode: MjolnirAiSampleMode
): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      normalizedKey === "samplehash" ||
      normalizedKey === "topvalues" ||
      normalizedKey === "minvalue" ||
      normalizedKey === "maxvalue"
    ) {
      continue;
    }

    const sanitized = sanitizeContextValue(nested, mode, key);
    if (sanitized !== OMIT) output[key] = sanitized;
  }

  return output;
}

function sanitizeFormatChange(
  value: unknown,
  mode: MjolnirAiSampleMode
): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};

  const output: Record<string, unknown> = {};
  if (typeof value.column === "string") output.column = value.column;
  if (typeof value.changeType === "string") output.changeType = value.changeType;

  if (mode === "STRUCTURAL_ONLY") return output;

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      key === "column" ||
      key === "changeType" ||
      normalizedKey === "beforesample" ||
      normalizedKey === "aftersample" ||
      normalizedKey === "beforevalue" ||
      normalizedKey === "aftervalue" ||
      normalizedKey === "sample"
    ) {
      continue;
    }

    const sanitized = sanitizeContextValue(nested, mode, key);
    if (sanitized !== OMIT) output[key] = sanitized;
  }

  return output;
}

function sanitizeFormulaString(
  value: string,
  mode: MjolnirAiSampleMode
): string {
  if (mode === "STRUCTURAL_ONLY") return "[FORMULA_REDACTED]";

  return redactSensitiveFragments(value).replace(
    /(["'])([^"']{1,240})\1/g,
    (match, quote: string, inner: string) => {
      const redacted = redactSensitiveFragments(inner);
      if (redacted !== inner || isSensitiveSampleValueLike(inner)) {
        return `${quote}${REDACTED_SAMPLE_VALUE}${quote}`;
      }
      return match;
    }
  );
}

function sanitizeSampleCell(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value ?? null;
  return redactSampleValue(value);
}

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
