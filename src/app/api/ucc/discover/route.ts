/**
 * POST /api/ucc/discover — Run UCC discovery on provided data.
 *
 * Accepts:
 *   A) Multipart form with file + type
 *   B) JSON with { rows: [...] } — for SQL results or testing
 *   C) JSON with { filePath, fileType, delimiter? } — reads full file from uploads/
 *
 * Returns UCCResult with all discovered minimal unique column combinations.
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { withAuth } from "@/lib/api";
import { createAnalyticsSession } from "@/lib/duckdb/engine";
import { discoverUCCs } from "@/lib/ucc/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const UPLOADS_DIR = resolve(process.cwd(), "uploads");

export const POST = withAuth(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";

  const session = await createAnalyticsSession();
  try {
    // ── Option A: Multipart file upload ─────────────
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const fileType = (formData.get("type") as string | null) ?? "csv";

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: "File exceeds 100MB limit" }, { status: 413 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (fileType === "excel") {
        const sheetName = formData.get("sheetName") as string | null;
        await session.loadExcel(buffer, "staging", {
          sheetName: sheetName || undefined,
        });
      } else {
        const delimiter = formData.get("delimiter") as string | null;
        await session.loadCSV(buffer, "staging", {
          delimiter: delimiter || undefined,
        });
      }
    }
    // ── Option B/C: JSON body ─────────────────────────
    else {
      const body = await req.json();

      // Option C: Server-side file path (full dataset from prior detection step)
      if (body.filePath && typeof body.filePath === "string") {
        const resolvedPath = resolve(body.filePath);

        // Security: file must be inside uploads/ directory (prevent path traversal)
        if (!resolvedPath.startsWith(UPLOADS_DIR)) {
          return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
        }

        const buffer = await readFile(resolvedPath);
        const fileType = (body.fileType as string) ?? "csv";

        if (fileType === "excel") {
          await session.loadExcel(buffer, "staging", {
            sheetName: body.sheetName || undefined,
          });
        } else {
          await session.loadCSV(buffer, "staging", {
            delimiter: body.delimiter || undefined,
          });
        }
      }
      // Option B: Pre-parsed rows (for SQL results, Sheets, testing)
      else {
        const { rows } = body as { rows?: Record<string, unknown>[] };

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          return NextResponse.json(
            { error: "Request must include 'filePath', 'rows' array, or be a multipart file upload" },
            { status: 400 }
          );
        }

        await session.loadRows(rows, "staging");
      }
    }

    // Profile the loaded data
    const profile = await session.profileTable("staging");

    // Run UCC discovery (includes AI pruning + lattice search)
    const result = await discoverUCCs(session, "staging", profile);

    return NextResponse.json(result);
  } finally {
    await session.close();
  }
});
