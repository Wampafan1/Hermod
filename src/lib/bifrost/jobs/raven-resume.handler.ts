/**
 * pg-boss handler: resume-raven-route
 *
 * Picks up where the Bifrost engine left off after a Data Agent (Raven) completes
 * its extraction. The agent has already uploaded data as RavenIngestChunks — this
 * handler assembles the rows and runs the Transform + Load phases of the pipeline.
 */

import { prisma } from "@/lib/db";
import { BifrostEngine, loadRouteWithRelations } from "../engine";
import { getProvider, toConnectionLike } from "@/lib/providers";
import { executeBlueprint } from "@/lib/mjolnir/engine/blueprint-executor";
import { validateBlueprintForStreaming } from "../forge/forge-validator";
import { enqueueDeadLetter } from "../helheim/dead-letter";
import { inferSchemaFromRows, normalizeRowDates, getDateColumns } from "../engine";
import type { DestConfig } from "../types";
import { DEFAULT_CHUNK_SIZE } from "../types";

interface RavenResumePayload {
  routeId: string;
  routeLogId: string;
  ravenJobId: string;
}

export async function handleRavenResume(job: {
  data: RavenResumePayload;
}): Promise<void> {
  const { routeId, routeLogId, ravenJobId } = job.data;
  const startTime = Date.now();

  console.log(
    `[Bifrost/Raven] Resuming pipeline: route=${routeId} ravenJob=${ravenJobId}`
  );

  try {
    // 1. Load route and verify state
    const route = await loadRouteWithRelations(routeId);

    const ravenJob = await prisma.ravenJob.findUniqueOrThrow({
      where: { id: ravenJobId },
      select: { id: true, status: true },
    });

    if (ravenJob.status !== "success") {
      throw new Error(
        `RavenJob ${ravenJobId} is in "${ravenJob.status}" state — expected "success"`
      );
    }

    // 2. Assemble rows from ingest chunks
    const chunks = await prisma.ravenIngestChunk.findMany({
      where: { jobId: ravenJobId },
      orderBy: { chunkIndex: "asc" },
      select: { data: true },
    });

    if (chunks.length === 0) {
      console.warn(`[Bifrost/Raven] No chunks found for job ${ravenJobId} — nothing to process`);
      await prisma.routeLog.update({
        where: { id: routeLogId },
        data: {
          status: "completed",
          rowsExtracted: 0,
          rowsLoaded: 0,
          duration: Date.now() - startTime,
          completedAt: new Date(),
        },
      });
      return;
    }

    // Each chunk's data field is a JSON array of row objects
    const allRows: Record<string, unknown>[] = [];
    for (const chunk of chunks) {
      const chunkData = chunk.data as unknown;
      if (Array.isArray(chunkData)) {
        allRows.push(...(chunkData as Record<string, unknown>[]));
      }
    }

    const totalExtracted = allRows.length;
    console.log(
      `[Bifrost/Raven] Assembled ${totalExtracted} rows from ${chunks.length} chunks`
    );

    // 3. Clean up chunks now that we've read them
    await prisma.ravenIngestChunk.deleteMany({ where: { jobId: ravenJobId } });

    // 4. Optional Transform (Nidavellir forge)
    let rows = allRows;
    if (route.transformEnabled && route.blueprintId) {
      const blueprint = await prisma.blueprint.findUniqueOrThrow({
        where: { id: route.blueprintId },
        select: { steps: true },
      });
      const steps = blueprint.steps as Array<{
        type: string;
        order: number;
        config: Record<string, unknown>;
      }>;

      const validation = validateBlueprintForStreaming(steps);
      if (!validation.valid) {
        throw new Error(
          `Blueprint contains stateful steps not supported in streaming: ${validation.statefulSteps.join(", ")}`
        );
      }

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const result = executeBlueprint(steps as any, { columns, rows });
      rows = result.rows;
      console.log(
        `[Bifrost/Raven] Transform complete: ${totalExtracted} → ${rows.length} rows`
      );
    }

    // 5. Load to destination
    const destProvider = getProvider(route.dest.type);
    const destConnLike = toConnectionLike(route.dest);
    const destConn = await destProvider.connect(destConnLike);

    let totalLoaded = 0;
    let errorCount = 0;

    try {
      if (!destProvider.load) {
        throw new Error(
          `Destination provider "${route.dest.type}" does not support load`
        );
      }

      // Process in batches
      const batchSize = route.destConfig.chunkSize ?? DEFAULT_CHUNK_SIZE;
      let schema: ReturnType<typeof inferSchemaFromRows> | null = null;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize);

        // Infer schema from first batch
        if (!schema && !route.destConfig.schema) {
          schema = inferSchemaFromRows(batch);
        }

        const dateCols = getDateColumns(schema ?? route.destConfig.schema as any);
        if (dateCols.size > 0) {
          normalizeRowDates(batch, dateCols);
        }

        const effectiveDestConfig: DestConfig = {
          ...route.destConfig,
          ...(schema && { schema }),
          // First batch uses route's writeDisposition; subsequent batches append
          ...(batchIndex > 0 &&
            route.destConfig.writeDisposition === "WRITE_TRUNCATE" && {
              writeDisposition: "WRITE_APPEND" as const,
            }),
        };

        try {
          const result = await destProvider.load(destConn, batch, effectiveDestConfig);
          totalLoaded += result.rowsLoaded;
        } catch (err) {
          console.error(
            `[Bifrost/Raven] Load batch #${batchIndex} failed:`,
            err instanceof Error ? err.message : err
          );
          await enqueueDeadLetter(route.id, routeLogId, batchIndex, batch, err);
          errorCount += batch.length;
        }
      }
    } finally {
      await destConn.close();
    }

    // 6. Finalize RouteLog
    const duration = Date.now() - startTime;
    const status =
      errorCount === 0
        ? "completed"
        : totalLoaded > 0
          ? "partial"
          : "failed";

    await prisma.routeLog.update({
      where: { id: routeLogId },
      data: {
        status,
        rowsExtracted: totalExtracted,
        rowsLoaded: totalLoaded,
        errorCount,
        duration,
        completedAt: new Date(),
      },
    });

    console.log(
      `[Bifrost/Raven] Route ${route.name}: ${status} — ${totalLoaded}/${totalExtracted} rows in ${duration}ms`
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Bifrost/Raven] Route ${routeId} FAILED:`, errorMsg);

    await prisma.routeLog.update({
      where: { id: routeLogId },
      data: {
        status: "failed",
        error: errorMsg,
        duration: Date.now() - startTime,
        completedAt: new Date(),
      },
    });
  }
}
