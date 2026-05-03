import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
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

// POST /api/reports/[id]/run — execute report query (preview, no history)
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id, tenantId: session.tenantId },
    include: { connection: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const provider = getProvider(report.connection.type);
  if (!provider.query) {
    return NextResponse.json(
      { error: `Connection type "${report.connection.type}" does not support SQL queries` },
      { status: 400 }
    );
  }

  const connLike = toConnectionLike(report.connection);
  const startTime = Date.now();
  const conn = await provider.connect(connLike);
  const limitedQuery = buildLimitedSqlQuery(report.sqlQuery, report.connection.type, PREVIEW_ROW_LIMIT + 1);
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
    console.error("[ReportRun] Query execution failed", {
      reportId: report.id,
      connectionType: report.connection.type,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json({ error: "Query execution failed" }, { status: 422 });
  } finally {
    await conn.close();
  }
});
