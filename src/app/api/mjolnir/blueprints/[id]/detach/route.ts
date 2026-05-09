import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { detachBlueprintSchema } from "@/lib/validations/mjolnir";

function extractBlueprintId(url: string): string | null {
  const match = url.match(/\/blueprints\/([^/?/]+)/);
  return match?.[1] ?? null;
}

// POST /api/mjolnir/blueprints/[id]/detach
export const POST = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = detachBlueprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const blueprint = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  if (parsed.data.type === "report") {
    const report = await prisma.report.findFirst({
      where: {
        id: parsed.data.targetId,
        userId: session.user.id,
        tenantId: session.tenantId,
        blueprintId: id,
      },
      select: { id: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    await prisma.report.update({
      where: { id: report.id },
      data: { blueprintId: null },
    });

    return NextResponse.json({ success: true, type: "report", targetId: report.id });
  }

  const route = await prisma.bifrostRoute.findFirst({
    where: {
      id: parsed.data.targetId,
      userId: session.user.id,
      tenantId: session.tenantId,
      blueprintId: id,
    },
    select: { id: true },
  });

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  await prisma.bifrostRoute.update({
    where: { id: route.id },
    data: { blueprintId: null },
  });

  return NextResponse.json({ success: true, type: "bifrost_route", targetId: route.id });
});
