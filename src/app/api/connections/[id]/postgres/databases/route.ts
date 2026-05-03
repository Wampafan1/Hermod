import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import { PostgresProvider } from "@/lib/providers/postgres.provider";
import {
  configuredDatabase,
  postgresConnectionScope,
} from "@/lib/backups/postgres/database-selection";

function extractId(url: string): string | null {
  return url.split("/connections/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const connection = await prisma.connection.findFirst({
    where: { id, userId: session.userId, tenantId: session.tenantId },
    select: {
      id: true,
      type: true,
      config: true,
      credentials: true,
    },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.type !== "POSTGRES") {
    return NextResponse.json({ error: "Connection must be POSTGRES" }, { status: 400 });
  }

  if (postgresConnectionScope(connection.config) !== "SERVER") {
    return NextResponse.json({
      databases: [{
        name: configuredDatabase(connection.config),
        canConnect: true,
      }],
    });
  }

  const provider = new PostgresProvider();
  try {
    const databases = await provider.listDatabases(toConnectionLike(connection));
    return NextResponse.json({ databases });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to discover PostgreSQL databases";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
