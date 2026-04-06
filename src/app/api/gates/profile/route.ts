import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import { saveTempFile, cleanupOldTempFiles } from "@/lib/gates/temp-files";
import { findDestinationMatches, listDestinationConnections } from "@/lib/gates/destination-matcher";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function getExtension(fileName: string, mimeType: string): string | null {
  const ext = fileName.match(/\.(csv|tsv|xlsx)$/i)?.[1]?.toLowerCase();
  if (ext) return `.${ext}`;
  const map: Record<string, string> = {
    "text/csv": ".csv",
    "text/tab-separated-values": ".tsv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };
  return map[mimeType] ?? null;
}

// ─── POST /api/gates/profile ────────────────────────

export const POST = withAuth(async (req, ctx) => {
  // Trigger cleanup in background (best-effort)
  cleanupOldTempFiles().catch(() => {});

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  const extension = getExtension(file.name, file.type);
  if (!extension) {
    return NextResponse.json(
      { error: "Unsupported file type. Accepted: .xlsx, .csv, .tsv" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Unified pipeline: profiling + UCC in one pass
  try {
    const analysis = await analyzeFile(buffer, file.name);

    // Save temp file for later use during gate creation
    const tempFileId = await saveTempFile(buffer, extension);

    // Auto-match against destination tables + list all connections
    const [destinationMatches, allConnections] = await Promise.all([
      findDestinationMatches(ctx.tenantId, analysis.columns, 5),
      listDestinationConnections(ctx.tenantId),
    ]);

    return NextResponse.json({
      ...analysis,
      // Gate-specific additions
      realmType: extension === ".xlsx" ? "VANAHEIM" : "JOTUNHEIM",
      tempFileId,
      destinationMatches,
      allConnections,
    });
  } catch (err) {
    if (err instanceof FileAnalysisError) {
      const status = err.code === "FILE_TOO_LARGE" ? 413 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
});
