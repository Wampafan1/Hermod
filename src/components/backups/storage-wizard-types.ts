export type StorageProviderChoice = "AWS_S3" | "GCP_GCS";
export type StorageSetupMethod = "EXISTING" | "GUIDED" | "PROVISIONED";

export interface AwsS3WizardState {
  name: string;
  bucket: string;
  region: string;
  prefix: string;
  retentionDays: number;
  encryption: "SSE_S3" | "SSE_KMS";
  kmsKeyArn: string;
  versioningEnabled: boolean;
  accessMode: "AWS_ASSUME_ROLE" | "AWS_ACCESS_KEY" | "AWS_RUNTIME_ROLE";
  roleArn: string;
  externalId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export interface GcsWizardState {
  name: string;
  bucket: string;
  projectId: string;
  location: string;
  prefix: string;
  retentionDays: number;
  uniformBucketLevelAccess: boolean;
  accessMode: "GCP_SERVICE_ACCOUNT_JSON" | "GCP_APPLICATION_DEFAULT" | "GCP_WORKLOAD_IDENTITY";
  serviceAccountJson: string;
}

export interface ProvisioningGuidance {
  commands?: string[];
  templateJson?: string;
  launchUrl?: string | null;
  externalId?: string;
}
