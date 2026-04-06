import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { parseExcelBuffer } from "@/lib/mjolnir/file-parser";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const POST = withAuth(async (req, session) => {
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
  const userDir = join(tmpdir(), "hermod-mjolnir", session.user.id);
  await mkdir(userDir, { recursive: true });
  await writeFile(join(userDir, `${fileId}.xlsx`), buffer);

  // Parse the file
  const parsed = await parseExcelBuffer(buffer, file.name, fileId);

  return NextResponse.json({
    fileId: parsed.fileId,
    filename: parsed.filename,
    columns: parsed.columns,
    rowCount: parsed.rowCount,
    sampleRows: parsed.sampleRows,
  });
});
