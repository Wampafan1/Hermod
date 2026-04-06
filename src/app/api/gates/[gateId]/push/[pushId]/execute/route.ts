import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { readTempFile, deleteTempFile } from "@/lib/gates/temp-files";
import { executePush } from "@/lib/gates/push-executor";

// ─── POST /api/gates/[gateId]/push/[pushId]/execute — run the push ──

export const POST = withAuth(async (req, ctx) => {
  // Parse IDs from URL
  const parts = req.url.split("/gates/")[1]?.split("/") ?? [];
  const gateId = parts[0];
  const pushId = parts[2]; // push/[pushId]/execute

  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  // Load push
  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });

  if (!push) {
    return NextResponse.json({ error: "Push not found" }, { status: 404 });
  }
  if (push.status !== "VALIDATED") {
    return NextResponse.json(
      { error: `Push cannot be executed — current status: ${push.status}` },
      { status: 400 }
    );
  }

  // Read the temp file
  if (!push.tempFileId) {
    return NextResponse.json({ error: "Temp file reference missing" }, { status: 410 });
  }

  const tempFile = await readTempFile(push.tempFileId);
  if (!tempFile) {
    return NextResponse.json({ error: "Temp file expired or missing" }, { status: 410 });
  }

  // Mark as PUSHING
  await prisma.gatePush.update({
    where: { id: pushId },
    data: { status: "PUSHING" },
  });

  try {
    const result = await executePush(gateId, pushId, tempFile.buffer, tempFile.extension);

    // Clean up temp file
    await deleteTempFile(push.tempFileId);

    return NextResponse.json({
      pushId: push.id,
      status: "SUCCESS",
      rowCount: result.rowCount,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsErrored: result.rowsErrored,
      duration: result.duration,
    });
  } catch (err) {
    // Push executor already updates the push record on failure
    return NextResponse.json(
      {
        pushId: push.id,
        status: "FAILED",
        error: err instanceof Error ? err.message : "Push execution failed",
      },
      { status: 500 }
    );
  }
});
