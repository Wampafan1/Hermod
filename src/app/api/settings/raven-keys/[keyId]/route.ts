import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH /api/settings/raven-keys/[keyId] — Revoke a key

const RevokeKeySchema = z.object({
  status: z.literal("revoked"),
});

export const PATCH = withAuth(
  async (req, ctx) => {
    const keyId = req.url.split("/raven-keys/")[1]?.split("/")[0]?.split("?")[0];
    if (!keyId) {
      return NextResponse.json({ error: "Missing keyId" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = RevokeKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.ravenApiKey.findFirst({
      where: { id: keyId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updated = await prisma.ravenApiKey.update({
      where: { id: keyId },
      data: { status: "revoked" },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  },
  { minimumRole: "ADMIN" }
);

// DELETE /api/settings/raven-keys/[keyId] — Permanently delete a key record
export const DELETE = withAuth(
  async (req, ctx) => {
    const keyId = req.url.split("/raven-keys/")[1]?.split("/")[0]?.split("?")[0];
    if (!keyId) {
      return NextResponse.json({ error: "Missing keyId" }, { status: 400 });
    }

    const existing = await prisma.ravenApiKey.findFirst({
      where: { id: keyId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    await prisma.ravenApiKey.delete({ where: { id: keyId } });

    return NextResponse.json({ deleted: true });
  },
  { minimumRole: "ADMIN" }
);
