import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { createConnectionSchema } from "@/lib/validations/unified-connections";
import { serializeConnection } from "@/lib/connections/api-helpers";

// ─── GET /api/connections — list user's connections ──────────
export const GET = withAuth(async (_req, session) => {
  const connections = await prisma.connection.findMany({
    where: { userId: session.user.id, tenantId: session.tenantId },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      status: true,
      lastTestedAt: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
      // NEVER return credentials
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(connections.map(serializeConnection));
});

// ─── POST /api/connections — create connection ───────────────
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, type, config, credentials } = parsed.data;

  const connection = await prisma.connection.create({
    data: {
      name,
      type,
      config: config as Prisma.InputJsonValue,
      credentials: encrypt(JSON.stringify(credentials)),
      userId: session.user.id,
      tenantId: session.tenantId,
    },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      status: true,
      lastTestedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(serializeConnection(connection), { status: 201 });
});
