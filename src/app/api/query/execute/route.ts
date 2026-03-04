import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { executeQuerySchema } from "@/lib/validations/reports";
import { getProvider, toConnectionLike } from "@/lib/providers";

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
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  const provider = getProvider(connection.type);
  if (!provider.query) {
    return NextResponse.json(
      { error: `Connection type "${connection.type}" does not support SQL queries` },
      { status: 400 }
    );
  }

  const connLike = toConnectionLike(connection);
  const startTime = Date.now();
  const conn = await provider.connect(connLike);
  try {
    const result = await provider.query(conn, sql);
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
    await conn.close();
  }
});
