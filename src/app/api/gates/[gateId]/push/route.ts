import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { saveTempFile } from "@/lib/gates/temp-files";
import {
  GATE_VALIDATE_PUSH_JOB,
  MAX_GATE_PUSH_FILE_SIZE,
  getGateUploadExtension,
  type GateValidatePushJob,
} from "@/lib/gates/push-validation";
import {
  buildGatePushValidationErrorDetails,
  updateGatePushValidationStage,
} from "@/lib/gates/validation-timeouts";
import { ensureBossStarted } from "@/lib/pg-boss";

// POST /api/gates/[gateId]/push - stage a push and enqueue async validation
export const POST = withAuth(async (req, ctx) => {
  const gateId = req.url.split("/gates/")[1]?.split("/")[0];
  if (!gateId) {
    return NextResponse.json({ error: "Missing gateId" }, { status: 400 });
  }

  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: ctx.tenantId },
    select: { id: true, status: true },
  });

  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }
  if (gate.status !== "ACTIVE") {
    return NextResponse.json({ error: "Gate is not active" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_GATE_PUSH_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum is ${MAX_GATE_PUSH_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  const extension = getGateUploadExtension(file.name);
  if (!extension) {
    return NextResponse.json(
      { error: "Unsupported file type. Accepted: .xlsx, .csv, .tsv" },
      { status: 400 }
    );
  }

  const now = new Date();
  const push = await prisma.gatePush.create({
    data: {
      gateId: gate.id,
      tenantId: ctx.tenantId,
      fileName: file.name,
      fileSize: file.size,
      fileMimeType: file.type || null,
      status: "VALIDATING",
      errorDetails: buildGatePushValidationErrorDetails({
        stage: "RECEIVED",
        now,
        startedAt: now,
      }),
    },
  });

  let tempFileId: string;
  try {
    await updateGatePushValidationStage({
      pushId: push.id,
      stage: "READING_FILE",
      startedAt: now,
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    tempFileId = await saveTempFile(buffer, extension);
    await prisma.gatePush.update({
      where: { id: push.id },
      data: {
        tempFileId,
        errorDetails: buildGatePushValidationErrorDetails({
          stage: "RECEIVED",
          startedAt: now,
        }),
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unable to stage upload file.";
    await prisma.gatePush.update({
      where: { id: push.id },
      data: {
        status: "FAILED",
        errorMessage,
        errorDetails: buildGatePushValidationErrorDetails({
          stage: "FAILED",
          startedAt: now,
          validationError: errorMessage,
        }),
        completedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        pushId: push.id,
        status: "FAILED",
        validationStage: "FAILED",
        errorMessage,
      },
      { status: 500 }
    );
  }

  try {
    const boss = await ensureBossStarted();
    const job: GateValidatePushJob = {
      pushId: push.id,
      gateId: gate.id,
      tenantId: ctx.tenantId,
      tempFileId,
    };
    await boss.send(GATE_VALIDATE_PUSH_JOB, job, {
      singletonKey: `gate-validate-${push.id}`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unable to enqueue gate validation.";
    await prisma.gatePush.update({
      where: { id: push.id },
      data: {
        status: "FAILED",
        errorMessage,
        errorDetails: buildGatePushValidationErrorDetails({
          stage: "FAILED",
          startedAt: now,
          validationError: errorMessage,
        }),
        completedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        pushId: push.id,
        status: "FAILED",
        validationStage: "FAILED",
        errorMessage,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    pushId: push.id,
    status: "VALIDATING",
    validationStage: "RECEIVED",
    fileName: file.name,
    fileSize: file.size,
  });
});
