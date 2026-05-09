import type { BlueprintFormatting, ForgeStep } from "./types";

export type MjolnirRetentionMode =
  | "MINIMAL"
  | "STANDARD"
  | "FULL_DEBUG";

export const REDACTED_SAMPLE_VALUE = "[REDACTED_SAMPLE]";

const DEFAULT_RETENTION_MODE: MjolnirRetentionMode = "MINIMAL";
const MAX_FILENAME_LENGTH = 120;

const OMIT = Symbol("omit");

type SanitizedValue = unknown | typeof OMIT;

const SAMPLE_CONTEXT_DROP_KEYS = new Set([
  "afterdata",
  "afterrow",
  "afterrows",
  "beforedata",
  "beforerow",
  "beforerows",
  "contextwithsamples",
  "keptrows",
  "prompt",
  "rawprompt",
  "rawresponse",
  "rawrows",
  "rawsamples",
  "removedrows",
  "rows",
  "sampledata",
  "samplerows",
]);

const SAMPLE_SCALAR_KEYS = new Set([
  "aftersample",
  "aftervalue",
  "beforeSample",
  "beforesample",
  "beforevalue",
  "maxvalue",
  "minvalue",
  "sample",
  "samplevalue",
  "topvalues",
]);

const STEP_LITERAL_KEYS = new Set([
  "constant",
  "defaultvalue",
  "literal",
  "matchvalue",
  "sample",
  "samplevalue",
  "value",
  "values",
]);

// FULL_DEBUG intentionally preserves rich sample-derived data for debugging.
// It must stay explicit opt-in because it can retain raw workbook values.
export function getMjolnirRetentionMode(
  env: NodeJS.ProcessEnv = process.env
): MjolnirRetentionMode {
  const raw = (
    env.MJOLNIR_RETENTION_MODE ??
    env.MJOLNIR_SAMPLE_RETENTION_MODE ??
    ""
  ).trim().toUpperCase();

  if (raw === "FULL_DEBUG") return "FULL_DEBUG";
  if (raw === "STANDARD") return "STANDARD";
  if (raw === "MINIMAL") return "MINIMAL";
  return DEFAULT_RETENTION_MODE;
}

export function sanitizeSampleFilename(filename: unknown): string | null {
  if (typeof filename !== "string") return null;

  const base = filename
    .replace(/\0/g, "")
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop();

  if (!base) return null;

  const safe = base
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);

  return safe.length > 0 ? safe : null;
}

export function isSensitiveSampleValueLike(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) >= 100_000_000;
  }
  if (typeof value !== "string") return false;

  const s = value.trim();
  if (!s || s === REDACTED_SAMPLE_VALUE) return false;
  if (s.length > 120) return true;

  const digitCount = (s.match(/\d/g) ?? []).length;
  const hasEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s);
  const hasUrl = /\bhttps?:\/\/\S+|\bwww\.\S+/i.test(s);
  const hasSsn = /\b\d{3}-\d{2}-\d{4}\b/.test(s);
  const hasPhone = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/.test(s);
  const hasUuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(s);
  const hasLongToken = /\b[A-Za-z0-9_-]{24,}\b/.test(s);
  const hasLongNumber = digitCount >= 10;
  const hasFilePath = /(?:[A-Za-z]:\\|\/[^/\s]+\/|\\[^\\\s]+\\)/.test(s);
  const hasEnvironmentName = /\b(?:customer|client|tenant|prod|production|staging|sandbox)\b/i.test(s);
  const hasCompanySuffix = /\b(?:co\.?|company|corp\.?|corporation|group|holdings|inc\.?|industries|llc|ltd\.?|partners|solutions|systems)\b/i.test(s);

  return (
    hasEmail ||
    hasUrl ||
    hasSsn ||
    hasPhone ||
    hasUuid ||
    hasLongToken ||
    hasLongNumber ||
    hasFilePath ||
    hasEnvironmentName ||
    hasCompanySuffix
  );
}

export function redactSampleValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => redactSampleValue(item));
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactSampleValue(nested)])
    );
  }
  return REDACTED_SAMPLE_VALUE;
}

export function sanitizeForgeSteps(
  steps: ForgeStep[],
  mode: MjolnirRetentionMode = getMjolnirRetentionMode()
): ForgeStep[] {
  if (mode === "FULL_DEBUG") return cloneJson(steps);

  return steps.map((step) => ({
    ...step,
    config: sanitizeStepConfig(step.config, mode),
    description: redactDescription(step.description, mode),
  }));
}

export function sanitizeAnalysisLog<T>(
  analysisLog: T,
  mode: MjolnirRetentionMode = getMjolnirRetentionMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(analysisLog);
  return sanitizeMetadataValue(analysisLog, mode) as T;
}

export function sanitizeAfterFormatting<T>(
  afterFormatting: T,
  mode: MjolnirRetentionMode = getMjolnirRetentionMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(afterFormatting);
  const sanitized = sanitizeMetadataValue(afterFormatting, mode);
  if (!isPlainRecord(sanitized)) return sanitized as T;

  if (mode === "MINIMAL") {
    sanitized.headerValues = {};
    return sanitized as T;
  }

  const headerValues = sanitized.headerValues;
  if (isPlainRecord(headerValues)) {
    sanitized.headerValues = Object.fromEntries(
      Object.entries(headerValues).map(([key, value]) => [
        key,
        isSensitiveSampleValueLike(value) ? redactSampleValue(value) : value,
      ])
    );
  }

  return sanitized as T;
}

export function sanitizeBlueprintCreatePayload<T extends object>(
  payload: T,
  mode: MjolnirRetentionMode = getMjolnirRetentionMode()
): T {
  if (mode === "FULL_DEBUG") return cloneJson(payload);

  const source = payload as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };

  if ("description" in source && typeof source.description === "string") {
    result.description = redactDescription(source.description, mode);
  }

  if (Array.isArray(source.steps)) {
    result.steps = sanitizeForgeSteps(source.steps as ForgeStep[], mode);
  }

  if ("sourceSchema" in source && source.sourceSchema !== undefined) {
    result.sourceSchema = sanitizeMetadataValue(source.sourceSchema, mode);
  }

  if ("analysisLog" in source && source.analysisLog !== undefined) {
    result.analysisLog = sanitizeAnalysisLog(source.analysisLog, mode);
  }

  if ("afterFormatting" in source && source.afterFormatting !== undefined) {
    result.afterFormatting = sanitizeAfterFormatting(
      source.afterFormatting as BlueprintFormatting,
      mode
    );
  }

  if ("beforeSample" in source) {
    result.beforeSample = mode === "STANDARD"
      ? sanitizeSampleFilename(source.beforeSample)
      : null;
  }

  if ("afterSample" in source) {
    result.afterSample = mode === "STANDARD"
      ? sanitizeSampleFilename(source.afterSample)
      : null;
  }

  return stripUndefined(result) as T;
}

function sanitizeStepConfig(
  config: Record<string, unknown>,
  mode: MjolnirRetentionMode
): Record<string, unknown> {
  const sanitized = sanitizeStepConfigValue(config, mode);
  return isPlainRecord(sanitized) ? sanitized : {};
}

function sanitizeStepConfigValue(
  value: unknown,
  mode: MjolnirRetentionMode,
  key = ""
): SanitizedValue {
  if (mode === "FULL_DEBUG") return cloneJson(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeStepConfigValue(item, mode, key))
      .filter((item) => item !== OMIT);
  }

  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [entryKey, nested] of Object.entries(value)) {
      const sanitized = sanitizeStepConfigValue(nested, mode, entryKey);
      if (sanitized !== OMIT) output[entryKey] = sanitized;
    }
    return output;
  }

  const normalizedKey = normalizeKey(key);
  if (SAMPLE_CONTEXT_DROP_KEYS.has(normalizedKey)) return OMIT;

  if (SAMPLE_SCALAR_KEYS.has(normalizedKey)) {
    return redactSampleValue(value);
  }

  if (typeof value === "string") {
    if (normalizedKey === "formula") {
      return redactQuotedSensitiveLiterals(value);
    }
    if (normalizedKey === "description" || normalizedKey === "explanation") {
      return redactDescription(value, mode);
    }
    if (STEP_LITERAL_KEYS.has(normalizedKey) && isSensitiveSampleValueLike(value)) {
      return redactSampleValue(value);
    }
  }

  if (STEP_LITERAL_KEYS.has(normalizedKey) && isSensitiveSampleValueLike(value)) {
    return redactSampleValue(value);
  }

  return value;
}

function sanitizeMetadataValue(
  value: unknown,
  mode: MjolnirRetentionMode,
  key = ""
): SanitizedValue {
  if (mode === "FULL_DEBUG") return cloneJson(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeMetadataValue(item, mode, key))
      .filter((item) => item !== OMIT);
  }

  if (!isPlainRecord(value)) {
    return typeof value === "string" ? redactSensitiveFragments(value) : value;
  }

  const normalizedKey = normalizeKey(key);
  if (SAMPLE_CONTEXT_DROP_KEYS.has(normalizedKey)) return OMIT;

  if (normalizedKey === "formatchanges" && Array.isArray(value)) {
    return value.map((item) => sanitizeFormatChange(item, mode));
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, nested] of Object.entries(value)) {
    const normalizedEntryKey = normalizeKey(entryKey);

    if (SAMPLE_CONTEXT_DROP_KEYS.has(normalizedEntryKey)) continue;
    if (SAMPLE_SCALAR_KEYS.has(normalizedEntryKey)) continue;

    if (normalizedEntryKey === "formatchanges" && Array.isArray(nested)) {
      output[entryKey] = nested.map((item) => sanitizeFormatChange(item, mode));
      continue;
    }

    if (
      (normalizedEntryKey === "description" ||
        normalizedEntryKey === "explanation" ||
        normalizedEntryKey === "warning") &&
      typeof nested === "string"
    ) {
      output[entryKey] = redactDescription(nested, mode);
      continue;
    }

    const sanitized = sanitizeMetadataValue(nested, mode, entryKey);
    if (sanitized !== OMIT) output[entryKey] = sanitized;
  }

  return output;
}

function sanitizeFormatChange(
  value: unknown,
  mode: MjolnirRetentionMode
): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};

  const output: Record<string, unknown> = {};
  if (typeof value.column === "string") output.column = value.column;
  if (typeof value.changeType === "string") output.changeType = value.changeType;

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

    const sanitized = sanitizeMetadataValue(nested, mode, key);
    if (sanitized !== OMIT) output[key] = sanitized;
  }

  return output;
}

function redactDescription(
  description: string,
  mode: MjolnirRetentionMode
): string {
  if (mode === "FULL_DEBUG") return description;
  return redactSensitiveFragments(description)
    .replace(/\(([^)]{1,160})\s*(?:->|→|â†’)\s*([^)]{1,160})\)/g, "(sample redacted)")
    .replace(/`([^`]{1,120})`/g, (match, inner: string) =>
      isSensitiveSampleValueLike(inner) ? `\`${REDACTED_SAMPLE_VALUE}\`` : match
    )
    .replace(/"([^"]{1,120})"/g, (match, inner: string) =>
      isSensitiveSampleValueLike(inner) ? `"${REDACTED_SAMPLE_VALUE}"` : match
    )
    .replace(/'([^']{1,120})'/g, (match, inner: string) =>
      isSensitiveSampleValueLike(inner) ? `'${REDACTED_SAMPLE_VALUE}'` : match
    );
}

function redactSensitiveFragments(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED_SAMPLE_VALUE)
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, REDACTED_SAMPLE_VALUE)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, REDACTED_SAMPLE_VALUE)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, REDACTED_SAMPLE_VALUE)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, REDACTED_SAMPLE_VALUE)
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, REDACTED_SAMPLE_VALUE)
    .replace(/(?:[A-Za-z]:\\|\/)[^\s"'`<>]+/g, REDACTED_SAMPLE_VALUE);
}

function redactQuotedSensitiveLiterals(value: string): string {
  return value.replace(/(["'])([^"']{1,160})\1/g, (match, quote: string, inner: string) =>
    isSensitiveSampleValueLike(inner)
      ? `${quote}${REDACTED_SAMPLE_VALUE}${quote}`
      : match
  );
}

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined)
  );
}
