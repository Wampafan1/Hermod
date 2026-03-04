import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import {
  updateConnectionSchema,
  connectionConfigSchemas,
  connectionCredentialsSchemas,
} from "@/lib/validations/unified-connections";
import type { ConnectionType } from "@/lib/providers/types";

/** Extract the connection ID from the request URL. */
function extractId(url: string): string | null {
  return url.split("/connections/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

/** Prisma select fields shared across GET and PUT responses. */
const connectionSelect = {
  id: true,
  name: true,
  type: true,
  config: true,
  status: true,
  lastTestedAt: true,
  createdAt: true,
  updatedAt: true,
  // NEVER return credentials
} as const;

// ─── GET /api/connections/[id] — fetch single connection ─────
export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const connection = await prisma.connection.findFirst({
    where: { id, userId: session.user.id },
    select: connectionSelect,
  });

  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(connection);
});

// ─── PUT /api/connections/[id] — update connection ───────────
export const PUT = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  // Verify ownership
  const existing = await prisma.connection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse body with the loose update schema first
  const body = await req.json();
  const parsed = updateConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, config, credentials } = parsed.data;
  const connType = existing.type as ConnectionType;

  // Type-aware validation for config if provided
  if (config) {
    const configSchema = connectionConfigSchemas[connType];
    if (configSchema) {
      const configResult = configSchema.safeParse(config);
      if (!configResult.success) {
        return NextResponse.json(
          { error: "Invalid config for type " + connType, details: configResult.error.flatten() },
          { status: 400 }
        );
      }
    }
  }

  // Type-aware validation for credentials if provided
  if (credentials) {
    const credSchema = connectionCredentialsSchemas[connType];
    if (credSchema) {
      const credResult = credSchema.safeParse(credentials);
      if (!credResult.success) {
        return NextResponse.json(
          { error: "Invalid credentials for type " + connType, details: credResult.error.flatten() },
          { status: 400 }
        );
      }
    }
  }

  // Build update payload — only set fields that were provided
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (config !== undefined) updateData.config = config;
  if (credentials !== undefined) {
    updateData.credentials = encrypt(JSON.stringify(credentials));
  }

  const updated = await prisma.connection.update({
    where: { id },
    data: updateData,
    select: connectionSelect,
  });

  return NextResponse.json(updated);
});

// ─── DELETE /api/connections/[id] — delete connection ────────
export const DELETE = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  // Verify ownership
  const existing = await prisma.connection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check if any reports use this connection
  const reportCount = await prisma.report.count({ where: { connectionId: id } });
  if (reportCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${reportCount} report(s) use this connection` },
      { status: 409 }
    );
  }

  await prisma.connection.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
