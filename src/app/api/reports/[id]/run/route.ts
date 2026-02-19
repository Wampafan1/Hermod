import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { getConnector } from "@/lib/connectors";

// POST /api/reports/[id]/run — execute report query (preview, no history)
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: { dataSource: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const startTime = Date.now();
  const connector = getConnector(report.dataSource as Parameters<typeof getConnector>[0]);
  try {
    const result = await connector.query(report.sqlQuery);
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
