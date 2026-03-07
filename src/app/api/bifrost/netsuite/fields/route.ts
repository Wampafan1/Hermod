import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { NetSuiteProvider } from "@/lib/providers/netsuite.provider";
import { toConnectionLike } from "@/lib/providers";

// GET /api/bifrost/netsuite/fields?connectionId=xxx&recordType=customer
export const GET = withAuth(async (req, session) => {
  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");
  const recordType = searchParams.get("recordType");

  if (!connectionId || !recordType) {
    return NextResponse.json(
      { error: "connectionId and recordType are required" },
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
    const fields = await provider.getRecordFields(conn, recordType);
    return NextResponse.json(fields);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[netsuite/fields] Error for recordType=${recordType}:`, message);
    return NextResponse.json(
      { error: "Failed to fetch fields for this record type", fields: [] },
      { status: 500 }
    );
  } finally {
    await conn.close();
  }
});
