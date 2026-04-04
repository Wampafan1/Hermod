/**
 * POST /api/duckdb/profile — Profile a dataset via DuckDB.
 *
 * Accepts either:
 *   A) Multipart form with `file` + `type` ("csv" | "excel")
 *   B) JSON body with `{ rows, columns }`
 *
 * Returns full column-level profiling: cardinality, nulls, min/max,
 * sample values — computed against the FULL dataset, not a sample.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeCSV, analyzeExcel, analyzeRows } from "@/lib/duckdb/file-analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const POST = withAuth(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";

  // ── Option A: Multipart file upload ─────────────────
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const fileType = (formData.get("type") as string | null) ?? "csv";

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
    let analysis;

    if (fileType === "excel") {
      const sheetName = formData.get("sheetName") as string | null;
      analysis = await analyzeExcel(buffer, {
        sheetName: sheetName || undefined,
      });
    } else {
      const delimiter = formData.get("delimiter") as string | null;
      analysis = await analyzeCSV(buffer, {
        delimiter: delimiter || undefined,
      });
    }

    return NextResponse.json({
      rowCount: analysis.rowCount,
      columns: analysis.columns,
      profile: analysis.profile,
      previewRows: analysis.previewRows,
    });
  }

  // ── Option B: JSON body with pre-parsed rows ────────
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
