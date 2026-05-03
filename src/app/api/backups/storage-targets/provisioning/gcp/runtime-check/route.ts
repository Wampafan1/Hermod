import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { checkGcpApplicationDefaultCredentials } from "@/lib/backups/provisioning/gcp-provisioner";

export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  const result = await checkGcpApplicationDefaultCredentials(projectId);
  return NextResponse.json(result);
}, { minimumRole: "ADMIN" });
