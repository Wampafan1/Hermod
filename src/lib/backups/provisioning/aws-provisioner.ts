import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsProvisioningRequestInput } from "@/lib/validations/backup-storage";

export interface AwsRuntimeCredentialCheck {
  available: boolean;
  accountId?: string;
  arn?: string;
  userId?: string;
  message: string;
}

export async function checkAwsRuntimeCredentials(region = "us-east-1"): Promise<AwsRuntimeCredentialCheck> {
  try {
    const result = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
    return {
      available: true,
      accountId: result.Account,
      arn: result.Arn,
      userId: result.UserId,
      message: "AWS runtime credentials are available",
    };
  } catch {
    return {
      available: false,
      message: "AWS runtime credentials were not found. Use guided CloudFormation setup or attach an instance/container role.",
    };
  }
}

export async function createAwsS3BackupTarget(input: AwsProvisioningRequestInput) {
  const check = await checkAwsRuntimeCredentials(input.region);
  if (!check.available) {
    throw new Error(check.message);
  }

  const client = new S3Client({ region: input.region });
  try {
    const createInput = input.region === "us-east-1"
      ? { Bucket: input.bucket }
      : {
          Bucket: input.bucket,
          CreateBucketConfiguration: {
            LocationConstraint: input.region as never,
          },
        };
    await client.send(new CreateBucketCommand(createInput));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name !== "BucketAlreadyOwnedByYou") throw error;
  }

  await client.send(new HeadBucketCommand({ Bucket: input.bucket }));

  await client.send(new PutBucketEncryptionCommand({
    Bucket: input.bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: input.encryption === "SSE_KMS"
            ? {
                SSEAlgorithm: "aws:kms",
                KMSMasterKeyID: input.kmsKeyArn ?? undefined,
              }
            : {
                SSEAlgorithm: "AES256",
              },
        },
      ],
    },
  }));

  await client.send(new PutBucketVersioningCommand({
    Bucket: input.bucket,
    VersioningConfiguration: {
      Status: input.versioningEnabled ? "Enabled" : "Suspended",
    },
  }));

  await client.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: input.bucket,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "HermodBackupRetention",
          Status: "Enabled",
          Prefix: `${input.prefix.replace(/^\/+|\/+$/g, "")}/`,
          Expiration: { Days: input.retentionDays },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  }));

  return {
    provider: "AWS_S3" as const,
    accessMode: "AWS_RUNTIME_ROLE" as const,
    config: {
      bucket: input.bucket,
      region: input.region,
      prefix: input.prefix,
      retentionDays: input.retentionDays,
      encryption: input.encryption,
      kmsKeyArn: input.kmsKeyArn ?? null,
      versioningEnabled: input.versioningEnabled,
    },
    credentials: null,
  };
}
