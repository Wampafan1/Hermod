import { z } from "zod";

// ─── Source Config ───────────────────────────────────

const sourceConfigSchema = z.object({
  query: z.string().min(1, "Source query is required"),
  dataset: z.string().optional(),
  incrementalKey: z.string().optional(),
  chunkSize: z.number().int().min(100).max(100_000).optional(),
  // NetSuite structured config (stored alongside generated SuiteQL query)
  recordType: z.string().optional(),
  fields: z.array(z.string()).optional(),
  filter: z.string().optional(),
  // REST API (Alfheim) — references catalog object for extraction config
  objectSlug: z.string().optional(),
});

// ─── Dest Config ─────────────────────────────────────

const destConfigSchema = z.object({
  dataset: z.string().min(1, "Destination dataset is required"),
  table: z.string().min(1, "Destination table is required"),
  writeDisposition: z.enum(["WRITE_APPEND", "WRITE_TRUNCATE", "WRITE_EMPTY"]),
  autoCreateTable: z.boolean().default(false),
  schema: z.record(z.unknown()).nullable().optional(),
  fieldMapping: z.record(z.string()).nullable().optional(),
  chunkSize: z.number().int().min(100).max(100_000).optional(),
});

// ─── Cursor Config (Incremental Sync) ───────────────

export const cursorStrategySchema = z.enum([
  "timestamp_cursor", "integer_id_cursor", "rowversion_cursor", "full_refresh",
]);

export const cursorConfidenceSchema = z.enum(["high", "medium", "low"]);

const cursorCandidateSchema = z.object({
  column: z.string(),
  strategy: cursorStrategySchema,
  score: z.number(),
  reason: z.string(),
});

const cursorConfigSchema = z.object({
  strategy: cursorStrategySchema,
  cursorColumn: z.string().nullable(),
  cursorColumnType: z.string().nullable(),
  primaryKey: z.string().nullable(),
  confidence: cursorConfidenceSchema,
  reasoning: z.string(),
  warnings: z.array(z.string()),
  candidates: z.array(cursorCandidateSchema),
}).nullable().optional();

// ─── Detect Cursor ──────────────────────────────────

const columnSchemaItem = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
});

export const detectCursorSchema = z.object({
  tableName: z.string().min(1, "tableName is required"),
  sourceSystem: z.string().default("Unknown"),
  realm: z.string().default("alfheim"),
  columns: z.array(columnSchemaItem).min(1, "At least one column is required"),
});

// ─── Create Route ────────────────────────────────────

export const createRouteSchema = z.object({
  name: z.string().min(1, "Route name is required").max(200),
  sourceId: z.string().min(1).optional(),          // Direct connection source
  ravenSatelliteId: z.string().min(1).optional(),   // Raven agent source (mutually exclusive with sourceId)
  sourceConfig: sourceConfigSchema,
  destId: z.string().min(1, "Destination connection is required"),
  destConfig: destConfigSchema,
  transformEnabled: z.boolean().default(false),
  blueprintId: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  dayOfMonth: z.number().int().min(0).max(31).nullable().optional(),
  timeHour: z.number().int().min(0).max(23).default(7),
  timeMinute: z.number().int().min(0).max(59).default(0),
  timezone: z.string().default("America/Chicago"),
  cursorConfig: cursorConfigSchema,
}).refine(
  (data) => data.sourceId || data.ravenSatelliteId,
  { message: "Either sourceId or ravenSatelliteId is required", path: ["sourceId"] }
);

// ─── Update Route ────────────────────────────────────

export const updateRouteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  sourceId: z.string().min(1).nullable().optional(),
  ravenSatelliteId: z.string().min(1).nullable().optional(),
  sourceConfig: sourceConfigSchema.optional(),
  destId: z.string().min(1).optional(),
  destConfig: destConfigSchema.optional(),
  transformEnabled: z.boolean().optional(),
  blueprintId: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(0).max(31).nullable().optional(),
  timeHour: z.number().int().min(0).max(23).optional(),
  timeMinute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().optional(),
  cursorConfig: cursorConfigSchema,
  needsFullReload: z.boolean().optional(),
});

// ─── Schema Fetch ────────────────────────────────────

export const fetchSchemaSchema = z.object({
  connectionId: z.string().min(1, "Connection ID is required"),
  dataset: z.string().min(1, "Dataset is required"),
  table: z.string().min(1, "Table is required"),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
export type FetchSchemaInput = z.infer<typeof fetchSchemaSchema>;
