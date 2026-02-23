import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { updateSftpConnectionSchema } from "@/lib/validations/sftp-connections";
import { removeSftpUser } from "@/lib/sftp-utils";

// GET /api/sftp-connections/[id] — get single SFTP connection (with credentials)
export const GET = withAuth(async (req, session) => {
  const id = req.url.split("/sftp-connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const connection = await prisma.sftpConnection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // Decrypt password for credential display
  let rawPassword: string | null = null;
  try {
    rawPassword = decrypt(connection.sftpPassword);
  } catch {
    rawPassword = null;
  }

  return NextResponse.json({
    ...connection,
    sftpPassword: rawPassword,
  });
});

// PUT /api/sftp-connections/[id] — update SFTP connection
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/sftp-connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const existing = await prisma.sftpConnection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateSftpConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.fileFormat !== undefined) updateData.fileFormat = data.fileFormat;
  if (data.bqDataset !== undefined) updateData.bqDataset = data.bqDataset;
  if (data.bqTable !== undefined) updateData.bqTable = data.bqTable;
  if (data.loadMode !== undefined) updateData.loadMode = data.loadMode;
  if (data.notificationEmails !== undefined) updateData.notificationEmails = data.notificationEmails;
  if (data.status !== undefined) updateData.status = data.status;

  const updated = await prisma.sftpConnection.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      sourceType: true,
      sftpHost: true,
      sftpPort: true,
      sftpUsername: true,
      fileFormat: true,
      bqDataset: true,
      bqTable: true,
      loadMode: true,
      notificationEmails: true,
      status: true,
      lastFileAt: true,
      lastFileName: true,
      filesProcessed: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(updated);
});

// DELETE /api/sftp-connections/[id] — delete SFTP connection
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/sftp-connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });
  }

  const existing = await prisma.sftpConnection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  // Remove SFTP user config
  removeSftpUser(existing.sftpUsername);

  await prisma.sftpConnection.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
