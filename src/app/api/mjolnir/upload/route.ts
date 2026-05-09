import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requireTierFeature } from "@/lib/tier-gate";
import { parseExcelBuffer } from "@/lib/mjolnir/file-parser";
import { cleanupExpiredMjolnirTempFiles, getMjolnirUserTempDir } from "@/lib/mjolnir/cleanup";
import { validateParsedFileAnalysisLimits } from "@/lib/validations/mjolnir";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export const POST = withAuth(async (req, session) => {
  const denied = await requireTierFeature(session.tenantId, "mjolnirAiForge", "Mjölnir AI Forge");
  if (denied) return denied;

  void cleanupExpiredMjolnirTempFiles({ maxEntries: 100 }).catch(() => {});

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { error: "Only .xlsx files are supported" },
      { status: 400 }
    );
  }

  // Pre-check file size before reading into memory (50 MB limit)
  const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: `File exceeds maximum size of ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB` },
      { status: 413 }
    );
  }

  const fileId = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());

  // Save to temp directory
  const userDir = getMjolnirUserTempDir(session.user.id);
  await mkdir(userDir, { recursive: true });
  await writeFile(join(userDir, `${fileId}.xlsx`), buffer);

  // Parse the file
  let parsed;
  try {
    parsed = await parseExcelBuffer(buffer, file.name, fileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse uploaded file";
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const limits = validateParsedFileAnalysisLimits({
    columns: parsed.columns,
    rowCount: parsed.rowCount,
    label: "Uploaded workbook",
  });
  if (!limits.ok) {
    return NextResponse.json({ error: limits.error }, { status: 400 });
  }

  return NextResponse.json({
    fileId: parsed.fileId,
    filename: parsed.filename,
    columns: parsed.columns,
    rowCount: parsed.rowCount,
    sampleRows: parsed.sampleRows,
  });
});
