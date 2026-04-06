import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { generateRavenApiKey } from "@/lib/raven/api-key";
import { requireTierFeature } from "@/lib/tier-gate";

export const dynamic = "force-dynamic";

// GET /api/settings/raven-keys — List all Raven API keys for the current tenant
export const GET = withAuth(async (_req, ctx) => {
  const denied = await requireTierFeature(ctx.tenantId, "dataAgent", "Data Agent");
  if (denied) return denied;

  const keys = await prisma.ravenApiKey.findMany({
    where: { tenantId: ctx.tenantId },
    select: {
      id: true,
      keyPrefix: true,
      name: true,
      scopes: true,
      status: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      // NEVER return keyHash or the full key
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(keys);
});

// POST /api/settings/raven-keys — Generate a new Raven API key

const CreateKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});

export const POST = withAuth(
  async (req, ctx) => {
    const denied = await requireTierFeature(ctx.tenantId, "dataAgent", "Data Agent");
    if (denied) return denied;

    const body = await req.json();
    const parsed = CreateKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, expiresAt } = parsed.data;

    const { fullKey, prefix, hash } = await generateRavenApiKey();

    const record = await prisma.ravenApiKey.create({
      data: {
        tenantId: ctx.tenantId,
        keyHash: hash,
        keyPrefix: prefix,
        name,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        scopes: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    // fullKey is returned ONCE here — never retrievable again
    return NextResponse.json(
      { ...record, fullKey, prefix },
      { status: 201 }
    );
  },
  { minimumRole: "ADMIN" }
);
