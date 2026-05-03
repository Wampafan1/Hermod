import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { checkAwsRuntimeCredentials } from "@/lib/backups/provisioning/aws-provisioner";

export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => ({}));
  const region = typeof body.region === "string" ? body.region : "us-east-1";
  const result = await checkAwsRuntimeCredentials(region);
  return NextResponse.json(result, { status: result.available ? 200 : 200 });
}, { minimumRole: "ADMIN" });
