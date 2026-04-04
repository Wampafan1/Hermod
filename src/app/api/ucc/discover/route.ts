/**
 * POST /api/ucc/discover — Run UCC discovery on provided data.
 *
 * Accepts JSON body with rows, or multipart form with file.
 * Returns UCCResult with all discovered minimal unique column combinations.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { createAnalyticsSession } from "@/lib/duckdb/engine";
import { discoverUCCs } from "@/lib/ucc/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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
    // ── Option B: JSON body with rows ─────────────────
    else {
      const body = await req.json();
      const { rows } = body as { rows?: Record<string, unknown>[] };

      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json(
          { error: "Request must include non-empty 'rows' array or be a multipart file upload" },
          { status: 400 }
        );
      }

      await session.loadRows(rows, "staging");
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
