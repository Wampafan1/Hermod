import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { updateBlueprintSchema } from "@/lib/validations/mjolnir";

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

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.steps !== undefined) updateData.steps = parsed.data.steps;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

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

  await prisma.blueprint.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
});
