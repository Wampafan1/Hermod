import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createStorageTargetSchema } from "@/lib/validations/backup-storage";
import { serializeStorageTarget } from "@/lib/backups/api-helpers";

const storageTargetSelect = {
  id: true,
  name: true,
  provider: true,
  accessMode: true,
  config: true,
  status: true,
  lastTestedAt: true,
  lastTestResult: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = withAuth(async (_req, session) => {
  const targets = await prisma.backupStorageTarget.findMany({
    where: {
      OR: [
        { tenantId: session.tenantId },
        { userId: session.userId },
      ],
    },
    select: storageTargetSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(targets.map(serializeStorageTarget));
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createStorageTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const target = await prisma.backupStorageTarget.create({
    data: {
      name: parsed.data.name,
      provider: parsed.data.provider,
      accessMode: parsed.data.accessMode,
      config: parsed.data.config as Prisma.InputJsonValue,
      credentials: parsed.data.credentials
        ? encrypt(JSON.stringify(parsed.data.credentials))
        : null,
      status: parsed.data.status,
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: storageTargetSelect,
  });

  return NextResponse.json(serializeStorageTarget(target), { status: 201 });
}, { minimumRole: "ADMIN" });
