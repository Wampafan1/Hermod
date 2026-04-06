import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { createBlueprintSchema } from "@/lib/validations/mjolnir";
import { cleanupUserTempFiles } from "@/lib/mjolnir/cleanup";
import type { BlueprintFormatting } from "@/lib/mjolnir";

// GET /api/mjolnir/blueprints — list user's blueprints
// Supports ?status=ACTIVE,VALIDATED to filter by status
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      where.status = { in: statuses };
    }
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

  const { name, description, steps, sourceSchema, analysisLog, afterFormatting, beforeSample, afterSample } =
    parsed.data;

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
      userId: session.user.id,
    },
  });

  // Clean up temp files after successful save
  await cleanupUserTempFiles(session.user.id);

  return NextResponse.json(blueprint, { status: 201 });
});
