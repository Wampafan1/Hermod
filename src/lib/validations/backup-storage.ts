import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const nullableText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().nullable().optional()
);

const awsBucketName = z.string()
  .min(3)
  .max(63)
  .regex(/^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Use a valid S3 bucket name")
  .refine((value) => !value.includes("..") && !value.includes(".-") && !value.includes("-."), "Use a valid S3 bucket name");

const gcpBucketName = z.string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/, "Use a valid GCS bucket name")
  .refine((value) => !value.includes("..") && !value.startsWith("goog"), "Use a valid GCS bucket name");

export const storagePrefixSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? "backups" : value),
  z.string()
    .trim()
    .default("backups")
    .refine((value) => !value.startsWith("/") && !value.includes("..") && !/[;&|`$<>\\]/.test(value), {
      message: "Prefix must be relative and cannot contain shell metacharacters",
    })
);

export const backupStorageProviderSchema = z.enum(["AWS_S3", "GCP_GCS"]);
export const backupStorageStatusSchema = z.enum(["ACTIVE", "ERROR", "DISABLED"]);
export const backupStorageAccessModeSchema = z.enum([
  "AWS_ASSUME_ROLE",
  "AWS_ACCESS_KEY",
  "AWS_RUNTIME_ROLE",
  "GCP_SERVICE_ACCOUNT_JSON",
  "GCP_WORKLOAD_IDENTITY",
  "GCP_APPLICATION_DEFAULT",
]);

export const awsS3ConfigSchema = z.object({
  bucket: awsBucketName,
  region: z.string().min(1, "AWS region is required").regex(/^[a-z]{2}-[a-z]+-\d$/, "Use an AWS region like us-east-1"),
  prefix: storagePrefixSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  encryption: z.enum(["SSE_S3", "SSE_KMS"]).default("SSE_S3"),
  kmsKeyArn: nullableText,
  versioningEnabled: z.boolean().default(true),
  endpoint: optionalText,
  forcePathStyle: z.boolean().default(false),
});

export const awsCredentialsSchema = z.object({
  roleArn: optionalText,
  externalId: optionalText,
  accessKeyId: optionalText,
  secretAccessKey: optionalText,
  sessionToken: optionalText,
});

export const gcsConfigSchema = z.object({
  bucket: gcpBucketName,
  projectId: optionalText,
  location: z.string().min(1).default("us-central1"),
  prefix: storagePrefixSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  uniformBucketLevelAccess: z.boolean().default(true),
});

export const gcsCredentialsSchema = z.object({
  serviceAccountKey: z.union([z.string().min(1), z.record(z.unknown())]).optional(),
});

const awsTargetSchema = z.object({
  name: z.string().min(1, "Storage target name is required").max(200),
  provider: z.literal("AWS_S3"),
  accessMode: z.enum(["AWS_ASSUME_ROLE", "AWS_ACCESS_KEY", "AWS_RUNTIME_ROLE"]),
  config: awsS3ConfigSchema,
  credentials: awsCredentialsSchema.nullish(),
  status: backupStorageStatusSchema.default("ACTIVE"),
});

const gcpTargetSchema = z.object({
  name: z.string().min(1, "Storage target name is required").max(200),
  provider: z.literal("GCP_GCS"),
  accessMode: z.enum(["GCP_SERVICE_ACCOUNT_JSON", "GCP_APPLICATION_DEFAULT", "GCP_WORKLOAD_IDENTITY"]),
  config: gcsConfigSchema,
  credentials: gcsCredentialsSchema.nullish(),
  status: backupStorageStatusSchema.default("ACTIVE"),
});

export const createStorageTargetSchema = z.discriminatedUnion("provider", [
  awsTargetSchema,
  gcpTargetSchema,
]).superRefine((data, ctx) => {
  if (data.provider === "AWS_S3" && data.accessMode === "AWS_ACCESS_KEY") {
    if (!data.credentials?.accessKeyId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "accessKeyId"], message: "Access key ID is required" });
    }
    if (!data.credentials?.secretAccessKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "secretAccessKey"], message: "Secret access key is required" });
    }
  }
  if (data.provider === "AWS_S3" && data.accessMode === "AWS_ASSUME_ROLE") {
    if (!data.credentials?.roleArn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "roleArn"], message: "Role ARN is required" });
    }
    if (!data.credentials?.externalId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "externalId"], message: "ExternalId is required" });
    }
  }
  if (data.provider === "GCP_GCS" && data.accessMode === "GCP_SERVICE_ACCOUNT_JSON" && !data.credentials?.serviceAccountKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["credentials", "serviceAccountKey"],
      message: "Service account JSON is required",
    });
  }
  if (data.provider === "GCP_GCS" && data.accessMode === "GCP_WORKLOAD_IDENTITY") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessMode"],
      message: "GCP Workload Identity Federation is coming soon",
    });
  }
});

export const testUnsavedStorageTargetSchema = createStorageTargetSchema;

export const updateStorageTargetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  provider: backupStorageProviderSchema.optional(),
  accessMode: backupStorageAccessModeSchema.optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).nullable().optional(),
  status: backupStorageStatusSchema.optional(),
});

export const awsProvisioningRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bucket: awsBucketName,
  region: z.string().min(1).default("us-east-1"),
  prefix: storagePrefixSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  encryption: z.enum(["SSE_S3", "SSE_KMS"]).default("SSE_S3"),
  kmsKeyArn: nullableText,
  versioningEnabled: z.boolean().default(true),
  accessMode: z.enum(["AWS_ASSUME_ROLE", "AWS_RUNTIME_ROLE"]).default("AWS_ASSUME_ROLE"),
  externalId: optionalText,
  createTarget: z.boolean().default(false),
});

export const gcpProvisioningRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bucket: gcpBucketName,
  projectId: optionalText,
  location: z.string().min(1).default("us-central1"),
  prefix: storagePrefixSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650).default(30),
  uniformBucketLevelAccess: z.boolean().default(true),
  accessMode: z.enum(["GCP_APPLICATION_DEFAULT"]).default("GCP_APPLICATION_DEFAULT"),
  createTarget: z.boolean().default(false),
});

export type CreateStorageTargetInput = z.infer<typeof createStorageTargetSchema>;
export type UpdateStorageTargetInput = z.infer<typeof updateStorageTargetSchema>;
export type AwsProvisioningRequestInput = z.infer<typeof awsProvisioningRequestSchema>;
export type GcpProvisioningRequestInput = z.infer<typeof gcpProvisioningRequestSchema>;
