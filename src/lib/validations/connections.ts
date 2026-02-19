import { z } from "zod";

export const dataSourceTypeSchema = z.enum([
  "POSTGRES",
  "MSSQL",
  "MYSQL",
  "BIGQUERY",
]);

const baseConnectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  type: dataSourceTypeSchema,
});

const sqlConnectionFields = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1, "Database is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const bigqueryConnectionFields = z.object({
  extras: z.object({
    type: z.literal("service_account"),
    project_id: z.string().min(1),
    private_key_id: z.string().min(1),
    private_key: z.string().min(1),
    client_email: z.string().email(),
    client_id: z.string().min(1),
    auth_uri: z.string().url(),
    token_uri: z.string().url(),
  }).passthrough(),
});

export const createConnectionSchema = z.discriminatedUnion("type", [
  baseConnectionSchema
    .extend({ type: z.literal("POSTGRES") })
    .merge(sqlConnectionFields),
  baseConnectionSchema
    .extend({ type: z.literal("MSSQL") })
    .merge(sqlConnectionFields),
  baseConnectionSchema
    .extend({ type: z.literal("MYSQL") })
    .merge(sqlConnectionFields),
  baseConnectionSchema
    .extend({ type: z.literal("BIGQUERY") })
    .merge(bigqueryConnectionFields),
]);

export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  host: z.string().min(1).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  database: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  extras: z.record(z.unknown()).optional(),
});

export const testConnectionSchema = createConnectionSchema;

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
