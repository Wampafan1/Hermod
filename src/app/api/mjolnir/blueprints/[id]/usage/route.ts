import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getBlueprintUsage } from "@/lib/mjolnir/blueprint-usage";

function extractBlueprintId(url: string): string | null {
  const match = url.match(/\/blueprints\/([^/?/]+)/);
  return match?.[1] ?? null;
}

// GET /api/mjolnir/blueprints/[id]/usage
export const GET = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const blueprint = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const usage = await getBlueprintUsage({
    blueprintId: id,
    userId: session.user.id,
  });

  return NextResponse.json(usage);
});
