import { NextResponse } from "next/server";
import { BlueprintStatus as PrismaBlueprintStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { createBlueprintSchema } from "@/lib/validations/mjolnir";
import { cleanupUserTempFiles } from "@/lib/mjolnir/cleanup";
import { sanitizeBlueprintCreatePayload } from "@/lib/mjolnir/retention";
import {
  hasValidationEvidence,
  isBlueprintStatus,
  validateStatusTransition,
} from "@/lib/mjolnir/blueprint-status";

// GET /api/mjolnir/blueprints — list user's blueprints
// Supports ?status=ACTIVE,VALIDATED to filter by status
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const hasStatusFilter = url.searchParams.has("status");
  const includeId = url.searchParams.get("include");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (hasStatusFilter) {
    const statuses = (statusParam ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 0) {
      return NextResponse.json(
        { error: "At least one blueprint status is required." },
        { status: 400 }
      );
    }
    const invalidStatus = statuses.find((status) => !isBlueprintStatus(status));
    if (invalidStatus) {
      return NextResponse.json(
        { error: `Invalid blueprint status: ${invalidStatus}` },
        { status: 400 }
      );
    }
    where.OR = [
      { status: { in: statuses } },
      ...(includeId ? [{ id: includeId, userId: session.user.id }] : []),
    ];
  }

  const blueprints = await prisma.blueprint.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(blueprints);
});

// POST /api/mjolnir/blueprints — create a new blueprint
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createBlueprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const sanitized = sanitizeBlueprintCreatePayload(parsed.data);
  const { name, description, steps, sourceSchema, analysisLog, afterFormatting, beforeSample, afterSample } =
    sanitized;
  const requestedStatus = parsed.data.status;
  const validationEvidence = hasValidationEvidence(parsed.data.validation);
  let status: PrismaBlueprintStatus = PrismaBlueprintStatus.DRAFT;

  if (requestedStatus === "VALIDATED") {
    const transition = validateStatusTransition({
      from: "DRAFT",
      to: "VALIDATED",
      hasValidationEvidence: validationEvidence,
    });
    if (!transition.ok) {
      return NextResponse.json({ error: transition.error }, { status: 400 });
    }
    status = PrismaBlueprintStatus.VALIDATED;
  } else if (requestedStatus === "ACTIVE") {
    return NextResponse.json(
      { error: "New blueprints cannot be created as ACTIVE. Save as VALIDATED, then activate." },
      { status: 400 }
    );
  } else if (requestedStatus === "ARCHIVED") {
    return NextResponse.json(
      { error: "New blueprints cannot be created as ARCHIVED." },
      { status: 400 }
    );
  }

  const blueprint = await prisma.blueprint.create({
    data: {
      name,
      description: description ?? null,
      steps: steps as unknown as Prisma.InputJsonValue,
      sourceSchema: sourceSchema ? (sourceSchema as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      analysisLog: analysisLog ? (analysisLog as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      afterFormatting: afterFormatting ? (afterFormatting as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      beforeSample: beforeSample ?? null,
      afterSample: afterSample ?? null,
      status,
      userId: session.user.id,
    },
  });

  // Clean up temp files after successful save
  await cleanupUserTempFiles(session.user.id);

  return NextResponse.json(blueprint, { status: 201 });
});
