import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { detectCursorStrategy } from "@/lib/sync/cursor-detection";
import { detectCursorSchema } from "@/lib/validations/bifrost";

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = detectCursorSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const config = await detectCursorStrategy(parsed.data);

  return NextResponse.json(config);
});
