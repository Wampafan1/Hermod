import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { canBeDestination } from "@/lib/providers/capabilities";
import { generateCreateTableSql } from "@/lib/gates/alter-generator";
import { getProvider } from "@/lib/providers";
import { decrypt } from "@/lib/crypto";
import type { ConnectionType } from "@/lib/providers/types";
import { readTempFile, deleteTempFile } from "@/lib/gates/temp-files";
import { executePush } from "@/lib/gates/push-executor";
import { analyzeCSV, analyzeExcel } from "@/lib/duckdb/file-analyzer";

// ─── GET /api/gates — list tenant gates ─────────────

export const GET = withAuth(async (_req, ctx) => {
  const gates = await prisma.realmGate.findMany({
    where: { tenantId: ctx.tenantId, status: { not: "ARCHIVED" } },
    include: {
      connection: { select: { id: true, name: true, type: true } },
    },
    orderBy: [
      { lastPushAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });

  return NextResponse.json(
    gates.map((g) => {
      const pkColumns: string[] = Array.isArray(g.primaryKeyColumns)
        ? (g.primaryKeyColumns as string[])
        : [];

      return {
        id: g.id,
        name: g.name,
        realmType: g.realmType,
        status: g.status,
        connectionId: g.connectionId,
        connectionName: g.connection.name,
        connectionType: g.connection.type,
        targetTable: g.targetTable,
        targetSchema: g.targetSchema,
        mergeStrategy: g.mergeStrategy,
        primaryKeyColumns: pkColumns,
        forgeEnabled: g.forgeEnabled,
        lastPushAt: g.lastPushAt?.toISOString() ?? null,
        pushCount: g.pushCount,
        createdAt: g.createdAt.toISOString(),
      };
    })
  );
});

// ─── POST /api/gates — create gate ──────────────────

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();

  const {
    name,
    tempFileId,
    realmType,
    connectionId,
    targetTable,
    targetSchema,
    primaryKeyColumns,
    primaryKeyColumn, // backward compat
    mergeStrategy,
    columnMapping,
    forgeEnabled,
    createTable,
    forgeBlueprintId,
  } = body as {
    name: string;
    tempFileId: string;
    realmType: string;
    connectionId: string;
    targetTable: string;
    targetSchema: string | null;
    createTable?: boolean;
    primaryKeyColumns?: string[];
    primaryKeyColumn?: string;
    mergeStrategy: string;
    columnMapping: Array<{
      sourceColumn: string;
      destinationColumn: string;
      sourceType: string;
      destType: string;
    }>;
    forgeEnabled: boolean;
    forgeBlueprintId: string | null;
  };

  // Resolve PK columns — prefer array, fall back to singular for backward compat
  const pkColumns: string[] = primaryKeyColumns ??
    (primaryKeyColumn ? [primaryKeyColumn] : []);

  // Validate required fields
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!tempFileId) {
    return NextResponse.json({ error: "tempFileId is required" }, { status: 400 });
  }
  if (!["VANAHEIM", "JOTUNHEIM"].includes(realmType)) {
    return NextResponse.json({ error: "Invalid realmType" }, { status: 400 });
  }
  if (!["UPSERT", "TRUNCATE_RELOAD", "APPEND"].includes(mergeStrategy)) {
    return NextResponse.json({ error: "Invalid mergeStrategy" }, { status: 400 });
  }
  if (!connectionId || !targetTable) {
    return NextResponse.json(
      { error: "connectionId and targetTable are required" },
      { status: 400 }
    );
  }
  if (mergeStrategy === "UPSERT" && pkColumns.length === 0) {
    return NextResponse.json(
      { error: "primaryKeyColumns are required for UPSERT strategy" },
      { status: 400 }
    );
  }
  if (!columnMapping || columnMapping.length === 0) {
    return NextResponse.json({ error: "columnMapping is required" }, { status: 400 });
  }

  // Verify connection belongs to tenant and is Asgard-capable
  const connection = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      OR: [
        { tenantId: ctx.tenantId },
        { userId: ctx.userId },
      ],
    },
  });

  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (!canBeDestination(connection.type as ConnectionType)) {
    return NextResponse.json(
      { error: `Connection type ${connection.type} cannot be a destination` },
      { status: 400 }
    );
  }

  // Read temp file and profile it to save the schema snapshot
  const tempFile = await readTempFile(tempFileId);
  if (!tempFile) {
    return NextResponse.json({ error: "Temp file not found or expired" }, { status: 410 });
  }

  const analysis =
    tempFile.extension === ".xlsx"
      ? await analyzeExcel(tempFile.buffer)
      : await analyzeCSV(tempFile.buffer, {
          delimiter: tempFile.extension === ".tsv" ? "\t" : undefined,
        });

  const savedSchema = analysis.columns.map((c) => ({
    name: c.name,
    duckdbType: c.duckdbType,
    inferredType: c.inferredType,
    nullable: c.nullable,
  }));

  // Create destination table if requested
  if (createTable) {
    const createTableColumns = savedSchema.map((c: { name: string; duckdbType: string; nullable: boolean }) => ({
      name: c.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      duckdbType: c.duckdbType,
      nullable: c.nullable,
    }));

    const createSql = generateCreateTableSql(
      connection.type,
      targetSchema || (connection.type === "MSSQL" ? "dbo" : "public"),
      targetTable,
      createTableColumns,
      pkColumns.length > 0
        ? pkColumns.map((pk: string) => pk.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
        : undefined
    );

    try {
      const provider = getProvider(connection.type);
      if (!provider.query) {
        return NextResponse.json({ error: "Connection does not support queries" }, { status: 400 });
      }
      const credentials = connection.credentials ? JSON.parse(decrypt(connection.credentials)) : {};
      const providerConn = await provider.connect({
        config: connection.config as Record<string, unknown>,
        credentials,
      });
      try {
        await provider.query(providerConn, createSql);
      } finally {
        await providerConn.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Failed to create table: ${msg}` }, { status: 500 });
    }
  }

  // Create the gate
  const gate = await prisma.realmGate.create({
    data: {
      tenantId: ctx.tenantId,
      name: name.trim(),
      realmType,
      connectionId,
      targetTable,
      targetSchema: targetSchema || null,
      primaryKeyColumns: pkColumns,
      mergeStrategy,
      columnMapping,
      savedSchema,
      forgeEnabled: forgeEnabled ?? false,
      forgeBlueprintId: forgeEnabled ? forgeBlueprintId : null,
    },
    include: {
      connection: { select: { id: true, name: true, type: true } },
    },
  });

  // Execute the initial push with the original file
  let initialPush = null;
  try {
    // Create a GatePush record for the initial load
    const push = await prisma.gatePush.create({
      data: {
        gateId: gate.id,
        tenantId: ctx.tenantId,
        fileName: name.trim(),
        fileSize: tempFile.buffer.length,
        fileMimeType: tempFile.extension === ".xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
        status: "PUSHING",
      },
    });

    const pushResult = await executePush(
      gate.id,
      push.id,
      tempFile.buffer,
      tempFile.extension
    );

    initialPush = {
      pushId: push.id,
      status: "SUCCESS",
      ...pushResult,
    };
  } catch (err) {
    console.error("[Gate] Initial push failed:", err instanceof Error ? err.message : err);
    initialPush = {
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Clean up temp file
  await deleteTempFile(tempFileId);

  return NextResponse.json({ ...gate, initialPush }, { status: 201 });
});
