import type { GcpProvisioningRequestInput } from "@/lib/validations/backup-storage";

function prefix(input: GcpProvisioningRequestInput): string {
  return input.prefix.replace(/^\/+|\/+$/g, "") || "postgres";
}

export function generateGcpStorageCommands(input: GcpProvisioningRequestInput): string[] {
  const bucketUri = `gs://${input.bucket}`;
  const projectFlag = input.projectId ? ` --project=${input.projectId}` : "";
  const serviceAccountName = "hermod-backup-writer";
  const lifecycleFile = "hermod-backup-lifecycle.json";

  return [
    `gcloud storage buckets create ${bucketUri} --location=${input.location}${projectFlag} --uniform-bucket-level-access`,
    `cat > ${lifecycleFile} <<'JSON'\n{"rule":[{"action":{"type":"Delete"},"condition":{"age":${input.retentionDays},"matchesPrefix":["${prefix(input)}/"]}}]}\nJSON`,
    `gcloud storage buckets update ${bucketUri} --lifecycle-file=${lifecycleFile}${projectFlag}`,
    `gcloud iam service-accounts create ${serviceAccountName}${projectFlag}`,
    `gcloud storage buckets add-iam-policy-binding ${bucketUri} --member="serviceAccount:${serviceAccountName}@${input.projectId || "PROJECT_ID"}.iam.gserviceaccount.com" --role="roles/storage.objectAdmin"${projectFlag}`,
    "# Create and upload a service account key through Hermod only if role-based/default credentials are not available. Do not paste private keys into shell history.",
  ];
}
