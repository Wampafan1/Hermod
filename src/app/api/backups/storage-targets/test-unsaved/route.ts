import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { testUnsavedStorageTargetSchema } from "@/lib/validations/backup-storage";
import { testUnsavedStorageTarget } from "@/lib/backups/storage/test-storage-target";

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = testUnsavedStorageTargetSchema.safeParse(body);
  if (!parsed.success) {
    const checks = parsed.error.issues.map((issue) => ({
      name: issue.path.join(".") || "Storage target settings",
      status: "failed" as const,
      message: issue.message,
    }));

    return NextResponse.json(
      {
        ok: false,
        checks,
        error: "Storage target settings did not pass validation",
      },
      { status: 400 }
    );
  }

  const result = await testUnsavedStorageTarget({
    provider: parsed.data.provider,
    accessMode: parsed.data.accessMode,
    config: parsed.data.config,
    credentials: parsed.data.credentials ?? null,
  });

  return NextResponse.json(result);
}, { minimumRole: "ADMIN" });
