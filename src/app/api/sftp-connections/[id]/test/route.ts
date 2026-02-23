import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { testSftpFolders } from "@/lib/sftp-utils";

// POST /api/sftp-connections/[id]/test — test SFTP connection
export const POST = withAuth(async (req, session) => {
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

  const result = testSftpFolders(connection.sftpUsername);
  return NextResponse.json(result);
});
