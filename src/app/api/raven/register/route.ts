import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";
import { hasTierFeature } from "@/lib/tiers";

const RegisterSchema = z.object({
  ravenName: z.string().min(1).max(200),
  platform: z.string().min(1),
  version: z.string().min(1),
  hostname: z.string().min(1),
  connections: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      driver: z.enum(["mssql", "postgres", "mysql"]),
      database: z.string(),
    })
  ),
});

// POST /api/raven/register — Register or heal a Raven satellite
export const POST = withRavenAuth(async (req, ctx) => {
  const tenantForGate = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { plan: true },
  });
  if (!tenantForGate || !hasTierFeature(tenantForGate.plan, "dataAgent")) {
    return NextResponse.json({ error: "Data Agent requires Thor or Odin tier" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenName, platform, version, hostname, connections } = parsed.data;

  // Look up the API key to get the hash for linking
  const apiKey = await prisma.ravenApiKey.findUnique({
    where: { id: ctx.apiKeyId },
    select: { keyHash: true },
  });
  if (!apiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency: check for existing Raven by tenantId + hostname
  const existing = await prisma.ravenSatellite.findFirst({
    where: { tenantId: ctx.tenantId, hostname },
  });

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { name: true },
  });

  if (existing) {
    // Heal: update existing registration instead of failing
    const updated = await prisma.ravenSatellite.update({
      where: { id: existing.id },
      data: {
        name: ravenName,
        apiKeyHash: apiKey.keyHash,
        status: "active",
        version,
        platform,
        hostname,
        connections: connections as unknown as Record<string, unknown>[],
        lastHeartbeatAt: new Date(),
      },
    });

    return NextResponse.json({
      ravenId: updated.id,
      tenantId: ctx.tenantId,
      tenantName: tenant?.name ?? null,
      status: "active",
    });
  }

  // Create new Raven satellite
  const raven = await prisma.ravenSatellite.create({
    data: {
      tenantId: ctx.tenantId,
      name: ravenName,
      apiKeyHash: apiKey.keyHash,
      status: "active",
      version,
      platform,
      hostname,
      connections: connections as unknown as Record<string, unknown>[],
      lastHeartbeatAt: new Date(),
    },
  });

  return NextResponse.json(
    {
      ravenId: raven.id,
      tenantId: ctx.tenantId,
      tenantName: tenant?.name ?? null,
      status: "active",
    },
    { status: 201 }
  );
});
