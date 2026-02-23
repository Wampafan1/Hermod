import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { createEmailConnectionSchema } from "@/lib/validations/email-connections";

// GET /api/email-connections — list user's email connections (password excluded)
export const GET = withAuth(async (_req, session) => {
  const connections = await prisma.emailConnection.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      secure: true,
      authType: true,
      username: true,
      fromAddress: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(connections);
});

// POST /api/email-connections — create email connection
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createEmailConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const connection = await prisma.emailConnection.create({
    data: {
      name: data.name,
      host: data.host,
      port: data.port,
      secure: data.secure,
      authType: data.authType,
      username: data.username ?? null,
      password: data.password ? encrypt(data.password) : null,
      fromAddress: data.fromAddress,
      userId: session.user.id,
    },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      secure: true,
      authType: true,
      username: true,
      fromAddress: true,
      createdAt: true,
    },
  });

  return NextResponse.json(connection, { status: 201 });
});
