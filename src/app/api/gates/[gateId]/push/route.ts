import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import { computeSchemaDiff, type SavedColumn } from "@/lib/gates/schema-diff";
import { generateAlterStatements } from "@/lib/gates/alter-generator";
import { saveTempFile } from "@/lib/gates/temp-files";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function getExtension(fileName: string): string | null {
  const ext = fileName.match(/\.(csv|tsv|xlsx)$/i)?.[1]?.toLowerCase();
  return ext ? `.${ext}` : null;
}

// ─── POST /api/gates/[gateId]/push — validate & stage a push ──

export const POST = withAuth(async (req, ctx) => {
  const gateId = req.url.split("/gates/")[1]?.split("/")[0];
  if (!gateId) {
    return NextResponse.json({ error: "Missing gateId" }, { status: 400 });
  }

  // Load gate
  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: ctx.tenantId },
    include: { connection: { select: { name: true, type: true } } },
  });

  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }
  if (gate.status !== "ACTIVE") {
    return NextResponse.json({ error: "Gate is not active" }, { status: 400 });
  }

  // Parse file
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 }
    );
  }

  const extension = getExtension(file.name);
  if (!extension) {
    return NextResponse.json(
      { error: "Unsupported file type. Accepted: .xlsx, .csv, .tsv" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Profile with unified DuckDB pipeline (skip UCC — this is a repeat push, PK already known)
  let analysis;
  try {
    analysis = await analyzeFile(buffer, file.name, { skipUCC: true });
  } catch (err) {
    if (err instanceof FileAnalysisError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    throw err;
  }

  // Schema validation
  const savedColumns = gate.savedSchema as SavedColumn[];
  const { hasDrift, diff } = computeSchemaDiff(savedColumns, analysis.columns);

  // Save temp file (needed for both validation confirmation and drift resolution)
  const tempFileId = await saveTempFile(buffer, extension);

  if (hasDrift) {
    // Create push record with SCHEMA_DRIFT status
    const push = await prisma.gatePush.create({
      data: {
        gateId: gate.id,
        tenantId: ctx.tenantId,
        fileName: file.name,
        fileSize: file.size,
        fileMimeType: file.type || null,
        status: "SCHEMA_DRIFT",
        rowCount: analysis.rowCount,
        schemaDiff: diff,
        tempFileId,
      },
    });

    // Generate resolution options
    const alterStatements = generateAlterStatements(
      gate.connection.type,
      gate.targetSchema || "public",
      gate.targetTable,
      diff
    );

    // Build "adjust file" actions
    const adjustFileActions: string[] = [];
    for (const col of diff.added) {
      adjustFileActions.push(`Remove column: ${col.name} (not in destination)`);
    }
    for (const col of diff.removed) {
      adjustFileActions.push(`Add column: ${col.name} (expected by destination, will be NULL)`);
    }
    for (const col of diff.typeChanged) {
      adjustFileActions.push(`Cast column: ${col.name} from ${col.newType} to ${col.oldType}`);
    }

    return NextResponse.json({
      pushId: push.id,
      status: "SCHEMA_DRIFT",
      rowCount: analysis.rowCount,
      schemaDiff: diff,
      resolutionOptions: {
        adjustFile: {
          description: "Modify your file to match the existing destination",
          actions: adjustFileActions,
        },
        adjustDestination: {
          description: "Modify the destination table to accept the new schema",
          databaseType: gate.connection.type === "MSSQL" ? "SQLSERVER" : gate.connection.type === "POSTGRES" ? "POSTGRESQL" : gate.connection.type,
          statements: alterStatements,
          warning: "These statements will modify your production table. Review carefully.",
        },
      },
    });
  }

  // No drift — create VALIDATED push (awaiting user confirmation to execute)
  const push = await prisma.gatePush.create({
    data: {
      gateId: gate.id,
      tenantId: ctx.tenantId,
      fileName: file.name,
      fileSize: file.size,
      fileMimeType: file.type || null,
      status: "VALIDATED",
      rowCount: analysis.rowCount,
      tempFileId,
    },
  });

  return NextResponse.json({
    pushId: push.id,
    status: "VALIDATED",
    rowCount: analysis.rowCount,
    fileName: file.name,
    fileSize: file.size,
  });
});
