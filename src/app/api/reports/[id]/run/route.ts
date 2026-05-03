import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { getProvider, toConnectionLike } from "@/lib/providers";

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
  try {
    const result = await provider.query(conn, report.sqlQuery);
    const executionTime = Date.now() - startTime;
    return NextResponse.json({
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      executionTime,
    });
  } catch (error) {
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
