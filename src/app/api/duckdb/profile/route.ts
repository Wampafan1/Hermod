/**
 * POST /api/duckdb/profile — Profile a dataset via DuckDB.
 *
 * Accepts either:
 *   A) Multipart form with `file` (auto-detects type from filename)
 *   B) JSON body with `{ rows }` (pre-parsed data, no UCC)
 *
 * Returns full column-level profiling + UCC primary key detection.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import { analyzeRows } from "@/lib/duckdb/file-analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const POST = withAuth(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";

  // ── Option A: Multipart file upload ─────────────────
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 100MB limit" },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Optional overrides from form data
    const sheetName = formData.get("sheetName") as string | null;
    const delimiter = formData.get("delimiter") as string | null;

    try {
      const result = await analyzeFile(buffer, file.name, {
        sheetName: sheetName || undefined,
        delimiter: delimiter || undefined,
      });

      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof FileAnalysisError) {
        const status = err.code === "FILE_TOO_LARGE" ? 413 : 422;
        return NextResponse.json({ error: err.message, code: err.code }, { status });
      }
      throw err;
    }
  }

  // ── Option B: JSON body with pre-parsed rows (no UCC) ──
  const body = await req.json();
  const { rows } = body as { rows?: Record<string, unknown>[] };

  if (!rows || !Array.isArray(rows)) {
    return NextResponse.json(
      { error: "Request must include 'rows' array or be a multipart file upload" },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({
      rowCount: 0,
      columns: [],
      profile: { tableName: "staging", rowCount: 0, columns: [] },
      previewRows: [],
    });
  }

  const analysis = await analyzeRows(rows);

  return NextResponse.json({
    rowCount: analysis.rowCount,
    columns: analysis.columns,
    profile: analysis.profile,
    previewRows: analysis.previewRows,
  });
});
