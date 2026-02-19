import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { executeQuerySchema } from "@/lib/validations/reports";
import { getConnector } from "@/lib/connectors";

// POST /api/query/execute — run ad-hoc SQL query
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

  // Verify user owns this connection
  const dataSource = await prisma.dataSource.findFirst({
    where: { id: connectionId, userId: session.user.id },
  });
  if (!dataSource) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  const startTime = Date.now();
  const connector = getConnector(dataSource as Parameters<typeof getConnector>[0]);
  try {
    const result = await connector.query(sql);
    const executionTime = Date.now() - startTime;
    return NextResponse.json({
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      executionTime,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Query execution failed";
    return NextResponse.json({ error: message }, { status: 422 });
  } finally {
    await connector.disconnect();
  }
});
