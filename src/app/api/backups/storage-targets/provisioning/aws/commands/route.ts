import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { awsProvisioningRequestSchema } from "@/lib/validations/backup-storage";
import { generateAwsS3CliCommands } from "@/lib/backups/provisioning/aws-cloudformation";

export const GET = withAuth(async (req) => {
  const params = new URL(req.url).searchParams;
  const parsed = awsProvisioningRequestSchema.safeParse({
    bucket: params.get("bucket") ?? "",
    region: params.get("region") ?? "us-east-1",
    prefix: params.get("prefix") ?? "postgres",
    retentionDays: Number(params.get("retentionDays") ?? 30),
    encryption: params.get("encryption") ?? "SSE_S3",
    kmsKeyArn: params.get("kmsKeyArn") || null,
    versioningEnabled: params.get("versioningEnabled") !== "false",
    accessMode: params.get("accessMode") ?? "AWS_ASSUME_ROLE",
    externalId: params.get("externalId") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  return NextResponse.json({ commands: generateAwsS3CliCommands(parsed.data) });
}, { minimumRole: "ADMIN" });
