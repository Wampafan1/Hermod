import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { deleteTempFile } from "@/lib/gates/temp-files";

const CLEARABLE_STATUSES = new Set([
  "VALIDATING",
  "VALIDATED",
  "SCHEMA_DRIFT",
  "KEY_DRIFT",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
]);

// DELETE /api/gates/[gateId]/push/[pushId] - clear a staged or failed push attempt

export const DELETE = withAuth(async (req, ctx) => {
  const parts = req.url.split("/gates/")[1]?.split("/") ?? [];
  const gateId = parts[0];
  const pushId = parts[2];

  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });

  if (!push) {
    return NextResponse.json({ error: "Push not found" }, { status: 404 });
  }

  if (push.status === "PUSHING") {
    return NextResponse.json(
      { error: "Push is already running and cannot be cleared" },
      { status: 409 }
    );
  }

  if (push.status === "SUCCESS") {
    return NextResponse.json(
      { error: "Successful push history cannot be cleared" },
      { status: 400 }
    );
  }

  if (!CLEARABLE_STATUSES.has(push.status)) {
    return NextResponse.json(
      { error: `Push cannot be cleared from status: ${push.status}` },
      { status: 400 }
    );
  }

  await prisma.gatePush.update({
    where: { id: pushId },
    data: {
      status: "CANCELLED",
      tempFileId: null,
      completedAt: new Date(),
    },
  });

  if (push.tempFileId) {
    await deleteTempFile(push.tempFileId);
  }

  return NextResponse.json({ pushId, status: "CANCELLED" });
});
