import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { gateValidationWorkerHealthMessage } from "@/lib/gates/validation-copy";

export const GET = withAuth(async () => {
  return NextResponse.json({
    ok: true,
    workerRequired: true,
    message: gateValidationWorkerHealthMessage(),
  });
});
