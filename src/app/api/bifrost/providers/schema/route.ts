import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { fetchSchemaSchema } from "@/lib/validations/bifrost";
import { getProvider, toConnectionLike } from "@/lib/providers";

// POST /api/bifrost/providers/schema — Fetch table schema
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = fetchSchemaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const connection = await prisma.connection.findFirst({
    where: { id: data.connectionId, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const connLike = toConnectionLike(connection);
  const provider = getProvider(connection.type);

  if (!provider.getSchema) {
    return NextResponse.json(
      { error: `Provider ${connection.type} does not support schema inspection` },
      { status: 400 }
    );
  }

  const providerConn = await provider.connect(connLike);

  try {
    const schema = await provider.getSchema(providerConn, data.dataset, data.table);
    return NextResponse.json({ schema, exists: schema !== null });
  } finally {
    await providerConn.close();
  }
});
