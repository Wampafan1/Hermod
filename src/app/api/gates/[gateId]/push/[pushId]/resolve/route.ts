import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { readTempFile, deleteTempFile } from "@/lib/gates/temp-files";
import { executePush } from "@/lib/gates/push-executor";
import { analyzeCSV, analyzeExcel } from "@/lib/duckdb/file-analyzer";

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
        config: conn.config as Record<string, unknown>,
        credentials,
      });

      try {
        for (const stmt of confirmedStatements) {
          // Skip comments
          if (stmt.trim().startsWith("--")) continue;
          await provider.query(providerConn, stmt);
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

        // Update saved schema to match the new file
        const newSavedSchema = analysis.columns.map((c) => ({
          name: c.name,
          duckdbType: c.duckdbType,
          inferredType: c.inferredType,
          nullable: c.nullable,
        }));

        // Update column mapping for any newly added columns
        const existingMapping = gate.columnMapping as Array<{
          sourceColumn: string;
          destinationColumn: string;
          sourceType: string;
          destType: string;
        }>;

        const existingSourceCols = new Set(
          existingMapping.map((m) => m.sourceColumn.toLowerCase())
        );

        const newMappings = [...existingMapping];
        for (const col of analysis.columns) {
          if (!existingSourceCols.has(col.name.toLowerCase())) {
            // New column — map to same name
            newMappings.push({
              sourceColumn: col.name,
              destinationColumn: col.name,
              sourceType: col.duckdbType,
              destType: col.duckdbType,
            });
          }
        }

        await prisma.realmGate.update({
          where: { id: gateId },
          data: {
            savedSchema: newSavedSchema,
            columnMapping: newMappings,
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
