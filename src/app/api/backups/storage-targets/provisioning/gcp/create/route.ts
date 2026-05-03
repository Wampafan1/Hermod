import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { gcpProvisioningRequestSchema } from "@/lib/validations/backup-storage";
import { createGcpBackupTarget } from "@/lib/backups/provisioning/gcp-provisioner";
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

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = gcpProvisioningRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const provisioned = await createGcpBackupTarget(parsed.data);
  if (!parsed.data.createTarget) {
    return NextResponse.json(provisioned);
  }

  const target = await prisma.backupStorageTarget.create({
    data: {
      name: parsed.data.name ?? `GCS ${parsed.data.bucket}`,
      provider: provisioned.provider,
      accessMode: provisioned.accessMode,
      config: provisioned.config as Prisma.InputJsonValue,
      credentials: null,
      status: "ACTIVE",
      userId: session.userId,
      tenantId: session.tenantId,
    },
    select: storageTargetSelect,
  });

  return NextResponse.json(serializeStorageTarget(target), { status: 201 });
}, { minimumRole: "ADMIN" });
