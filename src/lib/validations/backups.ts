import { z } from "zod";
export {
  backupStorageProviderSchema,
  createStorageTargetSchema,
  updateStorageTargetSchema,
  type CreateStorageTargetInput,
  type UpdateStorageTargetInput,
} from "./backup-storage";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const storagePrefix = optionalText.refine(
  (value) => !value || !value.startsWith("/") && !value.includes(".."),
  "Prefix must be relative and cannot contain .."
);

export const fullBackupFrequencySchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export const walBackupFrequencySchema = z.enum(["HOURLY", "EVERY_4_HOURS", "EVERY_12_HOURS", "DAILY"]);
export const restoreModeSchema = z.enum(["LOGICAL_PG_RESTORE", "PHYSICAL_PITR_PREPARE"]);
export const databaseSelectionModeSchema = z.enum(["SINGLE", "MULTIPLE", "ALL_NON_TEMPLATE", "PATTERN"]);

const databaseName = z.string().trim().min(1).max(128).regex(/^[^/\0]+$/, "Database name cannot contain slash or null characters");
const databaseNames = z.array(databaseName).default([]);

export const restoreOptionsSchema = z.object({
  clean: z.boolean().default(true),
  ifExists: z.boolean().default(true),
  noOwner: z.boolean().default(true),
  noPrivileges: z.boolean().default(true),
  confirmation: z.string().trim().min(1, "Confirmation phrase is required"),
  allowSameSourceRestore: z.boolean().optional().default(false),
  pointInTime: optionalText,
  targetDatabase: optionalText,
});

export const restoreCreateSchema = z.object({
  policyId: z.string().min(1, "Backup policy is required"),
  backupRunId: z.string().min(1, "Restore point is required"),
  targetConnectionId: z.string().min(1, "Target PostgreSQL connection is required"),
  mode: restoreModeSchema.default("LOGICAL_PG_RESTORE"),
  objectKey: optionalText,
  options: restoreOptionsSchema,
});

export const createBackupPolicySchema = z.object({
  name: z.string().min(1, "Policy name is required").max(200),
  sourceConnectionId: z.string().min(1, "PostgreSQL source connection is required"),
  storageTargetId: z.string().min(1, "Storage target is required"),
  fullFrequency: fullBackupFrequencySchema.default("DAILY"),
  walFrequency: walBackupFrequencySchema.default("HOURLY"),
  timeHour: z.coerce.number().int().min(0).max(23).default(2),
  timeMinute: z.coerce.number().int().min(0).max(59).default(0),
  timezone: z.string().min(1).default("America/Chicago"),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  storagePrefix,
  databaseSelectionMode: databaseSelectionModeSchema.default("SINGLE"),
  selectedDatabases: databaseNames,
  excludedDatabases: databaseNames,
  databasePattern: optionalText,
  walEnabled: z.boolean().default(false),
  replicationSlot: optionalText,
  enabled: z.boolean().default(true),
}).superRefine((data, ctx) => {
  if (data.walEnabled && !data.replicationSlot) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["replicationSlot"],
      message: "Replication slot is required when WAL/PITR coverage is enabled",
    });
  }
  if (data.databaseSelectionMode === "SINGLE" && data.selectedDatabases.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedDatabases"],
      message: "SINGLE mode can only select one database",
    });
  }
  if (data.databaseSelectionMode === "MULTIPLE" && data.selectedDatabases.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedDatabases"],
      message: "Select at least one database for MULTIPLE mode",
    });
  }
  if (data.databaseSelectionMode === "PATTERN" && !data.databasePattern) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["databasePattern"],
      message: "Database pattern is required for PATTERN mode",
    });
  }
});

export const updateBackupPolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  sourceConnectionId: z.string().min(1).optional(),
  storageTargetId: z.string().min(1).optional(),
  fullFrequency: fullBackupFrequencySchema.optional(),
  walFrequency: walBackupFrequencySchema.optional().nullable(),
  timeHour: z.coerce.number().int().min(0).max(23).optional(),
  timeMinute: z.coerce.number().int().min(0).max(59).optional(),
  timezone: z.string().min(1).optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  storagePrefix,
  databaseSelectionMode: databaseSelectionModeSchema.optional(),
  selectedDatabases: z.array(databaseName).optional(),
  excludedDatabases: z.array(databaseName).optional(),
  databasePattern: optionalText,
  walEnabled: z.boolean().optional(),
  replicationSlot: optionalText,
  status: z.enum(["ACTIVE", "DISABLED", "DEGRADED", "ERROR"]).optional(),
});

export type CreateBackupPolicyInput = z.infer<typeof createBackupPolicySchema>;
export type UpdateBackupPolicyInput = z.infer<typeof updateBackupPolicySchema>;
export type RestoreCreateInput = z.infer<typeof restoreCreateSchema>;
