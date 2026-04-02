import { z } from "zod";

// ─── Catalog search query params ───────────────────────────────

export const catalogSearchSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── Create a catalog connector ────────────────────────────────

export const createCatalogConnectorSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  docsUrl: z.string().url().optional().or(z.literal("")),
  popularity: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  authType: z.enum(["API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"]),
  baseUrl: z.string().min(1),
  authConfig: z.record(z.unknown()),
  pagination: z.record(z.unknown()),
  rateLimiting: z.record(z.unknown()).optional(),
});

// ─── Update (partial) ──────────────────────────────────────────

export const updateCatalogConnectorSchema = createCatalogConnectorSchema.partial();

// ─── Test connection with catalog connector ────────────────────

export const testCatalogConnectionSchema = z.object({
  credentials: z.record(z.string()),
});

// ─── REST_API connection config (stored in Connection.config) ──

export const restApiConfigSchema = z.object({
  catalogSlug: z.string().min(1),
  baseUrl: z.string().min(1),
  authType: z.enum(["API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"]),
  authConfig: z.record(z.unknown()),
  pagination: z.record(z.unknown()),
  rateLimiting: z.record(z.unknown()).optional(),
  selectedObjects: z.array(z.string()).min(1),
});

// ─── REST_API credentials ──────────────────────────────────────

/** Base object schema (no refinement) — used in discriminated unions */
export const restApiCredentialsBaseSchema = z.object({
  apiKey: z.string().optional(),
  bearerToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

/** Full schema with credential-presence refinement — use for standalone validation */
export const restApiCredentialsSchema = restApiCredentialsBaseSchema.refine(
  data => data.apiKey || data.bearerToken || (data.username && data.password),
  "At least one credential type required"
);

// ─── Discovery: OpenAPI spec parsing ──────────────────────────

export const discoverOpenApiSchema = z
  .object({
    specUrl: z.string().url().optional(),
    specContent: z.string().optional(),
  })
  .refine(
    (d) => d.specUrl || d.specContent,
    "Either specUrl or specContent is required"
  );

// ─── Discovery: Probe endpoints ──────────────────────────────

export const discoverProbeSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(["API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"]),
  credentials: z.record(z.string()),
  endpoints: z.array(z.string()).optional(),
});

// ─── Discovery: AI schema inference ──────────────────────────

export const discoverInferSchema = z.object({
  endpoint: z.string().min(1),
  responseRoot: z.string().min(1),
  sampleRecords: z.array(z.record(z.unknown())).min(1),
  documentationContext: z.string().optional(),
});

// ─── Discovery: DDL generation ───────────────────────────────

export const discoverDdlSchema = z.object({
  tableName: z.string().min(1).max(128),
  schema: z.object({
    columns: z.array(
      z.object({
        jsonPath: z.string(),
        columnName: z.string(),
        dataType: z.enum(["STRING", "INTEGER", "FLOAT", "BOOLEAN", "TIMESTAMP", "JSON"]),
        nullable: z.boolean(),
      })
    ),
    childTables: z
      .array(
        z.object({
          jsonPath: z.string(),
          tableName: z.string(),
          foreignKey: z.string(),
          columns: z.array(
            z.object({
              jsonPath: z.string(),
              columnName: z.string(),
              dataType: z.enum(["STRING", "INTEGER", "FLOAT", "BOOLEAN", "TIMESTAMP", "JSON"]),
              nullable: z.boolean(),
            })
          ),
        })
      )
      .optional(),
  }),
  dialect: z.enum(["postgres", "mssql", "mysql", "bigquery"]),
});

// ─── Discovery: Full AI pipeline ─────────────────────────────

export const discoverAiSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(["API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"]),
  credentials: z.record(z.string()),
  authConfig: z.record(z.unknown()).optional(),
  description: z.string().optional(),
});

// ─── Type exports ──────────────────────────────────────────────

export type CatalogSearchInput = z.infer<typeof catalogSearchSchema>;
export type CreateCatalogConnectorInput = z.infer<typeof createCatalogConnectorSchema>;
export type UpdateCatalogConnectorInput = z.infer<typeof updateCatalogConnectorSchema>;
export type TestCatalogConnectionInput = z.infer<typeof testCatalogConnectionSchema>;
export type RestApiConfig = z.infer<typeof restApiConfigSchema>;
export type RestApiCredentials = z.infer<typeof restApiCredentialsSchema>;
export type DiscoverOpenApiInput = z.infer<typeof discoverOpenApiSchema>;
export type DiscoverProbeInput = z.infer<typeof discoverProbeSchema>;
export type DiscoverInferInput = z.infer<typeof discoverInferSchema>;
export type DiscoverDdlInput = z.infer<typeof discoverDdlSchema>;
export type DiscoverAiInput = z.infer<typeof discoverAiSchema>;
