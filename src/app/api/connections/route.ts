import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { createConnectionSchema } from "@/lib/validations/connections";

// GET /api/connections — list user's connections
export const GET = withAuth(async (_req, session) => {
  const connections = await prisma.dataSource.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      database: true,
      username: true,
      extras: true,
      createdAt: true,
      updatedAt: true,
      // Never return password
    },
  });
  return NextResponse.json(connections);
});

// POST /api/connections — create connection
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const isBigQuery = data.type === "BIGQUERY";

  const connection = await prisma.dataSource.create({
    data: {
      name: data.name,
      type: data.type,
      host: isBigQuery ? null : (data as any).host,
      port: isBigQuery ? null : (data as any).port,
      database: isBigQuery ? null : (data as any).database,
      username: isBigQuery ? null : (data as any).username,
      password: isBigQuery ? null : encrypt((data as any).password),
      extras: isBigQuery ? (data as any).extras : null,
      userId: session.user.id,
    },
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      database: true,
      username: true,
      createdAt: true,
    },
  });

  return NextResponse.json(connection, { status: 201 });
});
