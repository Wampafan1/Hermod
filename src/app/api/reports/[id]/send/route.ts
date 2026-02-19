import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { runReport } from "@/lib/report-runner";

// POST /api/reports/[id]/send — manually trigger report run + email
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: {
      dataSource: true,
      schedule: { include: { recipients: true } },
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!report.schedule || report.schedule.recipients.length === 0) {
    return NextResponse.json(
      { error: "Report has no schedule or recipients" },
      { status: 400 }
    );
  }

  try {
    const runLog = await runReport(report.id, report.schedule.id);
    return NextResponse.json(runLog);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Report send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
