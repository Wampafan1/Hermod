import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import { MssqlProvider } from "@/lib/providers/mssql.provider";

function extractId(url: string): string | null {
  return url.split("/connections/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

function connectionScope(config: unknown): "DATABASE" | "SERVER" {
  return config && typeof config === "object" && (config as { scope?: unknown }).scope === "SERVER"
    ? "SERVER"
    : "DATABASE";
}

function configuredDatabase(config: unknown): string {
  if (config && typeof config === "object") {
    const database = (config as { database?: unknown }).database;
    if (typeof database === "string" && database.trim()) return database.trim();
  }
  return "master";
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
  if (connection.type !== "MSSQL") {
    return NextResponse.json({ error: "Connection must be MSSQL" }, { status: 400 });
  }

  if (connectionScope(connection.config) !== "SERVER") {
    return NextResponse.json({
      databases: [{
        name: configuredDatabase(connection.config),
        state: "ONLINE",
        recoveryModel: "UNKNOWN",
        canConnect: true,
      }],
    });
  }

  const provider = new MssqlProvider();
  try {
    const databases = await provider.listDatabases(toConnectionLike(connection));
    return NextResponse.json({ databases });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to discover SQL Server databases";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
