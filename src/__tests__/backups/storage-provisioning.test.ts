import { describe, expect, it } from "vitest";
import {
  generateAwsIamPolicy,
  generateAwsS3CliCommands,
  generateHermodS3CloudFormationTemplate,
} from "@/lib/backups/provisioning/aws-cloudformation";
import { generateGcpStorageCommands } from "@/lib/backups/provisioning/gcp-commands";
import { createStorageTargetSchema } from "@/lib/validations/backup-storage";

const awsInput = {
  bucket: "hermod-backups-acme-prod",
  region: "us-east-1",
  prefix: "postgres",
  retentionDays: 30,
  encryption: "SSE_S3" as const,
  kmsKeyArn: null,
  versioningEnabled: true,
  accessMode: "AWS_ASSUME_ROLE" as const,
  externalId: "hrm_ext_test",
  createTarget: false,
};

describe("backup storage provisioning helpers", () => {
  it("generates CloudFormation with encryption, lifecycle retention, and ExternalId trust", () => {
    const { template } = generateHermodS3CloudFormationTemplate(awsInput);
    const resources = template.Resources;

    expect(resources.HermodBackupBucket.Properties.BucketEncryption).toBeTruthy();
    expect(resources.HermodBackupBucket.Properties.LifecycleConfiguration.Rules[0]).toMatchObject({
      Status: "Enabled",
      Prefix: "postgres/",
      ExpirationInDays: 30,
    });
    expect(resources.HermodBackupRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition).toEqual({
      StringEquals: { "sts:ExternalId": "hrm_ext_test" },
    });
  });

  it("scopes AWS IAM policy to the dedicated bucket", () => {
    const policy = generateAwsIamPolicy({ bucket: awsInput.bucket, prefix: awsInput.prefix });
    const objectAccess = policy.Statement.find((statement) => statement.Sid === "HermodBackupBucketObjectAccess");
    const bucketAccess = policy.Statement.find((statement) => statement.Sid === "HermodBackupBucketAccess");

    expect(objectAccess?.Resource).toEqual([
      "arn:aws:s3:::hermod-backups-acme-prod/*",
    ]);
    expect(bucketAccess?.Action).toEqual([
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:ListBucketMultipartUploads",
    ]);
    expect(bucketAccess?.Resource).toEqual([
      "arn:aws:s3:::hermod-backups-acme-prod",
    ]);
    expect(bucketAccess).not.toHaveProperty("Condition");
  });

  it("adds KMS permissions when SSE-KMS is configured", () => {
    const kmsKeyArn = "arn:aws:kms:us-east-1:123456789012:key/example";
    const policy = generateAwsIamPolicy({ bucket: awsInput.bucket, prefix: awsInput.prefix, kmsKeyArn });
    expect(policy.Statement).toContainEqual({
      Sid: "HermodBackupKmsAccess",
      Effect: "Allow",
      Action: [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey",
      ],
      Resource: [kmsKeyArn],
    });
  });

  it("does not place secrets in generated AWS or GCP commands", () => {
    const awsCommands = generateAwsS3CliCommands({
      ...awsInput,
      accessMode: "AWS_ASSUME_ROLE",
      externalId: "hrm_ext_test",
    }).join("\n");
    const gcpCommands = generateGcpStorageCommands({
      bucket: "hermod-backups-acme-prod",
      projectId: "acme-prod",
      location: "us-central1",
      prefix: "postgres",
      retentionDays: 30,
      uniformBucketLevelAccess: true,
      accessMode: "GCP_APPLICATION_DEFAULT",
      createTarget: false,
    }).join("\n");

    expect(awsCommands).not.toMatch(/secretAccessKey|AKIA|private_key/i);
    expect(gcpCommands).not.toMatch(/private_key|BEGIN PRIVATE KEY/i);
  });

  it("rejects unsafe bucket names and prefixes", () => {
    const badBucket = createStorageTargetSchema.safeParse({
      name: "Bad",
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "Bad_Bucket",
        region: "us-east-1",
        prefix: "postgres",
        retentionDays: 30,
        encryption: "SSE_S3",
        versioningEnabled: true,
      },
    });
    const badPrefix = createStorageTargetSchema.safeParse({
      name: "Bad",
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: {
        bucket: "hermod-backups-good",
        region: "us-east-1",
        prefix: "../prod;rm",
        retentionDays: 30,
        encryption: "SSE_S3",
        versioningEnabled: true,
      },
    });

    expect(badBucket.success).toBe(false);
    expect(badPrefix.success).toBe(false);
  });
});
