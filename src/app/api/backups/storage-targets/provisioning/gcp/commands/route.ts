import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { gcpProvisioningRequestSchema } from "@/lib/validations/backup-storage";
import { generateGcpStorageCommands } from "@/lib/backups/provisioning/gcp-commands";

export const GET = withAuth(async (req) => {
  const params = new URL(req.url).searchParams;
  const parsed = gcpProvisioningRequestSchema.safeParse({
    bucket: params.get("bucket") ?? "",
    projectId: params.get("projectId") || undefined,
    location: params.get("location") ?? "us-central1",
    prefix: params.get("prefix") ?? "postgres",
    retentionDays: Number(params.get("retentionDays") ?? 30),
    uniformBucketLevelAccess: params.get("uniformBucketLevelAccess") !== "false",
    accessMode: params.get("accessMode") ?? "GCP_APPLICATION_DEFAULT",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  return NextResponse.json({ commands: generateGcpStorageCommands(parsed.data) });
}, { minimumRole: "ADMIN" });
