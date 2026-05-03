import { describe, expect, it } from "vitest";
import { generateAwsS3CliCommands } from "@/lib/backups/provisioning/aws-cloudformation";
import { generateGcpStorageCommands } from "@/lib/backups/provisioning/gcp-commands";
import { serializeStorageTarget } from "@/lib/backups/api-helpers";
import { getBackupStorageProviderFromPlain } from "@/lib/backups/storage";
import { GcsBackupStorage } from "@/lib/backups/storage/gcs-storage";
import { S3BackupStorage } from "@/lib/backups/storage/s3-storage";
import { makeBackupStorageTarget } from "@/__tests__/helpers/factories";
import { expectNoSensitiveKeys } from "@/__tests__/helpers/api-test";

describe("backup storage target guardrails", () => {
  it("resolves AWS and GCP storage providers without hitting external services", () => {
    const aws = getBackupStorageProviderFromPlain({
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "hermod-backups-test",
        region: "us-east-1",
        prefix: "backups",
      },
      credentials: null,
    });
    const gcp = getBackupStorageProviderFromPlain({
      provider: "GCP_GCS",
      accessMode: "GCP_APPLICATION_DEFAULT",
      config: {
        bucket: "hermod-backups-test",
        projectId: "project-test",
        prefix: "backups",
      },
      credentials: null,
    });

    expect(aws).toBeInstanceOf(S3BackupStorage);
    expect(gcp).toBeInstanceOf(GcsBackupStorage);
  });

  it("requires credentials for saved targets that use explicit credential modes", () => {
    expect(() => getBackupStorageProviderFromPlain({
      provider: "AWS_S3",
      accessMode: "AWS_ACCESS_KEY",
      config: {
        bucket: "hermod-backups-test",
        region: "us-east-1",
        prefix: "backups",
      },
      credentials: null,
    })).toThrow("Storage target credentials are missing");
  });

  it("does not return saved storage credentials after serialization", () => {
    const output = serializeStorageTarget(makeBackupStorageTarget({
      credentials: "encrypted-storage-credentials",
    }));

    expectNoSensitiveKeys(output);
  });

  it("generates AWS and GCP setup commands without embedding credential secrets", () => {
    const awsCommands = generateAwsS3CliCommands({
      bucket: "hermod-backups-test",
      region: "us-east-1",
      prefix: "backups",
      retentionDays: 30,
      encryption: "SSE_S3",
      versioningEnabled: true,
      accessMode: "AWS_ASSUME_ROLE",
      externalId: "hrm_ext_test",
      createTarget: false,
    }).join("\n");

    const gcpCommands = generateGcpStorageCommands({
      bucket: "hermod-backups-test",
      projectId: "project-test",
      location: "us-central1",
      prefix: "backups",
      retentionDays: 30,
      uniformBucketLevelAccess: true,
      accessMode: "GCP_APPLICATION_DEFAULT",
      createTarget: false,
    }).join("\n");

    for (const commands of [awsCommands, gcpCommands]) {
      expect(commands).not.toMatch(/secretAccessKey|accessKeyId|serviceAccountKey|private_key|client_email|PGPASSWORD/i);
      expect(commands).not.toContain("test-secret-key");
    }
  });
});
