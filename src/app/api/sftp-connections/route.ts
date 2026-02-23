import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { createSftpConnectionSchema } from "@/lib/validations/sftp-connections";
import {
  slugifyUsername,
  generateSftpPassword,
  createSftpFolders,
  appendSftpUser,
} from "@/lib/sftp-utils";

// GET /api/sftp-connections — list user's SFTP connections
export const GET = withAuth(async (_req, session) => {
  const connections = await prisma.sftpConnection.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
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
      // Never return sftpPassword in list
    },
  });
  return NextResponse.json(connections);
});

// POST /api/sftp-connections — create SFTP connection
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createSftpConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Generate SFTP credentials
  const baseUsername = slugifyUsername(data.name);
  // Ensure unique username by checking DB
  let sftpUsername = baseUsername;
  let suffix = 0;
  while (
    await prisma.sftpConnection.findUnique({ where: { sftpUsername } })
  ) {
    suffix++;
    sftpUsername = `${baseUsername}-${suffix}`;
  }

  const rawPassword = generateSftpPassword();

  // Create folder structure
  createSftpFolders(sftpUsername);

  // Add user to SFTP config
  appendSftpUser(sftpUsername, rawPassword);

  // Store connection with encrypted password
  const sftpHost = process.env.SFTP_HOST || "localhost";
  const sftpPort = parseInt(process.env.SFTP_PORT || "2222", 10);

  const connection = await prisma.sftpConnection.create({
    data: {
      name: data.name,
      description: data.description,
      sourceType: data.sourceType,
      sftpHost,
      sftpPort,
      sftpUsername,
      sftpPassword: encrypt(rawPassword),
      fileFormat: data.fileFormat,
      bqDataset: data.bqDataset,
      bqTable: data.bqTable,
      loadMode: data.loadMode,
      notificationEmails: data.notificationEmails,
      userId: session.user.id,
    },
    select: {
      id: true,
      name: true,
      sourceType: true,
      sftpHost: true,
      sftpPort: true,
      sftpUsername: true,
      createdAt: true,
    },
  });

  // Return the raw password only on creation (never stored in plaintext)
  return NextResponse.json(
    { ...connection, sftpPassword: rawPassword },
    { status: 201 }
  );
});
