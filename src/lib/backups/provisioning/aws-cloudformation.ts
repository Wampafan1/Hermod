import { randomBytes } from "crypto";
import type { AwsProvisioningRequestInput } from "@/lib/validations/backup-storage";

export function generateHermodExternalId(): string {
  return `hrm_ext_${randomBytes(18).toString("base64url")}`;
}

function normalizedPrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "") || "backups";
}

export function generateAwsIamPolicy(input: Pick<AwsProvisioningRequestInput, "bucket" | "prefix"> & { kmsKeyArn?: string | null }) {
  const statement = [
    {
      Sid: "HermodBackupBucketObjectAccess",
      Effect: "Allow",
      Action: [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
      ],
      Resource: [`arn:aws:s3:::${input.bucket}/*`],
    },
    {
      Sid: "HermodBackupBucketAccess",
      Effect: "Allow",
      Action: [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketMultipartUploads",
      ],
      Resource: [`arn:aws:s3:::${input.bucket}`],
    },
  ];

  if (input.kmsKeyArn) {
    statement.push({
      Sid: "HermodBackupKmsAccess",
      Effect: "Allow",
      Action: [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey",
      ],
      Resource: [input.kmsKeyArn],
    } as typeof statement[number]);
  }

  return {
    Version: "2012-10-17",
    Statement: statement,
  };
}

export function generateHermodS3CloudFormationTemplate(input: AwsProvisioningRequestInput) {
  const prefix = normalizedPrefix(input.prefix);
  const externalId = input.externalId || generateHermodExternalId();
  const bucketEncryption = input.encryption === "SSE_KMS"
    ? {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "aws:kms",
              KMSMasterKeyID: input.kmsKeyArn || { Ref: "AWS::NoValue" },
            },
          },
        ],
      }
    : {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      };

  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Hermod Niflheim PostgreSQL backup storage target",
    Parameters: {
      HermodPrincipalArn: {
        Type: "String",
        Description: "AWS principal ARN that Hermod may use to assume the backup role.",
        Default: "arn:aws:iam::ACCOUNT_ID:role/HermodHostedRole",
      },
    },
    Resources: {
      HermodBackupBucket: {
        Type: "AWS::S3::Bucket",
        Properties: {
          BucketName: input.bucket,
          BucketEncryption: bucketEncryption,
          VersioningConfiguration: {
            Status: input.versioningEnabled ? "Enabled" : "Suspended",
          },
          LifecycleConfiguration: {
            Rules: [
              {
                Id: "HermodBackupRetention",
                Status: "Enabled",
                Prefix: `${prefix}/`,
                ExpirationInDays: input.retentionDays,
                AbortIncompleteMultipartUpload: {
                  DaysAfterInitiation: 7,
                },
              },
            ],
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
      HermodBackupRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: { "Fn::Sub": "HermodBackupRole-${AWS::StackName}" },
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: {
                  AWS: { Ref: "HermodPrincipalArn" },
                },
                Action: "sts:AssumeRole",
                Condition: {
                  StringEquals: {
                    "sts:ExternalId": externalId,
                  },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "HermodBackupBucketAccess",
              PolicyDocument: generateAwsIamPolicy({ bucket: input.bucket, prefix, kmsKeyArn: input.kmsKeyArn }),
            },
          ],
        },
      },
    },
    Outputs: {
      BucketName: { Value: { Ref: "HermodBackupBucket" } },
      Region: { Value: { Ref: "AWS::Region" } },
      Prefix: { Value: prefix },
      RoleArn: { Value: { "Fn::GetAtt": ["HermodBackupRole", "Arn"] } },
      ExternalId: { Value: externalId },
    },
  };

  return { template, externalId };
}

export function generateAwsLaunchStackUrl(_templateUrlOrBody: string, region: string): string | null {
  // CloudFormation Launch Stack needs a public template URL. Hermod returns null
  // unless a deployment wires public template hosting around this helper.
  void region;
  return null;
}

export function generateAwsS3CliCommands(input: AwsProvisioningRequestInput & { roleArn?: string }): string[] {
  const prefix = normalizedPrefix(input.prefix);
  const createBucket = input.region === "us-east-1"
    ? `aws s3api create-bucket --bucket ${input.bucket} --region ${input.region}`
    : `aws s3api create-bucket --bucket ${input.bucket} --region ${input.region} --create-bucket-configuration LocationConstraint=${input.region}`;

  const encryption = input.encryption === "SSE_KMS" && input.kmsKeyArn
    ? `aws s3api put-bucket-encryption --bucket ${input.bucket} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"${input.kmsKeyArn}"}}]}'`
    : `aws s3api put-bucket-encryption --bucket ${input.bucket} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'`;

  return [
    createBucket,
    "aws s3api put-public-access-block " +
      `--bucket ${input.bucket} ` +
      "--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
    encryption,
    input.versioningEnabled
      ? `aws s3api put-bucket-versioning --bucket ${input.bucket} --versioning-configuration Status=Enabled`
      : `aws s3api put-bucket-versioning --bucket ${input.bucket} --versioning-configuration Status=Suspended`,
    `aws s3api put-bucket-lifecycle-configuration --bucket ${input.bucket} --lifecycle-configuration '{"Rules":[{"ID":"HermodBackupRetention","Status":"Enabled","Prefix":"${prefix}/","Expiration":{"Days":${input.retentionDays}},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'`,
    "# Create an IAM role with the generated trust policy and attach the generated dedicated-bucket policy. Do not place access keys in shell history.",
  ];
}
