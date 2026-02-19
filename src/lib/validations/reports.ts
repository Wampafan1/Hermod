import { z } from "zod";

export const createReportSchema = z.object({
  name: z.string().min(1, "Report name is required").max(200),
  description: z.string().max(2000).optional(),
  sqlQuery: z.string().min(1, "SQL query is required"),
  dataSourceId: z.string().min(1, "Connection is required"),
  formatting: z.record(z.unknown()).optional(),
});

export const updateReportSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  sqlQuery: z.string().min(1).optional(),
  dataSourceId: z.string().min(1).optional(),
  formatting: z.record(z.unknown()).optional().nullable(),
});

export const executeQuerySchema = z.object({
  connectionId: z.string().min(1, "Connection ID is required"),
  sql: z.string().min(1, "SQL query is required").max(100000),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type ExecuteQueryInput = z.infer<typeof executeQuerySchema>;
