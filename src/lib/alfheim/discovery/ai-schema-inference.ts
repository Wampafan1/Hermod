// ---------------------------------------------------------------------------
// Alfheim Discovery — AI-powered schema inference via LLM
// ---------------------------------------------------------------------------

import { getLlmProvider } from "../../llm";
import type { LlmMessage } from "../../llm";
import { inferSchema } from "../schema-mapper";
import type { SchemaMapping, ColumnMapping, PaginationType } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SchemaInferenceResult {
  suggestedName: string;
  suggestedTableName: string;
  primaryKey: string | null;
  incrementalKey: string | null;
  schema: SchemaMapping;
  confidence: "high" | "medium" | "low";
  notes: string[];
  detectedPagination: {
    type: PaginationType;
    config: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SAMPLE_RECORDS = 5;

/**
 * Max characters per record when serialized. Large records with big text blobs
 * are truncated to keep the prompt within reasonable token limits.
 */
const MAX_RECORD_CHARS = 4_000;

const VALID_DATA_TYPES: Set<string> = new Set([
  "STRING",
  "INTEGER",
  "FLOAT",
  "BOOLEAN",
  "TIMESTAMP",
  "JSON",
]);

const VALID_PAGINATION_TYPES: Set<string> = new Set([
  "cursor",
  "offset",
  "link_header",
  "page_number",
  "none",
]);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a data engineering assistant that analyzes API response samples.
Given an API endpoint path, its response root key, and sample records, produce a JSON analysis.

Return ONLY valid JSON (no markdown, no explanation) matching this exact structure:

{
  "suggestedName": "human-readable name like Orders or Customer Transactions",
  "suggestedTableName": "snake_case SQL table name like orders or customer_transactions",
  "primaryKey": "field name that uniquely identifies each record, or null",
  "incrementalKey": "field name suitable for incremental sync (e.g. updated_at, modified_date), or null",
  "columns": [
    {
      "jsonPath": "dot.notation.path",
      "columnName": "snake_case_sql_column",
      "dataType": "STRING | INTEGER | FLOAT | BOOLEAN | TIMESTAMP | JSON",
      "nullable": true
    }
  ],
  "childTables": [
    {
      "jsonPath": "array_field_name",
      "tableName": "parent_child_table_name",
      "foreignKey": "parent_id_field",
      "columns": [...]
    }
  ],
  "confidence": "high | medium | low",
  "notes": ["any relevant observations about the data"],
  "detectedPagination": {
    "type": "cursor | offset | link_header | page_number | none",
    "config": {}
  }
}

Rules:
- Use the sample data to infer accurate types. Dates/timestamps should be TIMESTAMP.
- Flatten nested objects into dot-path columns (e.g. address.city).
- Arrays of objects become childTables; arrays of primitives become JSON columns.
- primaryKey should be the field that looks like a unique ID (id, uuid, _id, etc.).
- incrementalKey should be a timestamp that changes when the record is updated.
- For pagination config, include relevant keys like pageParam, limitParam, cursorPath.
- confidence: high if the data is clean and structure is obvious, medium if ambiguous, low if minimal data.`;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function inferSchemaWithAI(input: {
  endpoint: string;
  responseRoot: string;
  sampleRecords: Record<string, unknown>[];
  documentationContext?: string;
}): Promise<SchemaInferenceResult> {
  const { endpoint, responseRoot, sampleRecords, documentationContext } = input;

  // Truncate records for the prompt
  const samples = sampleRecords.slice(0, MAX_SAMPLE_RECORDS).map((r) => {
    const serialized = JSON.stringify(r);
    if (serialized.length > MAX_RECORD_CHARS) {
      return JSON.parse(serialized.slice(0, MAX_RECORD_CHARS) + '..."truncated"}');
    }
    return r;
  });

  const userContent = buildUserPrompt(endpoint, responseRoot, samples, documentationContext);

  try {
    const llm = getLlmProvider();
    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];

    const response = await llm.chat({
      messages,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
      maxTokens: 4_000,
    });

    const parsed = JSON.parse(response.content);
    return validateAndNormalize(parsed, sampleRecords);
  } catch (err) {
    console.error(
      "[alfheim/discovery] AI schema inference failed, falling back to deterministic inference:",
      err instanceof Error ? err.message : err,
    );
    return fallbackInference(endpoint, sampleRecords);
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(
  endpoint: string,
  responseRoot: string,
  samples: Record<string, unknown>[],
  docsContext?: string,
): string {
  const parts = [
    `Endpoint: ${endpoint}`,
    `Response root: ${responseRoot || "(direct array)"}`,
    `Sample records (${samples.length}):`,
    JSON.stringify(samples, null, 2),
  ];

  if (docsContext) {
    parts.push(`\nDocumentation context:\n${docsContext}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response validation & normalization
// ---------------------------------------------------------------------------

function validateAndNormalize(
  raw: Record<string, unknown>,
  sampleRecords: Record<string, unknown>[],
): SchemaInferenceResult {
  const suggestedName =
    typeof raw.suggestedName === "string" ? raw.suggestedName : "Records";
  const suggestedTableName =
    typeof raw.suggestedTableName === "string"
      ? raw.suggestedTableName
      : suggestedName.toLowerCase().replace(/\s+/g, "_");
  const primaryKey =
    typeof raw.primaryKey === "string" ? raw.primaryKey : null;
  const incrementalKey =
    typeof raw.incrementalKey === "string" ? raw.incrementalKey : null;

  // Validate columns
  const columns = normalizeColumns(raw.columns);
  const childTables = normalizeChildTables(raw.childTables);

  // If AI returned no columns, fall back to deterministic inference
  const schema: SchemaMapping =
    columns.length > 0
      ? { columns, ...(childTables.length > 0 ? { childTables } : {}) }
      : inferSchema(sampleRecords);

  const confidence = normalizeConfidence(raw.confidence);
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n): n is string => typeof n === "string")
    : [];

  const detectedPagination = normalizePagination(raw.detectedPagination);

  return {
    suggestedName,
    suggestedTableName,
    primaryKey,
    incrementalKey,
    schema,
    confidence,
    notes,
    detectedPagination,
  };
}

function normalizeColumns(raw: unknown): ColumnMapping[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (c): c is Record<string, unknown> =>
        typeof c === "object" && c !== null && typeof c.jsonPath === "string",
    )
    .map((c) => ({
      jsonPath: c.jsonPath as string,
      columnName:
        typeof c.columnName === "string"
          ? c.columnName
          : (c.jsonPath as string).replace(/\./g, "_").toLowerCase(),
      dataType: VALID_DATA_TYPES.has(c.dataType as string)
        ? (c.dataType as ColumnMapping["dataType"])
        : "STRING",
      nullable: typeof c.nullable === "boolean" ? c.nullable : true,
    }));
}

function normalizeChildTables(raw: unknown): import("../types").ChildTableMapping[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (ct): ct is Record<string, unknown> =>
        typeof ct === "object" &&
        ct !== null &&
        typeof ct.jsonPath === "string" &&
        typeof ct.tableName === "string",
    )
    .map((ct) => ({
      jsonPath: ct.jsonPath as string,
      tableName: ct.tableName as string,
      foreignKey:
        typeof ct.foreignKey === "string" ? ct.foreignKey : "parent_id",
      columns: normalizeColumns(ct.columns),
    }));
}

function normalizeConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function normalizePagination(
  raw: unknown,
): { type: PaginationType; config: Record<string, unknown> } {
  if (typeof raw !== "object" || raw === null) {
    return { type: "none", config: {} };
  }

  const obj = raw as Record<string, unknown>;
  const type = VALID_PAGINATION_TYPES.has(obj.type as string)
    ? (obj.type as PaginationType)
    : "none";

  const config =
    typeof obj.config === "object" && obj.config !== null
      ? (obj.config as Record<string, unknown>)
      : {};

  return { type, config };
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

function fallbackInference(
  endpoint: string,
  sampleRecords: Record<string, unknown>[],
): SchemaInferenceResult {
  const schema = inferSchema(sampleRecords);
  const name = suggestNameFromEndpoint(endpoint);

  // Try to detect a primary key
  const pkCandidates = ["id", "_id", "uuid", "ID", "Id"];
  const primaryKey =
    schema.columns.find((c) =>
      pkCandidates.some((pk) => c.jsonPath === pk || c.jsonPath.endsWith(`.${pk}`)),
    )?.jsonPath ?? null;

  // Try to detect an incremental key
  const incCandidates = [
    "updated_at",
    "updatedAt",
    "modified_at",
    "modifiedAt",
    "modified_date",
    "lastModified",
    "last_modified",
  ];
  const incrementalKey =
    schema.columns.find((c) =>
      incCandidates.some(
        (ik) => c.jsonPath === ik || c.jsonPath.endsWith(`.${ik}`),
      ),
    )?.jsonPath ?? null;

  return {
    suggestedName: name,
    suggestedTableName: name.toLowerCase().replace(/\s+/g, "_"),
    primaryKey,
    incrementalKey,
    schema,
    confidence: "low",
    notes: ["Schema inferred deterministically without AI assistance."],
    detectedPagination: { type: "none", config: {} },
  };
}

function suggestNameFromEndpoint(endpoint: string): string {
  const segments = endpoint
    .split("/")
    .filter((s) => s && !s.startsWith("{") && !/^v\d+$/i.test(s));

  const last = segments[segments.length - 1];
  if (!last) return "Records";

  // Capitalize first letter
  const clean = last.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
