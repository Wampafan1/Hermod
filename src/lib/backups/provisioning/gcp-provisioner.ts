import { Storage } from "@google-cloud/storage";
import type { GcpProvisioningRequestInput } from "@/lib/validations/backup-storage";

export interface GcpRuntimeCredentialCheck {
  available: boolean;
  projectId?: string;
  message: string;
}

export async function checkGcpApplicationDefaultCredentials(projectId?: string): Promise<GcpRuntimeCredentialCheck> {
  try {
    const storage = new Storage({ projectId });
    const resolvedProjectId = await storage.getProjectId();
    return {
      available: true,
      projectId: resolvedProjectId,
      message: "Google Application Default Credentials are available",
    };
  } catch {
    return {
      available: false,
      message: "Google Application Default Credentials were not found. Use guided gcloud setup or attach a runtime service account.",
    };
  }
}

export async function createGcpBackupTarget(input: GcpProvisioningRequestInput) {
  const check = await checkGcpApplicationDefaultCredentials(input.projectId);
  if (!check.available) {
    throw new Error(check.message);
  }

  const storage = new Storage({ projectId: input.projectId });
  const [bucket] = await storage.createBucket(input.bucket, {
    location: input.location,
    uniformBucketLevelAccess: input.uniformBucketLevelAccess,
  });

  await bucket.setMetadata({
    lifecycle: {
      rule: [
        {
          action: { type: "Delete" },
          condition: {
            age: input.retentionDays,
            matchesPrefix: [`${input.prefix.replace(/^\/+|\/+$/g, "")}/`],
          },
        },
      ],
    },
  });

  return {
    provider: "GCP_GCS" as const,
    accessMode: "GCP_APPLICATION_DEFAULT" as const,
    config: {
      bucket: input.bucket,
      projectId: input.projectId ?? check.projectId,
      location: input.location,
      prefix: input.prefix,
      retentionDays: input.retentionDays,
      uniformBucketLevelAccess: input.uniformBucketLevelAccess,
    },
    credentials: null,
  };
}
