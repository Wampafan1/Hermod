import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import {
  PublishBlueprintError,
  publishBlueprintToTenant,
} from "@/lib/mjolnir/publish-blueprint";
import { publishBlueprintSchema } from "@/lib/validations/mjolnir-publish";

function extractBlueprintId(url: string): string | null {
  const match = url.match(/\/blueprints\/([^/?/]+)\/publish/);
  return match?.[1] ?? null;
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// POST /api/mjolnir/blueprints/[id]/publish
export const POST = withAuth(async (req, ctx) => {
  const id = extractBlueprintId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });
  }

  const parsed = publishBlueprintSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await publishBlueprintToTenant({
      draftBlueprintId: id,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      ...parsed.data,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PublishBlueprintError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
