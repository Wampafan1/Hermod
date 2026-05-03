import { createReadStream, createWriteStream } from "fs";
import { stat, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type {
  BackupObjectMetadata,
  BackupStorageProviderClient,
  BackupUploadMetadata,
  StorageTestCheck,
  StorageTestResult,
} from "./types";

interface S3StorageConfig {
  bucket: string;
  region: string;
  prefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  encryption?: "SSE_S3" | "SSE_KMS";
  kmsKeyArn?: string | null;
  retentionDays?: number;
}

interface S3StorageCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  roleArn?: string;
  externalId?: string;
}

export type S3StorageAccessMode = "AWS_ASSUME_ROLE" | "AWS_ACCESS_KEY" | "AWS_RUNTIME_ROLE";

function metadataToS3(metadata?: Record<string, string> | BackupUploadMetadata): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function pushCheck(checks: StorageTestCheck[], name: string, status: StorageTestCheck["status"], message?: string) {
  checks.push({ name, status, message });
}

type AwsSdkError = Error & {
  Code?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
  $response?: {
    headers?: Record<string, string | string[] | undefined>;
  };
};

function headerValue(error: AwsSdkError, name: string): string | undefined {
  const headers = error.$response?.headers;
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeAwsErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const awsError = error as AwsSdkError;
  const code = awsError.Code || awsError.name;
  const status = awsError.$metadata?.httpStatusCode;
  const region = headerValue(awsError, "x-amz-bucket-region");
  const suffix = status ? ` AWS returned HTTP ${status}${code ? ` (${code})` : ""}.` : code ? ` AWS returned ${code}.` : "";

  if (error.message.startsWith("AWS STS could not assume the backup role.")) {
    return error.message;
  }
  if (status === 301 || code === "PermanentRedirect") {
    return region
      ? `Bucket is in ${region}, but this target is configured for a different region.${suffix}`
      : `Bucket is in a different region than this target configuration.${suffix}`;
  }
  if (code === "KMS.AccessDeniedException" || code === "KMSAccessDeniedException" || /kms:/i.test(error.message)) {
    return `AWS KMS denied encryption access. If this target uses SSE-KMS, the backup role or access key also needs kms:Encrypt, kms:Decrypt, kms:GenerateDataKey, and kms:DescribeKey on the configured KMS key.${suffix}`;
  }
  if (status === 403 || code === "AccessDenied") {
    return `Access denied for this bucket. Check that these credentials can run s3:ListBucket and s3:GetBucketLocation on the bucket, plus read/write/delete objects in the backup bucket.${suffix}`;
  }
  if (status === 404 || code === "NoSuchBucket" || code === "NotFound") {
    return `Bucket was not found. Check the bucket name, AWS account, and region.${suffix}`;
  }
  if (code === "InvalidAccessKeyId") {
    return `AWS did not recognize the access key ID.${suffix}`;
  }
  if (code === "SignatureDoesNotMatch") {
    return `AWS rejected the request signature. Check the secret access key and region.${suffix}`;
  }
  if (code === "ExpiredToken") {
    return `AWS session token is expired. Refresh the temporary credentials or use role-based access.${suffix}`;
  }
  if (code === "CredentialsProviderError") {
    return `AWS credentials could not be resolved. Check the selected access mode and required credential fields.${suffix}`;
  }

  return `${fallback}${suffix || ` ${error.message}`}`;
}

function safeStsAssumeRoleErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "AWS STS could not assume the backup role. Check the role trust policy, ExternalId, and caller permissions.";
  }

  const awsError = error as AwsSdkError;
  const code = awsError.Code || awsError.name;
  const status = awsError.$metadata?.httpStatusCode;
  const suffix = status ? ` AWS returned HTTP ${status}${code ? ` (${code})` : ""}.` : code ? ` AWS returned ${code}.` : "";

  if (status === 403 || code === "AccessDenied" || code === "AccessDeniedException") {
    return `AWS STS denied AssumeRole. Check that the target role trust policy Principal is the actual Hermod runtime principal, the ExternalId matches exactly, and the Hermod runtime principal is allowed to call sts:AssumeRole on this role.${suffix}`;
  }
  if (code === "InvalidClientTokenId" || code === "UnrecognizedClientException") {
    return `AWS STS did not recognize the runtime credentials used to assume the role.${suffix}`;
  }
  if (code === "SignatureDoesNotMatch") {
    return `AWS STS rejected the request signature while assuming the role. Check the runtime AWS credentials and region.${suffix}`;
  }
  if (code === "ExpiredToken") {
    return `AWS STS runtime credentials are expired. Refresh the runtime credentials or use a role attached to the deployment.${suffix}`;
  }
  if (code === "CredentialsProviderError") {
    return `AWS runtime credentials could not be resolved before assuming the backup role. Use Runtime Role only where the Hermod process has AWS credentials, or use access-key fallback.${suffix}`;
  }

  return `AWS STS could not assume the backup role. Check the role trust policy Principal, ExternalId, and caller sts:AssumeRole permission.${suffix || ` ${error.message}`}`;
}

export class S3BackupStorage implements BackupStorageProviderClient {
  private client: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    private readonly credentials: S3StorageCredentials | null = null,
    private readonly accessMode: S3StorageAccessMode = "AWS_ACCESS_KEY"
  ) {
    const clientConfig: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    };

    if (accessMode === "AWS_ACCESS_KEY") {
      if (!credentials?.accessKeyId || !credentials.secretAccessKey) {
        throw new Error("AWS access key credentials are required for this storage target");
      }
      clientConfig.credentials = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      };
    }

    if (accessMode === "AWS_ASSUME_ROLE") {
      if (!credentials?.roleArn || !credentials.externalId) {
        throw new Error("AWS role ARN and ExternalId are required for assume-role access");
      }
      clientConfig.credentials = async () => {
        const sts = new STSClient({ region: config.region });
        let assumed;
        try {
          assumed = await sts.send(new AssumeRoleCommand({
            RoleArn: credentials.roleArn,
            ExternalId: credentials.externalId,
            RoleSessionName: `hermod-backup-${Date.now()}`,
            DurationSeconds: 3600,
          }));
        } catch (error) {
          throw new Error(safeStsAssumeRoleErrorMessage(error));
        }
        if (!assumed.Credentials?.AccessKeyId || !assumed.Credentials.SecretAccessKey) {
          throw new Error("AWS did not return temporary credentials for the backup role");
        }
        return {
          accessKeyId: assumed.Credentials.AccessKeyId,
          secretAccessKey: assumed.Credentials.SecretAccessKey,
          sessionToken: assumed.Credentials.SessionToken,
          expiration: assumed.Credentials.Expiration,
        };
      };
    }

    this.client = new S3Client(clientConfig);
  }

  async uploadFile(
    localPath: string,
    objectKey: string,
    metadata?: Record<string, string> | BackupUploadMetadata
  ): Promise<BackupObjectMetadata> {
    const fileStat = await stat(localPath);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        Body: createReadStream(localPath),
        Metadata: metadataToS3(metadata),
        ServerSideEncryption: this.config.encryption === "SSE_KMS" ? "aws:kms" : "AES256",
        SSEKMSKeyId: this.config.encryption === "SSE_KMS" && this.config.kmsKeyArn
          ? this.config.kmsKeyArn
          : undefined,
      })
    );

    return {
      key: objectKey,
      bytes: fileStat.size,
      etag: result.ETag,
      lastModified: new Date(),
    };
  }

  async downloadFile(objectKey: string, localPath: string): Promise<{ bytes: number }> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
      })
    );
    if (!result.Body) {
      throw new Error("Storage object returned an empty body");
    }
    await pipeline(result.Body as Readable, createWriteStream(localPath));
    const fileStat = await stat(localPath);
    return { bytes: fileStat.size };
  }

  async list(prefix: string): Promise<BackupObjectMetadata[]> {
    const objects: BackupObjectMetadata[] = [];
    let token: string | undefined;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: token,
        })
      );

      for (const item of result.Contents ?? []) {
        if (!item.Key) continue;
        objects.push({
          key: item.Key,
          bytes: Number(item.Size ?? 0),
          etag: item.ETag,
          lastModified: item.LastModified,
        });
      }
      token = result.NextContinuationToken;
    } while (token);

    return objects;
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
      })
    );
  }

  async test(): Promise<StorageTestResult> {
    const checks: StorageTestCheck[] = [];
    const prefix = this.config.prefix ? this.config.prefix.replace(/^\/+|\/+$/g, "") : "postgres";
    const testKey = `${prefix}/.hermod-storage-test-${randomUUID()}.txt`;
    const localPath = path.join(os.tmpdir(), `hermod-storage-test-${randomUUID()}.txt`);

    try {
      const location = await this.client.send(new GetBucketLocationCommand({ Bucket: this.config.bucket }));
      const actualRegion = location.LocationConstraint || "us-east-1";
      const expected = this.config.region || actualRegion;
      pushCheck(checks, "Bucket exists", "passed");
      pushCheck(
        checks,
        "Region matches",
        actualRegion === expected ? "passed" : "warning",
        actualRegion === expected ? undefined : `Bucket reports ${actualRegion}; configured ${expected}`
      );
    } catch (error) {
      const message = safeAwsErrorMessage(error, "Bucket location could not be read.");
      pushCheck(checks, "Bucket exists", "failed", message);
      pushCheck(checks, "Region matches", "warning", "Skipped because bucket location could not be read");
      return { ok: false, checks, error: message };
    }

    try {
      await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        MaxKeys: 1,
      }));
      pushCheck(checks, "List test prefix", "passed");
    } catch (error) {
      pushCheck(checks, "List test prefix", "failed", safeAwsErrorMessage(error, "Could not list the test prefix."));
    }

    try {
      await writeFile(localPath, "hermod-storage-test");
      await this.uploadFile(localPath, testKey, { purpose: "hermod-storage-test" });
      pushCheck(checks, "Write test object", "passed");
    } catch (error) {
      pushCheck(checks, "Write test object", "failed", safeAwsErrorMessage(error, "Could not write the test object."));
    }

    try {
      const downloadPath = `${localPath}.download`;
      await this.downloadFile(testKey, downloadPath);
      await rm(downloadPath, { force: true });
      pushCheck(checks, "Read test object", "passed");
    } catch (error) {
      pushCheck(checks, "Read test object", "failed", safeAwsErrorMessage(error, "Could not read the test object."));
    }

    try {
      await this.delete(testKey);
      pushCheck(checks, "Delete test object", "passed");
    } catch (error) {
      pushCheck(checks, "Delete test object", "failed", safeAwsErrorMessage(error, "Could not delete the test object."));
    } finally {
      await rm(localPath, { force: true });
    }

    try {
      const encryption = await this.client.send(new GetBucketEncryptionCommand({ Bucket: this.config.bucket }));
      const rules = encryption.ServerSideEncryptionConfiguration?.Rules ?? [];
      pushCheck(checks, "Encryption enabled", rules.length > 0 ? "passed" : "warning", rules.length > 0 ? undefined : "No bucket encryption rules found");
    } catch {
      pushCheck(checks, "Encryption enabled", "warning", "Could not verify bucket encryption");
    }

    try {
      const lifecycle = await this.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.config.bucket }));
      const hasExpiration = (lifecycle.Rules ?? []).some((rule) => !!rule.Expiration);
      pushCheck(checks, "Lifecycle rule found", hasExpiration ? "passed" : "warning", hasExpiration ? undefined : "No expiration lifecycle rule found");
    } catch {
      pushCheck(checks, "Lifecycle rule found", "warning", "Could not verify lifecycle rules");
    }

    const ok = checks.every((check) => check.status !== "failed");
    return { ok, checks, error: ok ? undefined : "One or more storage checks failed" };
  }
}
