import { decrypt } from "@/lib/crypto";
import { S3BackupStorage } from "./s3-storage";
import { GcsBackupStorage } from "./gcs-storage";
import type {
  BackupStorageProviderClient,
  PlainStorageTargetLike,
  StorageTargetLike,
} from "./types";

function parseEncryptedCredentials(target: StorageTargetLike): Record<string, unknown> | null {
  if (!target.credentials) return null;
  try {
    return JSON.parse(decrypt(target.credentials)) as Record<string, unknown>;
  } catch {
    throw new Error("Storage target credentials could not be decrypted");
  }
}

function credentialsRequired(accessMode: string | null | undefined): boolean {
  return accessMode === "AWS_ACCESS_KEY" ||
    accessMode === "AWS_ASSUME_ROLE" ||
    accessMode === "GCP_SERVICE_ACCOUNT_JSON";
}

function resolvePlainStorageProvider(
  target: PlainStorageTargetLike
): BackupStorageProviderClient {
  const config = (target.config ?? {}) as Record<string, unknown>;
  const credentials = target.credentials ?? null;
  const accessMode = target.accessMode;

  switch (target.provider) {
    case "AWS_S3": {
      if (credentialsRequired(accessMode) && !credentials) {
        throw new Error("Storage target credentials are missing");
      }
      return new S3BackupStorage(
        {
          bucket: String(config.bucket ?? ""),
          region: String(config.region ?? ""),
          prefix: String(config.prefix ?? "postgres"),
          endpoint: config.endpoint ? String(config.endpoint) : undefined,
          forcePathStyle: Boolean(config.forcePathStyle),
          encryption: config.encryption === "SSE_KMS" ? "SSE_KMS" : "SSE_S3",
          kmsKeyArn: config.kmsKeyArn ? String(config.kmsKeyArn) : null,
          retentionDays: config.retentionDays ? Number(config.retentionDays) : undefined,
        },
        credentials,
        accessMode === "AWS_ASSUME_ROLE" || accessMode === "AWS_RUNTIME_ROLE"
          ? accessMode
          : "AWS_ACCESS_KEY"
      );
    }
    case "GCP_GCS": {
      if (credentialsRequired(accessMode) && !credentials) {
        throw new Error("Storage target credentials are missing");
      }
      return new GcsBackupStorage(
        {
          bucket: String(config.bucket ?? ""),
          projectId: config.projectId ? String(config.projectId) : undefined,
          location: config.location ? String(config.location) : undefined,
          prefix: String(config.prefix ?? "postgres"),
          uniformBucketLevelAccess: config.uniformBucketLevelAccess !== false,
          retentionDays: config.retentionDays ? Number(config.retentionDays) : undefined,
        },
        credentials,
        accessMode === "GCP_APPLICATION_DEFAULT" || accessMode === "GCP_WORKLOAD_IDENTITY"
          ? accessMode
          : "GCP_SERVICE_ACCOUNT_JSON"
      );
    }
    case "AZURE_BLOB":
      throw new Error("Azure Blob storage targets are not implemented yet");
    default:
      throw new Error(`Unsupported backup storage provider: ${target.provider}`);
  }
}

export function getBackupStorageProvider(
  target: StorageTargetLike
): BackupStorageProviderClient {
  return resolvePlainStorageProvider({
    provider: target.provider,
    accessMode: target.accessMode ?? (target.provider === "GCP_GCS" ? "GCP_SERVICE_ACCOUNT_JSON" : "AWS_ACCESS_KEY"),
    config: target.config,
    credentials: parseEncryptedCredentials(target),
  });
}

export function getBackupStorageProviderFromPlain(
  target: PlainStorageTargetLike
): BackupStorageProviderClient {
  return resolvePlainStorageProvider(target);
}

export type {
  BackupObjectMetadata,
  BackupStorageProviderClient,
  StorageTestCheck,
  StorageTestResult,
} from "./types";
