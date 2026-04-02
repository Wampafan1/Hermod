import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { discoverProbeSchema } from "@/lib/validations/alfheim";
import { probeEndpoints } from "@/lib/alfheim/discovery/probe-endpoints";

// POST /api/alfheim/discover/probe — probe API endpoints
export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = discoverProbeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const results = await probeEndpoints(parsed.data);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to probe endpoints";
    console.error("Probe error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
