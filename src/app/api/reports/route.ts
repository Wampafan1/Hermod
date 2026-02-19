import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { createReportSchema } from "@/lib/validations/reports";

// GET /api/reports — list user's reports
export const GET = withAuth(async (_req, session) => {
  const reports = await prisma.report.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      dataSource: { select: { name: true, type: true } },
      schedule: { select: { enabled: true } },
      runHistory: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });

  const mapped = reports.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    connectionName: r.dataSource.name,
    connectionType: r.dataSource.type,
    lastRunStatus: r.runHistory[0]?.status ?? null,
    scheduled: !!r.schedule,
    scheduleEnabled: r.schedule?.enabled ?? false,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json(mapped);
});

// POST /api/reports — create report
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Verify user owns the data source
  const dataSource = await prisma.dataSource.findFirst({
    where: { id: parsed.data.dataSourceId, userId: session.user.id },
  });
  if (!dataSource) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  const report = await prisma.report.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      sqlQuery: parsed.data.sqlQuery,
      dataSourceId: parsed.data.dataSourceId,
      formatting: parsed.data.formatting as any ?? undefined,
      userId: session.user.id,
    },
  });

  return NextResponse.json(report, { status: 201 });
});
