import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { updateBlueprintSchema } from "@/lib/validations/mjolnir";
import { sanitizeBlueprintCreatePayload } from "@/lib/mjolnir/retention";
import { getBlueprintUsage } from "@/lib/mjolnir/blueprint-usage";
import {
  canEditBlueprintStatus,
  hasBlueprintContentChanges,
  hasValidationEvidence,
  normalizeBlueprintStatus,
  shouldDemoteToDraftOnContentChange,
  validateStatusTransition,
} from "@/lib/mjolnir/blueprint-status";

/**
 * Extract the blueprint ID from the request URL.
 * Pattern: /api/mjolnir/blueprints/{id}
 */
function extractBlueprintId(url: string): string | null {
  const match = url.match(/\/blueprints\/([^/?]+)/);
  return match?.[1] ?? null;
}

// GET /api/mjolnir/blueprints/[id] — get a single blueprint
export const GET = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const blueprint = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  return NextResponse.json(blueprint);
});

// PUT /api/mjolnir/blueprints/[id] — update a blueprint
export const PUT = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateBlueprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  // Ownership check — ensure blueprint belongs to user
  const existing = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const sanitized = sanitizeBlueprintCreatePayload(parsed.data);
  const updateData: Record<string, unknown> = {};
  const currentStatus = normalizeBlueprintStatus(existing.status);
  const requestedStatus = sanitized.status !== undefined
    ? normalizeBlueprintStatus(sanitized.status)
    : undefined;
  const contentChanged = hasBlueprintContentChanges(sanitized as Record<string, unknown>);
  const hasNonStatusChanges = Object.keys(sanitized as Record<string, unknown>).some(
    (key) => key !== "status" && key !== "validation"
  );
  const validationEvidence = hasValidationEvidence(parsed.data.validation);

  if (!canEditBlueprintStatus(currentStatus) && hasNonStatusChanges) {
    return NextResponse.json(
      { error: "Archived blueprints must be restored to DRAFT before editing." },
      { status: 400 }
    );
  }

  if (requestedStatus !== undefined) {
    const transition = validateStatusTransition({
      from: currentStatus,
      to: requestedStatus,
      hasValidationEvidence: validationEvidence,
    });
    if (!transition.ok) {
      return NextResponse.json({ error: transition.error }, { status: 400 });
    }

    if (
      contentChanged &&
      (requestedStatus === "VALIDATED" || requestedStatus === "ACTIVE") &&
      !validationEvidence
    ) {
      return NextResponse.json(
        { error: "Validation evidence is required when changing blueprint content and marking it production-ready." },
        { status: 400 }
      );
    }

    updateData.status = requestedStatus;
  } else if (contentChanged && shouldDemoteToDraftOnContentChange({
    currentStatus,
    changes: sanitized as Record<string, unknown>,
  })) {
    updateData.status = "DRAFT";
  }

  if (sanitized.name !== undefined) updateData.name = sanitized.name;
  if (sanitized.description !== undefined) updateData.description = sanitized.description;
  if (sanitized.steps !== undefined) {
    updateData.steps = sanitized.steps as unknown as Prisma.InputJsonValue;
  }
  if (sanitized.sourceSchema !== undefined) {
    updateData.sourceSchema = sanitized.sourceSchema
      ? (sanitized.sourceSchema as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }
  if (sanitized.analysisLog !== undefined) {
    updateData.analysisLog = sanitized.analysisLog
      ? (sanitized.analysisLog as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }
  if (sanitized.afterFormatting !== undefined) {
    updateData.afterFormatting = sanitized.afterFormatting
      ? (sanitized.afterFormatting as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }
  if (sanitized.beforeSample !== undefined) updateData.beforeSample = sanitized.beforeSample;
  if (sanitized.afterSample !== undefined) updateData.afterSample = sanitized.afterSample;

  const updated = await prisma.blueprint.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(updated);
});

// DELETE /api/mjolnir/blueprints/[id] — delete a blueprint
export const DELETE = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  // Ownership check — ensure blueprint belongs to user
  const existing = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const usage = await getBlueprintUsage({
    blueprintId: id,
    userId: session.user.id,
  });

  if (usage.total > 0) {
    return NextResponse.json(
      {
        error: "Blueprint is in use",
        usage,
        suggestion: "Archive the blueprint or detach it from reports/routes before deleting.",
      },
      { status: 409 }
    );
  }

  await prisma.blueprint.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
});
