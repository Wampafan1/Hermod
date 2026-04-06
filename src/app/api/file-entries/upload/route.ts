/**
 * POST /api/file-entries/upload — Upload a file to a File Source connection.
 *
 * Parses the file via DuckDB (full-dataset profiling), detects schema,
 * checks against baseline. File bytes are NEVER retained — only metadata persists.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import { computeSchemaDiff } from "@/lib/duckdb/schema-diff";
import type { SavedColumn } from "@/lib/duckdb/schema-diff";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const FILE_TYPES = new Set(["CSV_FILE", "EXCEL_FILE"]);

export const POST = withAuth(async (req, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const connectionId = formData.get("connectionId") as string | null;
  const loadMode = (formData.get("loadMode") as string | null) ?? "APPEND";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 20MB." },
      { status: 413 }
    );
  }
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }
  if (loadMode !== "APPEND" && loadMode !== "REPLACE") {
    return NextResponse.json({ error: "loadMode must be APPEND or REPLACE" }, { status: 400 });
  }

  // Verify connection exists, belongs to tenant, is a file type
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, tenantId: ctx.tenantId },
    select: { id: true, type: true, config: true, routesAsSource: { select: { id: true }, take: 1 } },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (!FILE_TYPES.has(connection.type)) {
    return NextResponse.json(
      { error: `Connection type ${connection.type} does not support file uploads` },
      { status: 400 }
    );
  }

  // Parse file via unified DuckDB pipeline (full-dataset profiling + UCC)
  const buffer = Buffer.from(await file.arrayBuffer());
  let analysis;
  try {
    analysis = await analyzeFile(buffer, file.name, { skipUCC: true });
  } catch (err) {
    if (err instanceof FileAnalysisError) {
      const status = err.code === "FILE_TOO_LARGE" ? 413 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }

  // Check baseline schema (stored as DuckDB-compatible SavedColumn[])
  const config = connection.config as Record<string, unknown>;
  const baseline = config?.baselineSchema as SavedColumn[] | undefined;

  // Convert legacy DetectedSchema baseline if present
  const baselineColumns: SavedColumn[] | undefined = baseline
    ? Array.isArray(baseline) && baseline[0] && "duckdbType" in baseline[0]
      ? baseline // already in new format
      : (baseline as unknown as { columns?: Array<{ name: string; inferredType: string; nullable: boolean }> })?.columns?.map((c) => ({
          name: c.name,
          duckdbType: c.inferredType === "number" ? "DOUBLE" : c.inferredType === "date" ? "TIMESTAMP" : c.inferredType === "boolean" ? "BOOLEAN" : "VARCHAR",
          inferredType: c.inferredType,
          nullable: c.nullable,
        }))
    : undefined;

  let schemaDrift = null;
  let needsConfirmation = false;

  if (!baselineColumns) {
    // First upload — needs confirmation before locking schema
    needsConfirmation = true;
  } else {
    // Compare against baseline using unified schema diff
    const result = computeSchemaDiff(baselineColumns, analysis.columns);
    if (result.hasDrift) {
      schemaDrift = result.diff;
    }
  }

  // Build legacy-compatible detectedSchema for existing UI
  const detectedSchema = {
    columns: analysis.columns.map((c) => ({
      name: c.name,
      inferredType: c.inferredType as "string" | "number" | "date" | "boolean",
      nullable: c.nullable,
      sampleValues: c.sampleValues.slice(0, 3),
    })),
  };

  // Create FileEntry record
  const fileEntry = await prisma.fileEntry.create({
    data: {
      connectionId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || null,
      rowCount: analysis.rowCount,
      columnCount: analysis.columns.length,
      schema: JSON.parse(JSON.stringify(detectedSchema)),
      schemaDrift: schemaDrift ? JSON.parse(JSON.stringify(schemaDrift)) : undefined,
      status: schemaDrift ? "SCHEMA_DRIFT" : "PENDING",
      loadMode,
      uploadedBy: ctx.userId,
      tenantId: ctx.tenantId,
    },
  });

  // If first upload, return for confirmation
  if (needsConfirmation) {
    return NextResponse.json({
      fileEntry: {
        ...fileEntry,
        uploadedAt: fileEntry.uploadedAt.toISOString(),
        processedAt: null,
      },
      needsConfirmation: true,
      detectedSchema,
    });
  }

  // If schema drifted, return the diff
  if (schemaDrift) {
    return NextResponse.json({
      fileEntry: {
        ...fileEntry,
        uploadedAt: fileEntry.uploadedAt.toISOString(),
        processedAt: null,
      },
      needsConfirmation: false,
      schemaDrift,
      detectedSchema,
    });
  }

  // Schema matches baseline — mark as loaded
  // (executeFileRoute was a stub — route execution is handled by Bifrost/Gates, not here)
  await prisma.fileEntry.update({
    where: { id: fileEntry.id },
    data: {
      status: "LOADED",
      processedAt: new Date(),
    },
  });

  const final = await prisma.fileEntry.findUnique({ where: { id: fileEntry.id } });

  return NextResponse.json({
    fileEntry: final
      ? {
          ...final,
          uploadedAt: final.uploadedAt.toISOString(),
          processedAt: final.processedAt?.toISOString() ?? null,
        }
      : fileEntry,
    needsConfirmation: false,
  });
});
