import { z } from "zod";
import type { ConnectionType } from "@/lib/providers/types";
import { restApiConfigSchema, restApiCredentialsBaseSchema, restApiCredentialsSchema } from "./alfheim";

// ─── Config schemas (non-sensitive, stored in config JSON) ───────

const sqlConfigBase = {
  host: z.string().min(1),
  database: z.string().min(1),
  username: z.string().min(1),
  ssl: z.boolean().default(false),
};

const postgresConfig = z.object({ ...sqlConfigBase, port: z.coerce.number().int().min(1).max(65535).default(5432) });
const mssqlConfig    = z.object({ ...sqlConfigBase, port: z.coerce.number().int().min(1).max(65535).default(1433) });
const mysqlConfig    = z.object({ ...sqlConfigBase, port: z.coerce.number().int().min(1).max(65535).default(3306) });

const bigqueryConfig = z.object({
  projectId: z.string().min(1),
  location: z.string().default("US"),
});

const netsuiteConfig = z.object({
  accountId: z.string().min(1),
});

const sftpConfig = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(2222),
  username: z.string().min(1),
  fileFormat: z.enum(["CSV", "TSV", "XLSX"]).default("CSV"),
  sourceType: z.enum(["ADP", "QUICKBOOKS", "SAP", "GENERIC_FILE", "CUSTOM_SFTP"]),
});

// ─── Credentials schemas (sensitive, encrypted at rest) ─────────

const passwordCredentials = z.object({
  password: z.string().min(1),
});

const bigqueryCredentials = z.object({
  serviceAccountKey: z.record(z.unknown()),
});

const netsuiteCredentials = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
});

// ─── File source configs (non-sensitive, stored in config JSON) ──

const csvFileConfig = z.object({
  filePath: z.string().optional(),
  originalFilename: z.string().optional(),
  delimiter: z.string().default(","),
  hasHeaders: z.boolean().default(true),
  encoding: z.string().default("utf-8"),
  skipRows: z.number().int().default(0),
  pkColumns: z.array(z.string()).optional(),
  schema: z.record(z.unknown()).optional(),
  baselineSchema: z.record(z.unknown()).optional(),
});

const excelFileConfig = z.object({
  filePath: z.string().optional(),
  originalFilename: z.string().optional(),
  sheetName: z.string().optional(),
  availableSheets: z.array(z.string()).optional(),
  headerRow: z.number().int().default(1),
  dataStartRow: z.number().int().default(2),
  pkColumns: z.array(z.string()).optional(),
  schema: z.record(z.unknown()).optional(),
  baselineSchema: z.record(z.unknown()).optional(),
});

const googleSheetsConfig = z.object({
  spreadsheetId: z.string().optional(),
  spreadsheetUrl: z.string().optional(),
  spreadsheetName: z.string().optional(),
  sheetName: z.string().optional(),
  availableSheets: z.array(z.string()).optional(),
  headerRow: z.number().int().default(1),
  dataStartRow: z.number().int().default(2),
  pkColumns: z.array(z.string()).optional(),
  schema: z.record(z.unknown()).optional(),
  baselineSchema: z.record(z.unknown()).optional(),
});

const noCredentials = z.object({}).default({});

// ─── Schema maps (for programmatic access per type) ─────────────

export const connectionConfigSchemas: Record<ConnectionType, z.ZodTypeAny> = {
  POSTGRES: postgresConfig,
  MSSQL: mssqlConfig,
  MYSQL: mysqlConfig,
  BIGQUERY: bigqueryConfig,
  NETSUITE: netsuiteConfig,
  SFTP: sftpConfig,
  REST_API: restApiConfigSchema,
  CSV_FILE: csvFileConfig,
  EXCEL_FILE: excelFileConfig,
  GOOGLE_SHEETS: googleSheetsConfig,
};

export const connectionCredentialsSchemas: Record<ConnectionType, z.ZodTypeAny> = {
  POSTGRES: passwordCredentials,
  MSSQL: passwordCredentials,
  MYSQL: passwordCredentials,
  BIGQUERY: bigqueryCredentials,
  NETSUITE: netsuiteCredentials,
  SFTP: passwordCredentials,
  REST_API: restApiCredentialsSchema,
  CSV_FILE: noCredentials,
  EXCEL_FILE: noCredentials,
  GOOGLE_SHEETS: noCredentials,
};

// ─── Discriminated union for create ─────────────────────────────

const baseFields = {
  name: z.string().min(1).max(200),
};

export const createConnectionSchema = z.discriminatedUnion("type", [
  z.object({ ...baseFields, type: z.literal("POSTGRES"),  config: postgresConfig,  credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("MSSQL"),     config: mssqlConfig,     credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("MYSQL"),     config: mysqlConfig,     credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("BIGQUERY"),  config: bigqueryConfig,  credentials: bigqueryCredentials }),
  z.object({ ...baseFields, type: z.literal("NETSUITE"),  config: netsuiteConfig,  credentials: netsuiteCredentials }),
  z.object({ ...baseFields, type: z.literal("SFTP"),      config: sftpConfig,      credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("REST_API"),  config: restApiConfigSchema, credentials: restApiCredentialsBaseSchema }),
  z.object({ ...baseFields, type: z.literal("CSV_FILE"),   config: csvFileConfig,       credentials: noCredentials }),
  z.object({ ...baseFields, type: z.literal("EXCEL_FILE"), config: excelFileConfig,     credentials: noCredentials }),
  z.object({ ...baseFields, type: z.literal("GOOGLE_SHEETS"), config: googleSheetsConfig, credentials: noCredentials }),
]);

// TODO: updateConnectionSchema uses loose validation — type-aware config/credentials
// validation should happen in the API route by looking up the connection's type
// from the DB and validating against connectionConfigSchemas[type].
export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
});

export const testConnectionSchema = createConnectionSchema;

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
