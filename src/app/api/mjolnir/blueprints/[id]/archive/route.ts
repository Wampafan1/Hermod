import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getBlueprintUsage } from "@/lib/mjolnir/blueprint-usage";

function extractBlueprintId(url: string): string | null {
  const match = url.match(/\/blueprints\/([^/?/]+)/);
  return match?.[1] ?? null;
}

// POST /api/mjolnir/blueprints/[id]/archive
export const POST = withAuth(async (req, session) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const existing = await prisma.blueprint.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const blueprint = existing.status === "ARCHIVED"
    ? existing
    : await prisma.blueprint.update({
        where: { id },
        data: { status: "ARCHIVED" },
      });

  const usage = await getBlueprintUsage({
    blueprintId: id,
    userId: session.user.id,
  });

  return NextResponse.json({ blueprint, usage });
});
