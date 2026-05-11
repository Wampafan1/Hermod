import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { buildWorkerHealthPayload } from "@/lib/system/worker-health";

export const GET = withAuth(async () => {
  return NextResponse.json(await buildWorkerHealthPayload());
});
