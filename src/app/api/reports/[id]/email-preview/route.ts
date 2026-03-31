import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { format } from "date-fns";
import {
  renderEmailTemplate,
  formatFileSize,
  type HermodEmailModel,
} from "@/lib/email-templates";

// GET /api/reports/[id]/email-preview — render email HTML without sending
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: { connection: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const now = new Date();
  const reportDate = format(now, "MMMM d, yyyy");
  const filename = `${report.name.replace(/[\/\\:*?"<>|]/g, "")}_${format(now, "yyyy-MM-dd")}.xlsx`;

  const emailModel: HermodEmailModel = {
    reportName: report.name,
    reportDate,
    filename,
    fileSize: formatFileSize(48_128),
    nextSchedule: "Tomorrow at 8:00 AM",
    recipientName: "Team",
    clientName: "Team",
    datasource: report.connection.name,
    executionDate: format(now, "yyyy-MM-dd HH:mm:ss"),
    duration: "2.3s",
    rowCount: 1250,
    sheetCount: 1,
    sqlPreview: report.sqlQuery,
    version: process.env.npm_package_version || "0.1.0",
    managedBy: session.user.name || session.user.email || "Hermod",
  };

  const html = renderEmailTemplate("enduser", emailModel);

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
