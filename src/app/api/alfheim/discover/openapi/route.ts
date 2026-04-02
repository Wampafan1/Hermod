import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { discoverOpenApiSchema } from "@/lib/validations/alfheim";
import { parseOpenApiSpec } from "@/lib/alfheim/discovery/openapi-parser";

// POST /api/alfheim/discover/openapi — parse an OpenAPI spec
export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = discoverOpenApiSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await parseOpenApiSpec(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse OpenAPI spec";
    console.error("OpenAPI parse error:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
