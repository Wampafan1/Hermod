import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { updateReportSchema } from "@/lib/validations/reports";
import { validateReportBlueprintAttachment } from "@/lib/mjolnir/report-blueprint-attach";

// GET /api/reports/[id] — get single report
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/reports/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing report ID" }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, userId: session.user.id, tenantId: session.tenantId },
    include: {
      connection: { select: { id: true, name: true, type: true } },
      schedule: { select: { id: true, enabled: true } },
      blueprintVersion: {
        select: {
          id: true,
          blueprintId: true,
          version: true,
          stepsHash: true,
          createdAt: true,
          source: true,
          isLocked: true,
          blueprint: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
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
    where: { id, userId: session.user.id, tenantId: session.tenantId },
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

  // If changing connection, verify ownership
  if (parsed.data.connectionId) {
    const conn = await prisma.connection.findFirst({
      where: {
        id: parsed.data.connectionId,
        userId: session.user.id,
        tenantId: session.tenantId,
      },
    });
    if (!conn) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
  }

  let blueprintId: string | null | undefined;
  let blueprintVersionId: string | null | undefined;
  if (
    parsed.data.blueprintVersionId !== undefined ||
    parsed.data.blueprintId !== undefined
  ) {
    const requestedBlueprintVersionId = parsed.data.blueprintVersionId?.trim() || null;
    const requestedBlueprintId = requestedBlueprintVersionId
      ? null
      : parsed.data.blueprintId?.trim() || null;
    const attachmentChanged =
      requestedBlueprintVersionId !== (existing.blueprintVersionId ?? null) ||
      requestedBlueprintId !== (existing.blueprintId ?? null);

    if (attachmentChanged) {
      const blueprintValidation = await validateReportBlueprintAttachment({
        blueprintVersionId: requestedBlueprintVersionId,
        legacyBlueprintId: requestedBlueprintId,
        userId: session.user.id,
        tenantId: session.tenantId,
      });
      if (!blueprintValidation.ok) {
        return NextResponse.json(
          { error: blueprintValidation.error },
          { status: blueprintValidation.status }
        );
      }
      blueprintVersionId = blueprintValidation.data.blueprintVersionId;
      blueprintId = blueprintValidation.data.blueprintId;
    }
  }

  const updated = await prisma.report.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      sqlQuery: parsed.data.sqlQuery,
      connectionId: parsed.data.connectionId,
      formatting: parsed.data.formatting as Prisma.InputJsonValue ?? undefined,
      columnConfig: parsed.data.columnConfig as Prisma.InputJsonValue ?? undefined,
      blueprintVersionId,
      blueprintId,
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
    where: { id, userId: session.user.id, tenantId: session.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  await prisma.report.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
