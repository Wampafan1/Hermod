import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { executeQuerySchema } from "@/lib/validations/reports";
import { getProvider, toConnectionLike } from "@/lib/providers";
import type { BigQueryProvider } from "@/lib/providers/bigquery.provider";

// POST /api/query/estimate — dry-run cost estimate (BigQuery only)
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = executeQuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { connectionId, sql } = parsed.data;

  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  if (connection.type !== "BIGQUERY") {
    return NextResponse.json(
      { error: "Cost estimation is only available for BigQuery connections" },
      { status: 400 }
    );
  }

  const provider = getProvider(connection.type) as BigQueryProvider;
  const connLike = toConnectionLike(connection);
  const conn = await provider.connect(connLike);

  try {
    const estimate = await provider.dryRun(conn, sql);

    const gb = estimate.totalBytesProcessed / 1e9;
    const estimatedCostUsd = gb * 6.25; // $6.25/TB on-demand = $0.00625/GB

    return NextResponse.json({
      totalBytesProcessed: estimate.totalBytesProcessed,
      totalGb: Math.round(gb * 100) / 100,
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      cacheHit: estimate.cacheHit,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Estimation failed";
    return NextResponse.json({ error: message }, { status: 422 });
  } finally {
    await conn.close();
  }
});
