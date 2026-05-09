import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { readTempFile, deleteTempFile } from "@/lib/gates/temp-files";
import { executePush } from "@/lib/gates/push-executor";
import { analyzeCSV, analyzeExcel } from "@/lib/duckdb/file-analyzer";
import {
  generateAlterStatements,
  mapSchemaDiffToDestination,
  type GateColumnMapping,
} from "@/lib/gates/alter-generator";
import type { SchemaDiff } from "@/lib/gates/schema-diff";

// ─── POST /api/gates/[gateId]/push/[pushId]/resolve ──

export const POST = withAuth(async (req, ctx) => {
  const parts = req.url.split("/gates/")[1]?.split("/") ?? [];
  const gateId = parts[0];
  const pushId = parts[2]; // push/[pushId]/resolve

  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });
  if (!push) {
    return NextResponse.json({ error: "Push not found" }, { status: 404 });
  }
  if (push.status !== "SCHEMA_DRIFT") {
    return NextResponse.json(
      { error: `Push is not in SCHEMA_DRIFT status (current: ${push.status})` },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { resolution, executeStatements, confirmedStatements } = body as {
    resolution: "ADJUST_DESTINATION" | "ADJUST_FILE";
    executeStatements?: boolean;
    confirmedStatements?: string[];
  };

  if (resolution === "ADJUST_FILE") {
    // User will fix their file and re-upload
    await prisma.gatePush.update({
      where: { id: pushId },
      data: {
        status: "CANCELLED",
        driftResolution: "ADJUSTED_FILE",
        completedAt: new Date(),
      },
    });

    // Clean up temp file
    if (push.tempFileId) await deleteTempFile(push.tempFileId);

    return NextResponse.json({ status: "CANCELLED", resolution: "ADJUSTED_FILE" });
  }

  if (resolution === "ADJUST_DESTINATION") {
    // Load gate with connection
    const gate = await prisma.realmGate.findFirst({
      where: { id: gateId, tenantId: ctx.tenantId },
      include: { connection: true },
    });
    if (!gate) {
      return NextResponse.json({ error: "Gate not found" }, { status: 404 });
    }

    const existingMapping = gate.columnMapping as unknown as GateColumnMapping[];
    const sourceDiff = (push.schemaDiff ?? {
      added: [],
      removed: [],
      typeChanged: [],
    }) as unknown as SchemaDiff;
    const destinationDiff = mapSchemaDiffToDestination(sourceDiff, existingMapping);
    const generatedStatements = generateAlterStatements(
      gate.connection.type,
      gate.targetSchema || "public",
      gate.targetTable,
      destinationDiff,
      sourceDiff
    );
    const generatedExecutableSql = new Set(
      generatedStatements.filter((stmt) => !stmt.isComment).map((stmt) => stmt.sql)
    );
    const confirmedSql = new Set(confirmedStatements ?? []);
    const unknownStatements = [...confirmedSql].filter((sql) => !generatedExecutableSql.has(sql));

    if (unknownStatements.length > 0) {
      return NextResponse.json(
        { error: "One or more confirmed schema changes no longer match the expected drift plan" },
        { status: 400 }
      );
    }

    const confirmedAddedColumns = new Map(
      generatedStatements
        .filter(
          (stmt) =>
            !stmt.isComment &&
            stmt.sourceColumn &&
            stmt.destinationColumn &&
            confirmedSql.has(stmt.sql)
        )
        .map((stmt) => [
          stmt.sourceColumn!.toLowerCase(),
          {
            sourceColumn: stmt.sourceColumn!,
            destinationColumn: stmt.destinationColumn!,
          },
        ])
    );

    // Execute ALTER statements if requested
    if (executeStatements && confirmedStatements && confirmedStatements.length > 0) {
      const conn = gate.connection;
      const provider = getProvider(conn.type);
      if (!provider.query) {
        return NextResponse.json(
          { error: "Provider does not support query execution" },
          { status: 400 }
        );
      }

      const credentials = conn.credentials ? JSON.parse(decrypt(conn.credentials)) : {};
      const providerConn = await provider.connect({
        type: conn.type,
        config: conn.config as Record<string, unknown>,
        credentials,
      });

      try {
        for (const stmt of generatedStatements) {
          if (stmt.isComment || !confirmedSql.has(stmt.sql)) continue;
          await provider.query(providerConn, stmt.sql);
        }
      } finally {
        await providerConn.close();
      }
    }

    // Re-profile the temp file and update the gate's savedSchema
    if (push.tempFileId) {
      const tempFile = await readTempFile(push.tempFileId);
      if (tempFile) {
        const analysis =
          tempFile.extension === ".xlsx"
            ? await analyzeExcel(tempFile.buffer)
            : await analyzeCSV(tempFile.buffer, {
                delimiter: tempFile.extension === ".tsv" ? "\t" : undefined,
              });

        const existingSourceCols = new Set(
          existingMapping.map((m) => m.sourceColumn.toLowerCase())
        );
        const acceptedColumns = analysis.columns.filter((c) =>
          existingSourceCols.has(c.name.toLowerCase()) ||
          confirmedAddedColumns.has(c.name.toLowerCase())
        );

        // Update saved schema to match the accepted destination shape.
        const newSavedSchema = acceptedColumns.map((c) => ({
          name: c.name,
          duckdbType: c.duckdbType,
          inferredType: c.inferredType,
          nullable: c.nullable,
        }));

        // Update column mapping for any newly accepted columns.
        const newMappings = [...existingMapping];
        for (const col of analysis.columns) {
          const confirmedAdded = confirmedAddedColumns.get(col.name.toLowerCase());
          if (!existingSourceCols.has(col.name.toLowerCase()) && confirmedAdded) {
            // New column: map to the same destination name used by the ALTER SQL.
            newMappings.push({
              sourceColumn: col.name,
              destinationColumn: confirmedAdded.destinationColumn,
              sourceType: col.duckdbType,
              destType: col.duckdbType,
            });
          }
        }

        await prisma.realmGate.update({
          where: { id: gateId },
          data: {
            savedSchema: newSavedSchema,
            columnMapping: newMappings as unknown as Prisma.InputJsonValue,
          },
        });

        // Now mark as VALIDATED and execute
        await prisma.gatePush.update({
          where: { id: pushId },
          data: {
            status: "VALIDATED",
            driftResolution: "ADJUSTED_DESTINATION",
          },
        });

        // Execute the push
        try {
          const result = await executePush(gateId, pushId, tempFile.buffer, tempFile.extension);
          await deleteTempFile(push.tempFileId);

          return NextResponse.json({
            pushId: push.id,
            status: "SUCCESS",
            resolution: "ADJUSTED_DESTINATION",
            rowCount: result.rowCount,
            rowsInserted: result.rowsInserted,
            rowsUpdated: result.rowsUpdated,
            rowsErrored: result.rowsErrored,
            duration: result.duration,
          });
        } catch (err) {
          return NextResponse.json(
            {
              pushId: push.id,
              status: "FAILED",
              error: err instanceof Error ? err.message : "Push failed after destination adjustment",
            },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json(
      { error: "Temp file expired — please re-upload the file" },
      { status: 410 }
    );
  }

  return NextResponse.json({ error: "Invalid resolution type" }, { status: 400 });
});
