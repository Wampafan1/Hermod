import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";

// TODO: rate-limit this endpoint — Ravens poll every 30s, a buggy tight loop could overwhelm the API

const HeartbeatSchema = z.object({
  ravenId: z.string().uuid(),
  version: z.string().optional(),
  uptime: z.number().optional(),
  platform: z.string().optional(),
  hostname: z.string().optional(),
  connections: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        driver: z.string(),
        database: z.string().optional(),
        status: z.string(),
        lastTestedAt: z.string().optional(),
      })
    )
    .optional(),
  activeJobs: z.number().optional(),
  lastJobAt: z.string().optional(),
  memoryUsage: z.number().optional(),
  cpuUsage: z.number().optional(),
});

// POST /api/raven/heartbeat — Raven heartbeat
export const POST = withRavenAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = HeartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId, version, hostname, connections, ...heartbeatMeta } =
    parsed.data;

  // Verify Raven belongs to this tenant
  const raven = await prisma.ravenSatellite.findFirst({
    where: { id: ravenId, tenantId: ctx.tenantId },
    select: { id: true, status: true },
  });

  if (!raven) {
    return NextResponse.json({ error: "Raven not found" }, { status: 404 });
  }

  if (raven.status === "revoked") {
    return NextResponse.json({ error: "Raven has been revoked" }, { status: 403 });
  }

  // Server timestamps only — ignore any client-provided timestamps
  await prisma.ravenSatellite.update({
    where: { id: raven.id },
    data: {
      lastHeartbeatAt: new Date(),
      status: "active",
      metadata: heartbeatMeta as Record<string, unknown>,
      ...(connections && {
        connections: connections as unknown as Record<string, unknown>[],
      }),
      ...(version && { version }),
      ...(hostname && { hostname }),
    },
  });

  return NextResponse.json({
    status: "ok",
    config: {
      pollIntervalSeconds: 30,
      maxConcurrentJobs: 2,
    },
  });
});
