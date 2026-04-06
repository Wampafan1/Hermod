import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/ravens/[ravenId] — Get Raven details + recent jobs
export const GET = withAuth(async (req, ctx) => {
  const ravenId = req.url.split("/ravens/")[1]?.split("/")[0]?.split("?")[0];
  if (!ravenId) {
    return NextResponse.json({ error: "Missing ravenId" }, { status: 400 });
  }

  const raven = await prisma.ravenSatellite.findFirst({
    where: { id: ravenId, tenantId: ctx.tenantId },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          connectionId: true,
          query: true,
          status: true,
          priority: true,
          claimedAt: true,
          startedAt: true,
          completedAt: true,
          result: true,
          createdAt: true,
        },
      },
    },
  });

  if (!raven) {
    return NextResponse.json({ error: "Raven not found" }, { status: 404 });
  }

  return NextResponse.json(raven);
});

// PATCH /api/settings/ravens/[ravenId] — Update Raven (rename, revoke)

const UpdateRavenSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.literal("revoked").optional(),
});

export const PATCH = withAuth(
  async (req, ctx) => {
    const ravenId = req.url.split("/ravens/")[1]?.split("/")[0]?.split("?")[0];
    if (!ravenId) {
      return NextResponse.json({ error: "Missing ravenId" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = UpdateRavenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify Raven belongs to this tenant
    const existing = await prisma.ravenSatellite.findFirst({
      where: { id: ravenId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Raven not found" }, { status: 404 });
    }

    const updated = await prisma.ravenSatellite.update({
      where: { id: ravenId },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        status: true,
        version: true,
        hostname: true,
        platform: true,
        lastHeartbeatAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  },
  { minimumRole: "ADMIN" }
);

// DELETE /api/settings/ravens/[ravenId] — Delete Raven and all jobs/chunks (cascade)
export const DELETE = withAuth(
  async (req, ctx) => {
    const ravenId = req.url.split("/ravens/")[1]?.split("/")[0]?.split("?")[0];
    if (!ravenId) {
      return NextResponse.json({ error: "Missing ravenId" }, { status: 400 });
    }

    const existing = await prisma.ravenSatellite.findFirst({
      where: { id: ravenId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Raven not found" }, { status: 404 });
    }

    // Cascade delete: RavenSatellite → RavenJob → RavenIngestChunk
    await prisma.ravenSatellite.delete({ where: { id: ravenId } });

    return NextResponse.json({ deleted: true });
  },
  { minimumRole: "ADMIN" }
);
