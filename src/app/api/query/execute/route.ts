import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { executeQuerySchema } from "@/lib/validations/reports";
import { getProvider, toConnectionLike } from "@/lib/providers";
import { buildLimitedSqlQuery, MSSQL_RESET_ROWCOUNT_SQL, PREVIEW_ROW_LIMIT } from "@/lib/query-limits";
import type { ProviderConnection } from "@/lib/providers/types";

async function resetMssqlRowLimitAfterError(
  provider: { query?: (conn: ProviderConnection, sql: string) => Promise<unknown> },
  conn: ProviderConnection
): Promise<void> {
  try {
    await provider.query?.(conn, MSSQL_RESET_ROWCOUNT_SQL);
  } catch {
    // Preserve the original query error; the caller closes the connection next.
  }
}

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
    where: { id: connectionId, userId: session.user.id, tenantId: session.tenantId },
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
  const limitedQuery = buildLimitedSqlQuery(sql, connection.type, PREVIEW_ROW_LIMIT + 1);
  try {
    const result = await provider.query(conn, limitedQuery.sql);
    const executionTime = Date.now() - startTime;

    const truncated = result.rows.length > PREVIEW_ROW_LIMIT;
    const rows = truncated ? result.rows.slice(0, PREVIEW_ROW_LIMIT) : result.rows;

    return NextResponse.json({
      columns: result.columns,
      rows,
      rowCount: rows.length,
      totalRows: result.rows.length,
      executionTime,
      ...(truncated && {
        warning: `Results truncated to ${PREVIEW_ROW_LIMIT.toLocaleString()} rows (query returned more than ${PREVIEW_ROW_LIMIT.toLocaleString()} rows)`,
      }),
    });
  } catch (error) {
    if (limitedQuery.usesSessionRowLimit) {
      await resetMssqlRowLimitAfterError(provider, conn);
    }
    console.error("[QueryExecute] Query execution failed", {
      connectionId,
      connectionType: connection.type,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json({ error: "Query execution failed" }, { status: 422 });
  } finally {
    await conn.close();
  }
});
