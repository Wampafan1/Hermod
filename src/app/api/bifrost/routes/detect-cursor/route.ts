import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { detectCursorStrategy } from "@/lib/sync/cursor-detection";
import type { ColumnSchema } from "@/lib/sync/types";

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const { tableName, sourceSystem, realm, columns } = body as {
    tableName: string;
    sourceSystem: string;
    realm: string;
    columns: ColumnSchema[];
  };

  if (!tableName || !columns?.length) {
    return NextResponse.json(
      { error: "tableName and columns are required" },
      { status: 400 }
    );
  }

  const config = await detectCursorStrategy({
    tableName,
    sourceSystem: sourceSystem || "Unknown",
    realm: realm || "alfheim",
    columns,
  });

  return NextResponse.json(config);
});
