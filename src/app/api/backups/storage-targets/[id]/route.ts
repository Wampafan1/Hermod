import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { updateStorageTargetSchema } from "@/lib/validations/backup-storage";
import { serializeStorageTarget } from "@/lib/backups/api-helpers";

function extractId(url: string): string | null {
  return url.split("/backups/storage-targets/")[1]?.split("/")[0]?.split("?")[0] ?? null;
}

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

export const GET = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing storage target ID" }, { status: 400 });

  const target = await prisma.backupStorageTarget.findFirst({
    where: {
      id,
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: storageTargetSelect,
  });
  if (!target) return NextResponse.json({ error: "Storage target not found" }, { status: 404 });

  return NextResponse.json(serializeStorageTarget(target));
});

export const PUT = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing storage target ID" }, { status: 400 });

  const existing = await prisma.backupStorageTarget.findFirst({
    where: {
      id,
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Storage target not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateStorageTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updateData: Prisma.BackupStorageTargetUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.provider !== undefined) updateData.provider = parsed.data.provider;
  if (parsed.data.accessMode !== undefined) updateData.accessMode = parsed.data.accessMode;
  if (parsed.data.config !== undefined) updateData.config = parsed.data.config as Prisma.InputJsonValue;
  if (parsed.data.credentials !== undefined) {
    updateData.credentials = parsed.data.credentials
      ? encrypt(JSON.stringify(parsed.data.credentials))
      : null;
  }
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

  const target = await prisma.backupStorageTarget.update({
    where: { id },
    data: updateData,
    select: storageTargetSelect,
  });

  return NextResponse.json(serializeStorageTarget(target));
}, { minimumRole: "ADMIN" });

export const DELETE = withAuth(async (req, session) => {
  const id = extractId(req.url);
  if (!id) return NextResponse.json({ error: "Missing storage target ID" }, { status: 400 });

  const existing = await prisma.backupStorageTarget.findFirst({
    where: {
      id,
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Storage target not found" }, { status: 404 });

  const activePolicyCount = await prisma.postgresBackupPolicy.count({
    where: { storageTargetId: id, enabled: true, userId: session.userId, tenantId: session.tenantId },
  });
  if (activePolicyCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${activePolicyCount} active backup policy/policies use this storage target` },
      { status: 409 }
    );
  }

  const totalPolicyCount = await prisma.postgresBackupPolicy.count({
    where: { storageTargetId: id, userId: session.userId, tenantId: session.tenantId },
  });
  const force = new URL(req.url).searchParams.get("force") === "true";
  if (totalPolicyCount > 0 && !force) {
    return NextResponse.json(
      { error: `Cannot delete: ${totalPolicyCount} disabled backup policy/policies still reference this storage target. Pass force=true after disabling or deleting them.` },
      { status: 409 }
    );
  }

  if (totalPolicyCount > 0) {
    await prisma.$transaction([
      prisma.postgresBackupPolicy.deleteMany({
        where: { storageTargetId: id, enabled: false, userId: session.userId, tenantId: session.tenantId },
      }),
      prisma.backupStorageTarget.delete({ where: { id } }),
    ]);
    return NextResponse.json({ success: true, deletedPolicies: totalPolicyCount });
  }

  await prisma.backupStorageTarget.delete({ where: { id } });
  return NextResponse.json({ success: true });
}, { minimumRole: "ADMIN" });
