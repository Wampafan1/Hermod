import { stat, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import type {
  BackupObjectMetadata,
  BackupStorageProviderClient,
  BackupUploadMetadata,
  StorageTestCheck,
  StorageTestResult,
} from "./types";

interface GcsStorageConfig {
  bucket: string;
  projectId?: string;
  location?: string;
  prefix?: string;
  uniformBucketLevelAccess?: boolean;
  retentionDays?: number;
}

interface GcsStorageCredentials {
  serviceAccountKey?: string | Record<string, unknown>;
}

export type GcsStorageAccessMode =
  | "GCP_SERVICE_ACCOUNT_JSON"
  | "GCP_APPLICATION_DEFAULT"
  | "GCP_WORKLOAD_IDENTITY";

function parseServiceAccountKey(key: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof key === "string") {
    try {
      return JSON.parse(key) as Record<string, unknown>;
    } catch {
      throw new Error("Google Cloud service account key must be valid JSON");
    }
  }
  return key;
}

function pushCheck(checks: StorageTestCheck[], name: string, status: StorageTestCheck["status"], message?: string) {
  checks.push({ name, status, message });
}

export class GcsBackupStorage implements BackupStorageProviderClient {
  private storage: Storage;

  constructor(
    private readonly config: GcsStorageConfig,
    credentials: GcsStorageCredentials | null = null,
    accessMode: GcsStorageAccessMode = "GCP_SERVICE_ACCOUNT_JSON"
  ) {
    if (accessMode === "GCP_WORKLOAD_IDENTITY") {
      throw new Error("GCP Workload Identity Federation is not implemented yet");
    }

    if (accessMode === "GCP_SERVICE_ACCOUNT_JSON") {
      if (!credentials?.serviceAccountKey) {
        throw new Error("Google service account JSON is required for this storage target");
      }
      const serviceAccountKey = parseServiceAccountKey(credentials.serviceAccountKey);
      const projectId = config.projectId ?? (serviceAccountKey.project_id as string | undefined);
      this.storage = new Storage({
        projectId,
        credentials: serviceAccountKey,
      });
      return;
    }

    this.storage = new Storage({ projectId: config.projectId });
  }

  async uploadFile(
    localPath: string,
    objectKey: string,
    metadata?: Record<string, string> | BackupUploadMetadata
  ): Promise<BackupObjectMetadata> {
    const fileStat = await stat(localPath);
    await this.storage.bucket(this.config.bucket).upload(localPath, {
      destination: objectKey,
      metadata: {
        metadata,
      },
      resumable: false,
    });
    const [objectMetadata] = await this.storage.bucket(this.config.bucket).file(objectKey).getMetadata();

    return {
      key: objectKey,
      bytes: fileStat.size,
      etag: objectMetadata.etag,
      lastModified: objectMetadata.updated ? new Date(objectMetadata.updated) : new Date(),
    };
  }

  async downloadFile(objectKey: string, localPath: string): Promise<{ bytes: number }> {
    await this.storage.bucket(this.config.bucket).file(objectKey).download({ destination: localPath });
    const fileStat = await stat(localPath);
    return { bytes: fileStat.size };
  }

  async list(prefix: string): Promise<BackupObjectMetadata[]> {
    const [files] = await this.storage.bucket(this.config.bucket).getFiles({ prefix });
    return files.map((file) => ({
      key: file.name,
      bytes: Number(file.metadata.size ?? 0),
      etag: file.metadata.etag,
      lastModified: file.metadata.updated ? new Date(file.metadata.updated) : undefined,
    }));
  }

  async delete(objectKey: string): Promise<void> {
    await this.storage.bucket(this.config.bucket).file(objectKey).delete({ ignoreNotFound: true });
  }

  async test(): Promise<StorageTestResult> {
    const checks: StorageTestCheck[] = [];
    const bucket = this.storage.bucket(this.config.bucket);
    const prefix = this.config.prefix ? this.config.prefix.replace(/^\/+|\/+$/g, "") : "backups";
    const testKey = `${prefix}/.hermod-storage-test-${randomUUID()}.txt`;
    const localPath = path.join(os.tmpdir(), `hermod-storage-test-${randomUUID()}.txt`);

    try {
      const [exists] = await bucket.exists();
      pushCheck(checks, "Bucket exists", exists ? "passed" : "failed", exists ? undefined : "Bucket does not exist");
      if (!exists) return { ok: false, checks, error: "Bucket does not exist" };
    } catch (error) {
      pushCheck(checks, "Bucket exists", "failed", error instanceof Error ? error.message : "Bucket check failed");
      return { ok: false, checks, error: "Bucket could not be accessed" };
    }

    try {
      const [metadata] = await bucket.getMetadata();
      const actualLocation = String(metadata.location ?? "");
      const expected = this.config.location ?? actualLocation;
      pushCheck(
        checks,
        "Location matches",
        !expected || actualLocation.toLowerCase() === expected.toLowerCase() ? "passed" : "warning",
        actualLocation && expected && actualLocation.toLowerCase() !== expected.toLowerCase()
          ? `Bucket reports ${actualLocation}; configured ${expected}`
          : undefined
      );
      const uniformEnabled = metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled;
      pushCheck(
        checks,
        "Uniform bucket-level access",
        this.config.uniformBucketLevelAccess === false || uniformEnabled ? "passed" : "warning",
        uniformEnabled ? undefined : "Uniform access was not reported as enabled"
      );
      const lifecycleRules = metadata.lifecycle?.rule ?? [];
      pushCheck(
        checks,
        "Lifecycle rule found",
        lifecycleRules.length > 0 ? "passed" : "warning",
        lifecycleRules.length > 0 ? undefined : "No lifecycle rule found"
      );
    } catch (error) {
      pushCheck(checks, "Location matches", "warning", error instanceof Error ? error.message : "Could not read bucket metadata");
      pushCheck(checks, "Lifecycle rule found", "warning", "Could not verify lifecycle rules");
    }

    try {
      await bucket.getFiles({ prefix, maxResults: 1 });
      pushCheck(checks, "List configured prefix", "passed");
    } catch (error) {
      pushCheck(checks, "List configured prefix", "failed", error instanceof Error ? error.message : "List failed");
    }

    try {
      await writeFile(localPath, "hermod-storage-test");
      await this.uploadFile(localPath, testKey, { purpose: "hermod-storage-test" });
      pushCheck(checks, "Write test object", "passed");
    } catch (error) {
      pushCheck(checks, "Write test object", "failed", error instanceof Error ? error.message : "Write failed");
    }

    try {
      const downloadPath = `${localPath}.download`;
      await this.downloadFile(testKey, downloadPath);
      await rm(downloadPath, { force: true });
      pushCheck(checks, "Read test object", "passed");
    } catch (error) {
      pushCheck(checks, "Read test object", "failed", error instanceof Error ? error.message : "Read failed");
    }

    try {
      await this.delete(testKey);
      pushCheck(checks, "Delete test object", "passed");
    } catch (error) {
      pushCheck(checks, "Delete test object", "failed", error instanceof Error ? error.message : "Delete failed");
    } finally {
      await rm(localPath, { force: true });
    }

    const ok = checks.every((check) => check.status !== "failed");
    return { ok, checks, error: ok ? undefined : "One or more storage checks failed" };
  }
}
