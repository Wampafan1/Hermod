import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { withAuth } from "@/lib/api";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const POST = withAuth(async (req, session) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 100MB limit" },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["csv", "tsv", "txt"].includes(ext)) {
    return NextResponse.json(
      { error: "Only .csv, .tsv, and .txt files are accepted" },
      { status: 400 }
    );
  }

  // Ensure uploads directory exists
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Save to uploads directory — fileId is the only reference returned to client
  const fileId = randomUUID();
  const filename = `${session.user.id}_${fileId}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Unified analysis: profiling + UCC discovery in one pass
  const delimiter = formData.get("delimiter") as string | null;
  const hasHeaders = formData.get("hasHeaders");

  try {
    const result = await analyzeFile(buffer, file.name, {
      delimiter: delimiter || undefined,
      hasHeaders: hasHeaders !== null ? hasHeaders === "true" : undefined,
    });

    return NextResponse.json({
      fileId,
      filePath,
      originalFilename: file.name,
      fileSize: file.size,
      ...result,
      // Backward compat fields
      sampleRows: result.previewRows,
      delimiter: delimiter || ",",
      hasHeaders: hasHeaders !== null ? hasHeaders === "true" : true,
      encoding: "utf-8",
    });
  } catch (err) {
    if (err instanceof FileAnalysisError) {
      const status = err.code === "FILE_TOO_LARGE" ? 413 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
});
