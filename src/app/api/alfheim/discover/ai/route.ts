import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { discoverAiSchema } from "@/lib/validations/alfheim";
import { runDiscovery } from "@/lib/alfheim/discovery/discovery-orchestrator";

// POST /api/alfheim/discover/ai — full AI discovery pipeline
export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = discoverAiSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await runDiscovery(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery pipeline failed";
    console.error("Discovery error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
