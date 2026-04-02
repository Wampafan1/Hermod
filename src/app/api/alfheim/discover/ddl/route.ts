import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { discoverDdlSchema } from "@/lib/validations/alfheim";
import { generateDDL } from "@/lib/alfheim/ddl-generator";
import type { SchemaMapping, SqlDialect } from "@/lib/alfheim/types";

// POST /api/alfheim/discover/ddl — generate DDL from schema
export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = discoverDdlSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tableName, schema, dialect } = parsed.data;
  const result = generateDDL(
    tableName,
    schema as SchemaMapping,
    dialect as SqlDialect
  );

  return NextResponse.json(result);
});
