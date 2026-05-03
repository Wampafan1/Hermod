import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const databaseName = z.string().trim().min(1).max(128).regex(/^[^/\0]+$/, "Database name cannot contain slash or null characters");
const databaseNames = z.array(databaseName);

export const mssqlFullFrequencySchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export const mssqlDifferentialFrequencySchema = z.enum(["EVERY_4_HOURS", "EVERY_6_HOURS", "EVERY_12_HOURS", "DAILY"]);
export const mssqlLogFrequencySchema = z.enum(["EVERY_15_MIN", "EVERY_30_MIN", "HOURLY", "EVERY_4_HOURS"]);
export const mssqlDatabaseSelectionModeSchema = z.enum(["SINGLE", "MULTIPLE", "ALL_USER_DATABASES", "PATTERN"]);
export const mssqlDestinationModeSchema = z.enum([
  "BACKUP_TO_URL",
  "BACKUP_TO_DISK_SHARED_PATH",
  "BACKUP_TO_DISK_SERVER_ONLY",
  "RAVEN_AGENT_BACKUP",
]);

const mssqlBackupPolicyBaseSchema = z.object({
  name: z.string().min(1, "Policy name is required").max(200),
  sourceConnectionId: z.string().min(1, "SQL Server source connection is required"),
  storageTargetId: optionalText,
  destinationMode: mssqlDestinationModeSchema,
  databaseSelectionMode: mssqlDatabaseSelectionModeSchema.default("SINGLE"),
  selectedDatabases: databaseNames.default([]),
  excludedDatabases: databaseNames.default([]),
  databasePattern: optionalText,
  fullFrequency: mssqlFullFrequencySchema.default("DAILY"),
  differentialFrequency: mssqlDifferentialFrequencySchema.optional().nullable().default("EVERY_6_HOURS"),
  logFrequency: mssqlLogFrequencySchema.optional().nullable().default("HOURLY"),
  fullTimeHour: z.coerce.number().int().min(0).max(23).default(2),
  fullTimeMinute: z.coerce.number().int().min(0).max(59).default(0),
  timezone: z.string().min(1).default("America/Chicago"),
  backupPath: optionalText,
  hermodReadablePath: optionalText,
  urlCredentialName: optionalText,
  urlBase: optionalText,
  compressionEnabled: z.boolean().default(true),
  checksumEnabled: z.boolean().default(true),
  copyOnly: z.boolean().default(false),
  verifyAfterBackup: z.boolean().default(true),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  enabled: z.boolean().default(true),
});

type MssqlBackupPolicyRefinementInput = {
  destinationMode?: z.infer<typeof mssqlDestinationModeSchema>;
  databaseSelectionMode?: z.infer<typeof mssqlDatabaseSelectionModeSchema>;
  selectedDatabases?: string[];
  databasePattern?: string;
  backupPath?: string;
  urlBase?: string;
  urlCredentialName?: string;
};

function refineMssqlBackupPolicy(data: MssqlBackupPolicyRefinementInput, ctx: z.RefinementCtx) {
  if (data.databaseSelectionMode === "SINGLE" && (data.selectedDatabases?.length ?? 0) > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedDatabases"], message: "SINGLE mode can only select one database" });
  }
  if (data.databaseSelectionMode === "MULTIPLE" && (data.selectedDatabases?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedDatabases"], message: "Select at least one database for MULTIPLE mode" });
  }
  if (data.databaseSelectionMode === "PATTERN" && !data.databasePattern) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["databasePattern"], message: "Database pattern is required for PATTERN mode" });
  }
  if ((data.destinationMode === "BACKUP_TO_DISK_SHARED_PATH" || data.destinationMode === "BACKUP_TO_DISK_SERVER_ONLY") && !data.backupPath) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backupPath"], message: "Backup path is required for disk backup modes" });
  }
  if (data.destinationMode === "BACKUP_TO_URL") {
    if (!data.urlBase) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["urlBase"], message: "URL base is required for BACKUP TO URL" });
    if (!data.urlCredentialName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["urlCredentialName"], message: "SQL Server credential name is required for BACKUP TO URL" });
  }
}

export const createMssqlBackupPolicySchema = mssqlBackupPolicyBaseSchema.superRefine(refineMssqlBackupPolicy);

export const updateMssqlBackupPolicySchema = mssqlBackupPolicyBaseSchema.partial()
  .extend({
    status: z.enum(["ACTIVE", "DISABLED", "ERROR"]).optional(),
  })
  .superRefine(refineMssqlBackupPolicy);

export const mssqlPreflightSchema = mssqlBackupPolicyBaseSchema.partial()
  .extend({
    sourceConnectionId: z.string().min(1),
  })
  .superRefine(refineMssqlBackupPolicy);

export type CreateMssqlBackupPolicyInput = z.infer<typeof createMssqlBackupPolicySchema>;
export type UpdateMssqlBackupPolicyInput = z.infer<typeof updateMssqlBackupPolicySchema>;
