import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

// ─── GET /api/gates/[gateId] — gate detail with recent pushes ──

export const GET = withAuth(async (req, ctx) => {
  const gateId = req.url.split("/gates/")[1]?.split("/")[0]?.split("?")[0];
  if (!gateId) {
    return NextResponse.json({ error: "Missing gateId" }, { status: 400 });
  }

  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: ctx.tenantId },
    include: {
      connection: { select: { id: true, name: true, type: true } },
      forgeBlueprint: { select: { id: true, name: true, status: true } },
      pushes: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...gate,
    createdAt: gate.createdAt.toISOString(),
    updatedAt: gate.updatedAt.toISOString(),
    lastPushAt: gate.lastPushAt?.toISOString() ?? null,
    pushes: gate.pushes.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
    })),
  });
});

// ─── PATCH /api/gates/[gateId] — update gate settings ──

export const PATCH = withAuth(async (req, ctx) => {
  const gateId = req.url.split("/gates/")[1]?.split("/")[0]?.split("?")[0];
  if (!gateId) {
    return NextResponse.json({ error: "Missing gateId" }, { status: 400 });
  }

  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: ctx.tenantId },
  });
  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.mergeStrategy !== undefined) {
    if (!["UPSERT", "TRUNCATE_RELOAD", "APPEND"].includes(body.mergeStrategy)) {
      return NextResponse.json({ error: "Invalid mergeStrategy" }, { status: 400 });
    }
    updates.mergeStrategy = body.mergeStrategy;
  }
  if (body.status !== undefined) {
    if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }

  const updated = await prisma.realmGate.update({
    where: { id: gateId },
    data: updates,
  });

  return NextResponse.json(updated);
});

// ─── DELETE /api/gates/[gateId] — soft delete (archive) ──

export const DELETE = withAuth(async (req, ctx) => {
  const gateId = req.url.split("/gates/")[1]?.split("/")[0]?.split("?")[0];
  if (!gateId) {
    return NextResponse.json({ error: "Missing gateId" }, { status: 400 });
  }

  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: ctx.tenantId },
  });
  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }

  await prisma.realmGate.update({
    where: { id: gateId },
    data: { status: "ARCHIVED" },
  });

  return NextResponse.json({ success: true });
});
