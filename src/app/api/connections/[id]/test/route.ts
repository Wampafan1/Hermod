import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getProvider, toConnectionLike } from "@/lib/providers";

// POST /api/connections/[id]/test — test a saved connection
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/connections/")[1]?.split("/")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const connection = await prisma.connection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const provider = getProvider(connection.type);
  const connLike = toConnectionLike(connection);

  try {
    const success = await provider.testConnection(connLike);
    return NextResponse.json({ success });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    return NextResponse.json({ success: false, error: message });
  }
});
