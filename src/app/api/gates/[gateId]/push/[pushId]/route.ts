import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { deleteTempFile } from "@/lib/gates/temp-files";
import {
  buildSchemaDriftResolutionOptions,
} from "@/lib/gates/push-validation";
import type { GateColumnMapping } from "@/lib/gates/alter-generator";
import type { SchemaDiff } from "@/lib/gates/schema-diff";
import {
  getGatePushValidationDetails,
  inferGatePushValidationStage,
  markStaleGatePushValidationFailed,
} from "@/lib/gates/validation-timeouts";

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

export const GET = withAuth(async (req, ctx) => {
  const parts = req.url.split("/gates/")[1]?.split("/") ?? [];
  const gateId = parts[0];
  const pushId = parts[2];

  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  await markStaleGatePushValidationFailed(pushId, new Date(), {
    gateId,
    tenantId: ctx.tenantId,
  });

  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });

  if (!push) {
    return NextResponse.json({ error: "Push not found" }, { status: 404 });
  }

  let resolutionOptions = null;
  if (push.status === "SCHEMA_DRIFT" && push.schemaDiff) {
    const gate = await prisma.realmGate.findFirst({
      where: { id: gateId, tenantId: ctx.tenantId },
      include: { connection: { select: { type: true } } },
    });
    if (gate) {
      resolutionOptions = buildSchemaDriftResolutionOptions({
        diff: push.schemaDiff as unknown as SchemaDiff,
        columnMapping: gate.columnMapping as unknown as GateColumnMapping[],
        connectionType: gate.connection.type,
        targetSchema: gate.targetSchema,
        targetTable: gate.targetTable,
      });
    }
  }

  const validationDetails = getGatePushValidationDetails(push.errorDetails);
  const validationStage = inferGatePushValidationStage({
    status: push.status,
    errorDetails: push.errorDetails,
  });

  return NextResponse.json({
    id: push.id,
    pushId: push.id,
    status: push.status,
    validationStage,
    validationStartedAt: validationDetails.validationStartedAt ?? push.createdAt.toISOString(),
    validationHeartbeatAt: validationDetails.validationHeartbeatAt ?? null,
    validationTimeoutAt: validationDetails.validationTimeoutAt ?? null,
    rowCount: push.rowCount,
    rowsInserted: push.rowsInserted,
    rowsUpdated: push.rowsUpdated,
    rowsErrored: push.rowsErrored,
    blankRowsSkipped: push.blankRowsSkipped,
    schemaDiff: push.schemaDiff,
    keyDrift: sanitizePushStatusJson(push.keyDrift),
    resolutionOptions,
    errorMessage: push.errorMessage,
    fileName: push.fileName,
    fileSize: push.fileSize,
    createdAt: push.createdAt.toISOString(),
    completedAt: push.completedAt?.toISOString() ?? null,
  });
});

function sanitizePushStatusJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePushStatusJson);
  if (!value || typeof value !== "object") return value;

  const blocked = new Set([
    "rawRows",
    "rows",
    "row",
    "payload",
    "credentials",
    "config",
    "sourceConfig",
    "destConfig",
  ]);
  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (blocked.has(key)) continue;
    safe[key] = sanitizePushStatusJson(child);
  }
  return safe;
}

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
