import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { updateConnectionSchema } from "@/lib/validations/connections";

// PUT /api/connections/[id] — update connection
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const existing = await prisma.dataSource.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.host !== undefined) updateData.host = data.host;
  if (data.port !== undefined) updateData.port = data.port;
  if (data.database !== undefined) updateData.database = data.database;
  if (data.username !== undefined) updateData.username = data.username;
  if (data.password !== undefined) updateData.password = encrypt(data.password);
  if (data.extras !== undefined) updateData.extras = data.extras;

  const updated = await prisma.dataSource.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      database: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(updated);
});

// DELETE /api/connections/[id] — delete connection
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const existing = await prisma.dataSource.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // Check if any reports use this connection
  const reportCount = await prisma.report.count({
    where: { dataSourceId: id },
  });
  if (reportCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${reportCount} report(s) use this connection` },
      { status: 409 }
    );
  }

  await prisma.dataSource.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
