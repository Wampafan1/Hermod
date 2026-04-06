import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { canBeDestination } from "@/lib/providers/capabilities";
import type { ConnectionType } from "@/lib/providers/types";
import { listTablesWithColumns } from "@/lib/gates/destination-matcher";

// ─── GET /api/gates/tables?connectionId=xxx ────────

export const GET = withAuth(async (req, ctx) => {
  const connectionId = new URL(req.url).searchParams.get("connectionId");

  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }

  // Verify connection belongs to tenant
  const connection = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      tenantId: ctx.tenantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      credentials: true,
    },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  if (!canBeDestination(connection.type as ConnectionType)) {
    return NextResponse.json(
      { error: "Connection is not a valid destination" },
      { status: 400 }
    );
  }

  const provider = getProvider(connection.type);
  if (!provider.query) {
    return NextResponse.json(
      { error: "Connection does not support queries" },
      { status: 400 }
    );
  }

  const credentials = connection.credentials
    ? JSON.parse(decrypt(connection.credentials))
    : {};
  const providerConn = await provider.connect({
    type: connection.type,
    config: connection.config as Record<string, unknown>,
    credentials,
  });

  try {
    const tables = await listTablesWithColumns(provider, providerConn, connection.type);

    return NextResponse.json({
      tables: tables.map((t) => ({
        schema: t.schema,
        table: t.table,
        fullName: `${t.schema}.${t.table}`,
        columns: t.columns,
      })),
    });
  } finally {
    await providerConn.close();
  }
});
