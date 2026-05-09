import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import {
  cleanupMjolnirFile,
  cleanupUserExpiredTempFiles,
  getMjolnirUserTempDir,
} from "@/lib/mjolnir/cleanup";

const cleanupRequestSchema = z.object({
  expiredOnly: z.boolean().optional().default(false),
}).strict();

// POST /api/mjolnir/cleanup -- cleanup current user's Mjolnir temp uploads
export const POST = withAuth(async (req, session) => {
  const body = await readOptionalJson(req);
  const parsed = cleanupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  if (parsed.data.expiredOnly) {
    const result = await cleanupUserExpiredTempFiles(session.user.id);
    return NextResponse.json(result);
  }

  const result = await cleanupMjolnirFile(
    getMjolnirUserTempDir(session.user.id)
  );
  return NextResponse.json(result);
});

async function readOptionalJson(req: Request): Promise<unknown> {
  if (req.headers.get("content-length") === "0") return {};

  try {
    return await req.json();
  } catch {
    return {};
  }
}
