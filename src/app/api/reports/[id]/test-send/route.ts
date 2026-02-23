import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { testSendSchema } from "@/lib/validations/reports";
import { getConnector } from "@/lib/connectors";
import { sendReportEmail, toEmailConfig } from "@/lib/email";
import { generateExcel } from "@/lib/report-runner";
import { applyColumnConfig, generateColumnConfig, migrateConfigWidths } from "@/lib/column-config";
import type { ColumnConfig } from "@/lib/column-config";
import type { SheetTemplate } from "@/components/reports/univer-sheet";
import { format } from "date-fns";

// POST /api/reports/[id]/test-send — send report to arbitrary recipients
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = testSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const { recipients, emailConnectionId } = parsed.data;

  // Verify user owns the email connection
  const emailConn = await prisma.emailConnection.findFirst({
    where: { id: emailConnectionId, userId: session.user.id },
  });
  if (!emailConn) {
    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });
  }
  const emailConfig = toEmailConfig(emailConn);

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: { dataSource: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Execute query
  const connector = getConnector(
    report.dataSource as Parameters<typeof getConnector>[0]
  );
  let result;
  try {
    result = await connector.query(report.sqlQuery);
  } finally {
    await connector.disconnect();
  }

  // Load column config (or generate default from query), migrate old pixel widths
  const rawConfig =
    (report.columnConfig as ColumnConfig[] | null) ??
    generateColumnConfig(result.columns);
  const colConfig = migrateConfigWidths(rawConfig);

  // Apply column config mapping
  const {
    columns: mappedCols,
    rows: mappedRows,
    configIds,
  } = applyColumnConfig(colConfig, result.columns, result.rows);

  // Generate Excel
  const template = (report.formatting as SheetTemplate | null) ?? null;
  const excelBuffer = await generateExcel(
    report.name,
    mappedCols,
    mappedRows,
    configIds,
    colConfig,
    template
  );

  // Build email
  const now = new Date();
  const filename = `${report.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}_${format(now, "yyyy-MM-dd")}.xlsx`;

  await sendReportEmail({
    connection: emailConfig,
    to: recipients,
    subject: `[Test] ${report.name} - ${format(now, "yyyy-MM-dd")}`,
    body: `Test send of "${report.name}"\n\n${result.rows.length} rows, generated ${format(now, "yyyy-MM-dd HH:mm")}`,
    attachment: excelBuffer,
    filename,
  });

  return NextResponse.json({
    success: true,
    rowCount: result.rows.length,
    recipients,
  });
});
