import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

const confirmSchemaInput = z.object({
  connectionId: z.string().min(1),
  schema: z.object({
    columns: z.array(
      z.object({
        name: z.string(),
        inferredType: z.enum(["string", "number", "date", "boolean"]),
        nullable: z.boolean(),
        sampleValues: z.array(z.string()),
      })
    ),
  }),
});

/** POST — Confirm detected schema as baseline for a connection */
export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = confirmSchemaInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { connectionId, schema } = parsed.data;

  // Verify connection belongs to tenant
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, tenantId: ctx.tenantId },
    select: { id: true, config: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // Merge baselineSchema into existing config
  const existingConfig = (connection.config as Record<string, unknown>) ?? {};
  await prisma.connection.update({
    where: { id: connectionId },
    data: {
      config: { ...existingConfig, baselineSchema: schema },
    },
  });

  // Also mark any PENDING file entries for this connection as LOADED
  // (the first upload that triggered confirmation)
  await prisma.fileEntry.updateMany({
    where: { connectionId, status: "PENDING", tenantId: ctx.tenantId },
    data: { status: "LOADED", processedAt: new Date() },
  });

  return NextResponse.json({ success: true });
});
