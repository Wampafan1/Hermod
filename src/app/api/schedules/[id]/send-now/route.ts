import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { executeReportPipeline } from "@/lib/report-runner";
import { sendReportEmail, toEmailConfig } from "@/lib/email";
import { formatInTimeZone } from "date-fns-tz";
import {
  renderEmailTemplate,
  renderPlainText,
  buildSubject,
  formatFileSize,
  type HermodEmailModel,
} from "@/lib/email-templates";

// POST /api/schedules/[id]/send-now — immediately send report to all scheduled recipients
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/schedules/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing schedule ID" }, { status: 400 });
  }

  const schedule = await prisma.schedule.findFirst({
    where: { id, report: { userId: session.user.id } },
    include: {
      recipients: true,
      emailConnection: true,
      report: { include: { connection: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  if (!schedule.emailConnection) {
    return NextResponse.json(
      { error: "No email connection configured for this schedule" },
      { status: 400 }
    );
  }

  const recipients = schedule.recipients.map((r) => r.email);
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients configured" }, { status: 400 });
  }

  const emailConfig = toEmailConfig(schedule.emailConnection);
  const report = schedule.report;

  // Execute shared pipeline (query → column config → blueprint → Excel)
  const pipeline = await executeReportPipeline({
    name: report.name,
    sqlQuery: report.sqlQuery,
    connectionId: report.connectionId,
    columnConfig: report.columnConfig,
    formatting: report.formatting,
    blueprintId: report.blueprintId,
  });

  // Build email (same logic as runReport in report-runner.ts)
  const now = new Date();
  const tz = schedule.timezone || "America/Chicago";
  const reportDate = formatInTimeZone(now, tz, "MMMM d, yyyy");
  const filename = `${report.name.replace(/[\/\\:*?"<>|]/g, "")}_${formatInTimeZone(now, tz, "yyyy-MM-dd")}.xlsx`;

  const emailModel: HermodEmailModel = {
    reportName: report.name,
    reportDate,
    filename,
    fileSize: formatFileSize(pipeline.excelBuffer.length),
    nextSchedule: schedule.nextRunAt
      ? formatInTimeZone(schedule.nextRunAt, tz, "EEEE, MMMM d 'at' h:mm a")
      : "N/A",
    recipientName: "Team",
    clientName: "Team",
    datasource: report.connection.name,
    executionDate: formatInTimeZone(now, tz, "yyyy-MM-dd HH:mm:ss"),
    duration: `${(pipeline.runTimeMs / 1000).toFixed(1)}s`,
    rowCount: pipeline.rowCount,
    sheetCount: 1,
    sqlPreview: report.sqlQuery,
    version: process.env.npm_package_version || "0.1.0",
    managedBy: report.user?.name || report.user?.email || "Hermod",
  };

  const subject = buildSubject(report.name, reportDate);
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
    recipientCount: recipients.length,
  });
});
