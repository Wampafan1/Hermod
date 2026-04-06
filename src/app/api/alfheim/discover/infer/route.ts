import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requireTierFeature } from "@/lib/tier-gate";
import { discoverInferSchema } from "@/lib/validations/alfheim";
import { inferSchemaWithAI } from "@/lib/alfheim/discovery/ai-schema-inference";

// POST /api/alfheim/discover/infer — AI schema inference
export const POST = withAuth(async (req, ctx) => {
  const denied = await requireTierFeature(ctx.tenantId, "apiDiscovery", "AI API Discovery");
  if (denied) return denied;

  const body = await req.json();
  const parsed = discoverInferSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await inferSchemaWithAI(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Schema inference failed";
    console.error("Schema inference error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
