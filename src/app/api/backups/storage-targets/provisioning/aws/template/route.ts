import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { awsProvisioningRequestSchema } from "@/lib/validations/backup-storage";
import {
  generateAwsLaunchStackUrl,
  generateAwsS3CliCommands,
  generateHermodExternalId,
  generateHermodS3CloudFormationTemplate,
} from "@/lib/backups/provisioning/aws-cloudformation";

function parseAwsQuery(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const data = {
    bucket: params.get("bucket") ?? "",
    region: params.get("region") ?? "us-east-1",
    prefix: params.get("prefix") ?? "postgres",
    retentionDays: Number(params.get("retentionDays") ?? 30),
    encryption: params.get("encryption") ?? "SSE_S3",
    kmsKeyArn: params.get("kmsKeyArn") || null,
    versioningEnabled: params.get("versioningEnabled") !== "false",
    accessMode: params.get("accessMode") ?? "AWS_ASSUME_ROLE",
    externalId: params.get("externalId") || generateHermodExternalId(),
  };
  return awsProvisioningRequestSchema.safeParse(data);
}

export const GET = withAuth(async (req) => {
  const parsed = parseAwsQuery(req);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { template, externalId } = generateHermodS3CloudFormationTemplate(parsed.data);
  return NextResponse.json({
    template,
    externalId,
    templateJson: JSON.stringify(template, null, 2),
    launchUrl: generateAwsLaunchStackUrl(JSON.stringify(template), parsed.data.region),
    commands: generateAwsS3CliCommands(parsed.data),
  });
}, { minimumRole: "ADMIN" });
