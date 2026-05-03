type Provider = "AWS_S3" | "GCP_GCS";

interface StoragePermissionsReviewProps {
  provider: Provider;
  bucket: string;
  prefix: string;
  accessMode: string;
  kmsKeyArn?: string | null;
}

function cleanPrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "") || "postgres";
}

function awsPolicy(bucket: string, prefix: string, kmsKeyArn?: string | null) {
  void prefix;
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
      Resource: [`arn:aws:s3:::${bucket}/*`],
    },
    {
      Sid: "HermodBackupBucketAccess",
      Effect: "Allow",
      Action: [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketMultipartUploads",
      ],
      Resource: [`arn:aws:s3:::${bucket}`],
    },
  ];

  if (kmsKeyArn) {
    statement.push({
      Sid: "HermodBackupKmsAccess",
      Effect: "Allow",
      Action: [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey",
      ],
      Resource: [kmsKeyArn],
    } as typeof statement[number]);
  }

  return {
    Version: "2012-10-17",
    Statement: statement,
  };
}

const AWS_PERMISSIONS = [
  "Write backup artifacts under any key in this bucket",
  "Read backup artifacts for restore",
  "List objects in this backup bucket",
  "Delete old objects during retention cleanup",
  "Abort incomplete multipart uploads",
  "Read bucket location",
];

const GCP_PERMISSIONS = [
  "Write backup artifacts",
  "Read backup artifacts for restore",
  "List objects in the configured bucket/prefix",
  "Delete old objects during retention cleanup",
  "Manage lifecycle rules when Hermod provisions the bucket",
];

export function StoragePermissionsReview({ provider, bucket, prefix, accessMode, kmsKeyArn }: StoragePermissionsReviewProps) {
  const permissions = provider === "AWS_S3" ? AWS_PERMISSIONS : GCP_PERMISSIONS;
  const scopedPrefix = cleanPrefix(prefix);

  return (
    <div className="border border-border bg-deep p-5">
      <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Permission Review</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">
        <div className="space-y-4">
          <div>
            <span className="label-norse">Bucket Access</span>
            <p className="text-text text-xs tracking-wide break-all">
              {bucket || "bucket-not-set"} / bucket-wide objects
            </p>
            <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
              Use a dedicated backup bucket. Prefix <span className="font-mono text-gold">{scopedPrefix}</span> is used for
              storage tests, lifecycle rules, and default organization, but AWS object permissions cover the bucket so policies
              can choose their own artifact paths.
            </p>
          </div>
          <div>
            <span className="label-norse">Access Mode</span>
            <p className="text-text-dim text-xs tracking-wide">{accessMode.replace(/_/g, " ")}</p>
          </div>
          <ul className="space-y-2">
            {permissions.map((permission) => (
              <li key={permission} className="flex items-start gap-2 text-xs tracking-wide leading-6 text-text-dim">
                <span className="text-gold">ᛟ</span>
                <span>{permission}</span>
              </li>
            ))}
          </ul>
          {provider === "AWS_S3" && (
            <div className="border border-gold/30 bg-void/50 p-3 text-xs tracking-wide leading-6 text-text-dim">
              This is an IAM identity policy. Attach it to the IAM user/role Hermod uses, or to the role Hermod assumes.
              A bucket policy needs a Principal and is not the same document.
              {accessMode === "AWS_ASSUME_ROLE" && (
                <span className="block mt-2 text-text">
                  Assume Role also requires the role trust policy to allow the Hermod runtime principal with this ExternalId,
                  and the caller must be allowed to call sts:AssumeRole.
                </span>
              )}
              {kmsKeyArn && (
                <span className="block mt-2 text-text">
                  SSE-KMS also requires the KMS permissions shown in the policy and a key policy that allows this role.
                </span>
              )}
            </div>
          )}
        </div>

        <div>
          <span className="label-norse">IAM Identity Policy</span>
          {provider === "AWS_S3" ? (
            <pre className="max-h-72 overflow-auto border border-border bg-void/60 p-4 text-[0.7rem] leading-5 text-text-dim whitespace-pre-wrap">
              {JSON.stringify(awsPolicy(bucket || "hermod-backups", scopedPrefix, kmsKeyArn), null, 2)}
            </pre>
          ) : (
            <div className="border border-border bg-void/60 p-4 text-xs tracking-wide leading-6 text-text-dim">
              Hermod uses bucket-scoped object permissions for GCS. The guided command path grants
              <code className="text-gold mx-1">roles/storage.objectAdmin</code>
              on this bucket so backups can write, read, list, and remove retained objects.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
