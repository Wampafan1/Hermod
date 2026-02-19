import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { updateReportSchema } from "@/lib/validations/reports";

// GET /api/reports/[id] — get single report
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    include: {
      dataSource: { select: { id: true, name: true, type: true } },
      schedule: { select: { id: true, enabled: true } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json(report);
});

// PUT /api/reports/[id] — update report
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const existing = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // If changing data source, verify ownership
  if (parsed.data.dataSourceId) {
    const ds = await prisma.dataSource.findFirst({
      where: { id: parsed.data.dataSourceId, userId: session.user.id },
    });
    if (!ds) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
  }

  const updated = await prisma.report.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      sqlQuery: parsed.data.sqlQuery,
      dataSourceId: parsed.data.dataSourceId,
      formatting: parsed.data.formatting as any ?? undefined,
    },
  });

  return NextResponse.json(updated);
});

// DELETE /api/reports/[id] — delete report
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const existing = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  await prisma.report.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
