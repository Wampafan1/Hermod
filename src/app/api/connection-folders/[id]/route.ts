import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  icon: z.string().max(10).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/** PATCH — Update folder properties */
export const PATCH = withAuth(async (req, ctx) => {
  const id = new URL(req.url).pathname.split("/").pop()!;

  const folder = await prisma.connectionFolder.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const updated = await prisma.connectionFolder.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
});

/** DELETE — Delete folder, move its connections to unfiled */
export const DELETE = withAuth(async (req, ctx) => {
  const id = new URL(req.url).pathname.split("/").pop()!;

  const folder = await prisma.connectionFolder.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Move connections to unfiled, then delete folder
  await prisma.$transaction([
    prisma.connection.updateMany({
      where: { folderId: id },
      data: { folderId: null },
    }),
    prisma.connectionFolder.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
});
