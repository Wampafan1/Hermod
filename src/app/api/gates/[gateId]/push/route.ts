import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import { computeSchemaDiff, type SavedColumn, type SchemaDiff } from "@/lib/gates/schema-diff";
import {
  generateAlterStatements,
  mapSchemaDiffToDestination,
  type GateColumnMapping,
} from "@/lib/gates/alter-generator";
import { saveTempFile } from "@/lib/gates/temp-files";
import { preflightGatePushKeyDrift, type ColumnMap } from "@/lib/gates/push-executor";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function getExtension(fileName: string): string | null {
  const ext = fileName.match(/\.(csv|tsv|xlsx)$/i)?.[1]?.toLowerCase();
  return ext ? `.${ext}` : null;
}

type AnalysisColumn = {
  name: string;
  duckdbType: string;
  inferredType: string;
  nullable: boolean;
};

function hasSchemaChanges(diff: SchemaDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.typeChanged.length > 0;
}

function removeKnownMappedAddedColumns(
  diff: SchemaDiff,
  columnMapping: GateColumnMapping[]
): SchemaDiff {
  const mappedSourceColumns = new Set(
    columnMapping.map((mapping) => mapping.sourceColumn.toLowerCase())
  );

  return {
    ...diff,
    added: diff.added.filter((column) => !mappedSourceColumns.has(column.name.toLowerCase())),
  };
}

function toSavedSchema(columns: AnalysisColumn[]) {
  return columns.map((column) => ({
    name: column.name,
    duckdbType: column.duckdbType,
    inferredType: column.inferredType,
    nullable: column.nullable,
  }));
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
  const savedColumns = gate.savedSchema as unknown as SavedColumn[];
  const { hasDrift, diff: rawDiff } = computeSchemaDiff(savedColumns, analysis.columns);
  const columnMapping = gate.columnMapping as unknown as GateColumnMapping[];
  const diff = removeKnownMappedAddedColumns(rawDiff, columnMapping);
  const hasActionableDrift = hasSchemaChanges(diff);

  // Save temp file (needed for both validation confirmation and drift resolution)
  const tempFileId = await saveTempFile(buffer, extension);

  if (hasActionableDrift) {
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
        schemaDiff: diff as unknown as Prisma.InputJsonValue,
        tempFileId,
      },
    });

    // Generate resolution options
    const destinationDiff = mapSchemaDiffToDestination(
      diff,
      columnMapping
    );
    const alterStatements = generateAlterStatements(
      gate.connection.type,
      gate.targetSchema || "public",
      gate.targetTable,
      destinationDiff,
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

  if (hasDrift) {
    await prisma.realmGate.update({
      where: { id: gate.id },
      data: {
        savedSchema: toSavedSchema(analysis.columns) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // No drift — create VALIDATED push (awaiting user confirmation to execute)
  const primaryKeyColumns: string[] = Array.isArray(gate.primaryKeyColumns)
    ? (gate.primaryKeyColumns as string[])
    : [];
  const keyPreflight = await preflightGatePushKeyDrift({
    fileBuffer: buffer,
    fileExtension: extension,
    columnMapping: columnMapping as unknown as ColumnMap[],
    primaryKeyColumns,
    mergeStrategy: gate.mergeStrategy,
  });

  if (keyPreflight.keyDrift) {
    const push = await prisma.gatePush.create({
      data: {
        gateId: gate.id,
        tenantId: ctx.tenantId,
        fileName: file.name,
        fileSize: file.size,
        fileMimeType: file.type || null,
        status: "KEY_DRIFT",
        rowCount: keyPreflight.rowCount,
        blankRowsSkipped: keyPreflight.blankRowsSkipped,
        keyDrift: keyPreflight.keyDrift as unknown as Prisma.InputJsonValue,
        tempFileId,
      },
    });

    return NextResponse.json({
      pushId: push.id,
      status: "KEY_DRIFT",
      rowCount: keyPreflight.rowCount,
      blankRowsSkipped: keyPreflight.blankRowsSkipped,
      keyDrift: keyPreflight.keyDrift,
      fileName: file.name,
      fileSize: file.size,
    });
  }

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
