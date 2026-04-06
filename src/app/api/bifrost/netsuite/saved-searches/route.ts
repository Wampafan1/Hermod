import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { NetSuiteProvider } from "@/lib/providers/netsuite.provider";
import { toConnectionLike } from "@/lib/providers";

// GET /api/bifrost/netsuite/saved-searches?connectionId=xxx
export const GET = withAuth(async (req, session) => {
  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");

  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }

  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: session.user.id, type: "NETSUITE" },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "NetSuite connection not found" },
      { status: 404 }
    );
  }

  const provider = new NetSuiteProvider();
  const connLike = toConnectionLike(connection);
  const conn = await provider.connect(connLike);

  try {
    const searches = await provider.listSavedSearches(conn);
    return NextResponse.json(searches);
  } finally {
    await conn.close();
  }
});
