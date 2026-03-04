import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { testSendSchema } from "@/lib/validations/reports";
import { sendReportEmail, toEmailConfig } from "@/lib/email";
import { executeReportPipeline } from "@/lib/report-runner";
import { format } from "date-fns";
import {
  renderEmailTemplate,
  renderPlainText,
  buildSubject,
  formatFileSize,
  type HermodEmailModel,
} from "@/lib/email-templates";

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
    include: { connection: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Execute shared pipeline (query → column config → blueprint → Excel)
  const pipeline = await executeReportPipeline({
    name: report.name,
    sqlQuery: report.sqlQuery,
    connectionId: report.connectionId,
    columnConfig: report.columnConfig,
    formatting: report.formatting,
    blueprintId: report.blueprintId,
  });

  // Build email with template
  const now = new Date();
  const reportDate = format(now, "MMMM d, yyyy");
  const filename = `${report.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}_${format(now, "yyyy-MM-dd")}.xlsx`;

  const emailModel: HermodEmailModel = {
    reportName: report.name,
    reportDate,
    filename,
    fileSize: formatFileSize(pipeline.excelBuffer.length),
    nextSchedule: "N/A",
    recipientName: "Team",
    // Admin fields
    clientName: "Team",
    datasource: report.connection.name,
    executionDate: format(now, "yyyy-MM-dd HH:mm:ss"),
    duration: `${(pipeline.runTimeMs / 1000).toFixed(1)}s`,
    rowCount: pipeline.rowCount,
    sheetCount: 1,
    sqlPreview: report.sqlQuery,
    version: process.env.npm_package_version || "0.1.0",
    managedBy: session.user.name || session.user.email || "Hermod",
  };

  const subject = buildSubject(report.name, reportDate, true);
  const html = renderEmailTemplate("enduser", emailModel);
  const text = renderPlainText(emailModel);

  await sendReportEmail({
    connection: emailConfig,
    to: recipients,
    subject,
    text,
    html,
    attachment: pipeline.excelBuffer,
    filename,
  });

  return NextResponse.json({
    success: true,
    rowCount: pipeline.rowCount,
    recipients,
  });
});
