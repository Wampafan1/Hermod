import { z } from "zod";

export const sftpSourceTypeSchema = z.enum([
  "ADP",
  "QUICKBOOKS",
  "SAP",
  "GENERIC_FILE",
  "CUSTOM_SFTP",
]);

export const fileFormatSchema = z.enum(["CSV", "TSV", "XLSX"]);
export const loadModeSchema = z.enum(["APPEND", "REPLACE"]);

export const createSftpConnectionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  sourceType: sftpSourceTypeSchema,
  fileFormat: fileFormatSchema.default("CSV"),
  bqDataset: z.string().min(1, "BigQuery dataset is required").max(100),
  bqTable: z.string().min(1, "BigQuery table is required").max(100),
  loadMode: loadModeSchema.default("REPLACE"),
  notificationEmails: z
    .array(z.string().email("Invalid email address"))
    .default([]),
});

export const updateSftpConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  fileFormat: fileFormatSchema.optional(),
  bqDataset: z.string().min(1).max(100).optional(),
  bqTable: z.string().min(1).max(100).optional(),
  loadMode: loadModeSchema.optional(),
  notificationEmails: z.array(z.string().email()).optional(),
  status: z.enum(["ACTIVE", "ERROR", "DISABLED"]).optional(),
});

export type CreateSftpConnectionInput = z.infer<typeof createSftpConnectionSchema>;
export type UpdateSftpConnectionInput = z.infer<typeof updateSftpConnectionSchema>;
