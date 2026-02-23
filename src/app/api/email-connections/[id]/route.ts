import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { encrypt } from "@/lib/crypto";
import { updateEmailConnectionSchema } from "@/lib/validations/email-connections";

// PUT /api/email-connections/[id] — update email connection
export const PUT = withAuth(async (req, session) => {
  const id = req.url.split("/email-connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing ID" }, { status: 400 });
  }

  const existing = await prisma.emailConnection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateEmailConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // If authType is being changed to NONE, clear credentials
  const authType = data.authType ?? existing.authType;
  const updateData: Record<string, unknown> = { ...data };

  if (data.password) {
    updateData.password = encrypt(data.password);
  } else {
    delete updateData.password; // Keep existing password
  }

  if (authType === "NONE") {
    updateData.username = null;
    updateData.password = null;
  }

  const updated = await prisma.emailConnection.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      secure: true,
      authType: true,
      username: true,
      fromAddress: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(updated);
});

// DELETE /api/email-connections/[id]
export const DELETE = withAuth(async (req, session) => {
  const id = req.url.split("/email-connections/")[1]?.split("/")[0]?.split("?")[0];
  if (!id) {
    return NextResponse.json({ error: "Missing ID" }, { status: 400 });
  }

  const existing = await prisma.emailConnection.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });
  }

  // Check if any schedules reference this connection
  const schedulesUsing = await prisma.schedule.count({
    where: { emailConnectionId: id },
  });
  if (schedulesUsing > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${schedulesUsing} schedule(s) use this email connection. Update them first.` },
      { status: 409 }
    );
  }

  await prisma.emailConnection.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
