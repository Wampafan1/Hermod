import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async () => {
  return NextResponse.json({
    ok: true,
    workerRequired: true,
    message: "Gate validation requires npm run worker in development.",
  });
});
