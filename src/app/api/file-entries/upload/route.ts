/**
 * POST /api/file-entries/upload — Upload a file to a File Source connection.
 *
 * Parses the file in memory, detects schema, checks against baseline.
 * File bytes are NEVER retained — only the FileEntry metadata persists.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseFile, compareSchemas, executeFileRoute } from "@/lib/file-processor";
import type { DetectedSchema } from "@/lib/file-processor";

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

  // Parse file in memory
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseFile(buffer, file.name, file.type);

  // Check baseline schema
  const config = connection.config as Record<string, unknown>;
  const baseline = config?.baselineSchema as DetectedSchema | undefined;

  let schemaDrift = null;
  let needsConfirmation = false;

  if (!baseline) {
    // First upload — needs confirmation before locking schema
    needsConfirmation = true;
  } else {
    // Compare against baseline
    schemaDrift = compareSchemas(baseline, parsed.detectedSchema);
  }

  // Create FileEntry record
  const fileEntry = await prisma.fileEntry.create({
    data: {
      connectionId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || null,
      rowCount: parsed.rowCount,
      columnCount: parsed.columns.length,
      schema: JSON.parse(JSON.stringify(parsed.detectedSchema)),
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
      detectedSchema: parsed.detectedSchema,
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
      detectedSchema: parsed.detectedSchema,
    });
  }

  // Schema matches baseline — process immediately
  const startTime = Date.now();
  try {
    await prisma.fileEntry.update({
      where: { id: fileEntry.id },
      data: { status: "PROCESSING" },
    });

    // Check if there's a Bifrost route for this connection
    const route = connection.routesAsSource[0];
    if (route) {
      const result = await executeFileRoute({
        connectionId,
        routeId: route.id,
        rows: parsed.rows,
        columns: parsed.columns,
        fileEntryId: fileEntry.id,
        tenantId: ctx.tenantId,
      });

      if (result.success) {
        await prisma.fileEntry.update({
          where: { id: fileEntry.id },
          data: {
            status: "LOADED",
            rowCount: result.rowsLoaded,
            processedAt: new Date(),
          },
        });
      } else {
        await prisma.fileEntry.update({
          where: { id: fileEntry.id },
          data: {
            status: "FAILED",
            error: result.error ?? "Unknown error",
            processedAt: new Date(),
          },
        });
      }
    } else {
      // No route — just mark as loaded
      await prisma.fileEntry.update({
        where: { id: fileEntry.id },
        data: {
          status: "LOADED",
          processedAt: new Date(),
        },
      });
    }
  } catch (err) {
    await prisma.fileEntry.update({
      where: { id: fileEntry.id },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Processing failed",
        processedAt: new Date(),
      },
    });
  }

  // Reload to get final state
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
    durationMs: Date.now() - startTime,
  });
});
