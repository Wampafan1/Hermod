/**
 * BifrostEngine — Core execution pipeline.
 *
 * Takes a route config, orchestrates extract → transform → load,
 * returns a structured result. Zero knowledge of pg-boss or HTTP.
 */

import { prisma } from "@/lib/db";
import { getProvider, toConnectionLike } from "@/lib/providers";
import type { ConnectionProvider } from "@/lib/providers";
import type { ProviderConnection } from "@/lib/providers/types";
import type { BigQueryProvider } from "@/lib/providers/bigquery.provider";
import { clearSchemaCache } from "@/lib/providers/bigquery.provider";
import { enqueueDeadLetter } from "./helheim/dead-letter";
import { validateBlueprintForStreaming } from "./forge/forge-validator";
import { executeBlueprint } from "@/lib/mjolnir/engine/blueprint-executor";
import { calculateNextRun } from "@/lib/schedule-utils";
import type {
  DestConfig,
  RouteJobResult,
  SourceConfig,
} from "./types";
import { DEFAULT_CHUNK_SIZE } from "./types";
import type { CursorConfig } from "@/lib/sync/types";
import { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } from "@/lib/sync/watermark";

// ─── Route Loading ───────────────────────────────────

export interface LoadedRoute {
  id: string;
  name: string;
  enabled: boolean;
  sourceId: string;
  source: { id: string; type: string; config: unknown; credentials: string | null };
  destId: string;
  dest: { id: string; type: string; config: unknown; credentials: string | null };
  sourceConfig: SourceConfig;
  destConfig: DestConfig;
  transformEnabled: boolean;
  blueprintId: string | null;
  lastCheckpoint: Date | null;
  cursorConfig: CursorConfig | null;
  frequency: string | null;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  timeHour: number;
  timeMinute: number;
  timezone: string;
}

export async function loadRouteWithRelations(routeId: string): Promise<LoadedRoute> {
  const route = await prisma.bifrostRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      source: { select: { id: true, type: true, config: true, credentials: true } },
      dest: { select: { id: true, type: true, config: true, credentials: true } },
    },
  });

  return {
    ...route,
    sourceConfig: route.sourceConfig as unknown as SourceConfig,
    destConfig: route.destConfig as unknown as DestConfig,
    cursorConfig: route.cursorConfig as CursorConfig | null,
  };
}

// ─── Engine ──────────────────────────────────────────

export class BifrostEngine {
  /**
   * Execute a Bifrost route: extract → (transform) → load.
   */
  async execute(
    route: LoadedRoute,
    triggeredBy: "schedule" | "manual" | "webhook"
  ): Promise<RouteJobResult> {
    const startTime = Date.now();
    const sourceProvider = getProvider(route.source.type);
    const destProvider = getProvider(route.dest.type);

    const sourceConnLike = toConnectionLike(route.source);
    const destConnLike = toConnectionLike(route.dest);
    const sourceConn = await sourceProvider.connect(sourceConnLike);
    const destConn = await destProvider.connect(destConnLike);

    let routeLog: { id: string } | null = null;

    // 0. Clean up any stale "running" logs from previous crashed runs
    await prisma.routeLog.updateMany({
      where: {
        routeId: route.id,
        status: "running",
        startedAt: { lt: new Date(Date.now() - 15 * 60_000) }, // >15 min old
      },
      data: {
        status: "failed",
        error: "Timed out — process crashed or hung before completion",
        completedAt: new Date(),
      },
    });

    try {
      // 1. Schema validation
      await this.validateOrCreateDestTable(
        sourceConn,
        destConn,
        route,
        sourceProvider,
        destProvider
      );

      // 2. Read watermark for incremental sync
      const cursorConfig = route.cursorConfig;
      const tableName = route.destConfig.table;
      let priorWatermark: string | null = null;

      if (cursorConfig && cursorConfig.strategy !== "full_refresh" && cursorConfig.cursorColumn) {
        priorWatermark = await getWatermark(route.id, tableName);
      }

      const incrementalClause = cursorConfig?.cursorColumn
        ? buildIncrementalClause(cursorConfig.cursorColumn, cursorConfig.strategy, priorWatermark)
        : null;

      // 3. Create route log
      routeLog = await prisma.routeLog.create({
        data: {
          routeId: route.id,
          status: "running",
          triggeredBy,
        },
      });

      // 4. Pre-fetch blueprint if transform is enabled (once, not per-chunk)
      let blueprintSteps: Array<{ type: string; order: number; config: Record<string, unknown> }> | null = null;
      if (route.transformEnabled && route.blueprintId) {
        const blueprint = await prisma.blueprint.findUniqueOrThrow({
          where: { id: route.blueprintId },
          select: { steps: true },
        });
        blueprintSteps = blueprint.steps as typeof blueprintSteps;
        const validation = validateBlueprintForStreaming(blueprintSteps!);
        if (!validation.valid) {
          throw new Error(
            `Blueprint contains stateful steps not supported in streaming mode: ${validation.statefulSteps.join(", ")}`
          );
        }
      }

      // 5. Extract → Transform → Load loop
      if (!sourceProvider.extract) {
        throw new Error(`Source provider "${route.source.type}" does not support extract`);
      }
      if (!destProvider.load) {
        throw new Error(`Destination provider "${route.dest.type}" does not support load`);
      }

      let totalExtracted = 0;
      let totalLoaded = 0;
      let errorCount = 0;
      let loadBatchIndex = 0;

      // Batch buffer — accumulate small source chunks before flushing to
      // the destination. Reduces BigQuery load jobs from N to N/batchSize,
      // avoiding rate-limit errors (BigQuery allows ~10 table mods / 10s).
      const LOAD_BATCH_SIZE = route.destConfig.chunkSize ?? DEFAULT_CHUNK_SIZE;
      let batchBuffer: Record<string, unknown>[] = [];

      // Build effective source config with incremental params
      const effectiveSourceConfig: SourceConfig = {
        ...route.sourceConfig,
      };

      // New path: cursorConfig + watermark — append WHERE clause to query
      if (incrementalClause && effectiveSourceConfig.query) {
        const q = effectiveSourceConfig.query.trimEnd().replace(/;$/, "");
        const hasWhere = /\bWHERE\b/i.test(q);
        effectiveSourceConfig.query = hasWhere
          ? `${q} AND ${incrementalClause}`
          : `${q} WHERE ${incrementalClause}`;
      }
      // Legacy path: incrementalKey + lastCheckpoint (backward compat)
      else if (route.sourceConfig.incrementalKey) {
        const params = this.buildQueryParams(route);
        if (params.last_run) {
          const lastRunValue = params.last_run instanceof Date
            ? params.last_run.toISOString()
            : String(params.last_run);
          effectiveSourceConfig.params = {
            ...effectiveSourceConfig.params,
            last_run: lastRunValue,
          };
        }
      }

      /** Flush the batch buffer to the destination. */
      const flushBatch = async () => {
        if (batchBuffer.length === 0) return;

        const rows = batchBuffer;
        batchBuffer = [];

        try {
          const effectiveDestConfig = loadBatchIndex === 0
            ? route.destConfig
            : route.destConfig.writeDisposition === "WRITE_TRUNCATE"
              ? { ...route.destConfig, writeDisposition: "WRITE_APPEND" as const }
              : route.destConfig;
          const result = await this.loadWithRetry(destProvider, destConn, rows, effectiveDestConfig);
          totalLoaded += result.rowsLoaded;
        } catch (err) {
          // Fail-fast on fatal errors (missing dataset/table, auth)
          if (isFatalLoadError(err)) {
            clearSchemaCache();
            await enqueueDeadLetter(route.id, routeLog.id, loadBatchIndex, rows, err);
            errorCount += rows.length;
            throw err;
          }
          await enqueueDeadLetter(route.id, routeLog.id, loadBatchIndex, rows, err);
          errorCount += rows.length;
        }

        loadBatchIndex++;
        console.log(
          `[Bifrost] ${route.name}: Transferred ${totalLoaded} / ${totalExtracted} rows...`
        );
      };

      // Track cursor column values for watermark extraction
      const cursorValues: Record<string, unknown>[] = [];

      for await (const chunk of sourceProvider.extract(
        sourceConn,
        effectiveSourceConfig
      )) {
        if (chunk.length === 0) continue;

        totalExtracted += chunk.length;

        // Optional Nidavellir transform (blueprint already fetched above)
        let transformed = chunk;
        if (blueprintSteps) {
          try {
            const columns = chunk.length > 0 ? Object.keys(chunk[0]) : [];
            const result = executeBlueprint(blueprintSteps as any, { columns, rows: chunk });
            transformed = result.rows;
          } catch (err) {
            await enqueueDeadLetter(route.id, routeLog.id, loadBatchIndex, chunk, err);
            errorCount += chunk.length;
            continue;
          }
        }

        batchBuffer.push(...transformed);

        // Track cursor column values for watermark (memory-efficient: only store cursor col)
        if (cursorConfig?.cursorColumn) {
          for (const row of transformed) {
            const val = row[cursorConfig.cursorColumn];
            if (val != null) {
              cursorValues.push({ [cursorConfig.cursorColumn]: val });
            }
          }
        }

        // Flush when buffer reaches threshold
        if (batchBuffer.length >= LOAD_BATCH_SIZE) {
          await flushBatch();
        }
      }

      // Flush remaining rows
      await flushBatch();

      // 6. Update watermark + legacy checkpoint
      if (totalLoaded > 0) {
        // New watermark path
        if (cursorConfig?.cursorColumn && cursorConfig.strategy !== "full_refresh") {
          const newWatermark = extractNewWatermark(
            cursorValues,
            cursorConfig.cursorColumn,
            cursorConfig.strategy
          );
          if (newWatermark) {
            await setWatermark({
              routeId: route.id,
              tableName,
              watermark: newWatermark,
              watermarkType: cursorConfig.strategy,
              rowsSynced: totalLoaded,
            });
          }
        }

        // Legacy checkpoint (always update for backward compat)
        if (route.sourceConfig.incrementalKey || cursorConfig) {
          await prisma.bifrostRoute.update({
            where: { id: route.id },
            data: { lastCheckpoint: new Date() },
          });
        }
      }

      // 7. Finalize
      const duration = Date.now() - startTime;
      const status =
        errorCount === 0
          ? "completed"
          : totalLoaded > 0
            ? "partial"
            : "failed";

      await prisma.routeLog.update({
        where: { id: routeLog.id },
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
        `[Bifrost] ${route.name}: ${status} — ${totalLoaded}/${totalExtracted} rows in ${duration}ms`
      );

      return { routeLogId: routeLog.id, status, totalExtracted, totalLoaded, errorCount, duration };
    } catch (err) {
      // Job-level failure (auth, network, etc.)
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (routeLog) {
        // Update the existing "running" log instead of creating an orphan
        await prisma.routeLog.update({
          where: { id: routeLog.id },
          data: {
            status: "failed",
            error: errorMsg,
            duration,
            completedAt: new Date(),
          },
        });
      } else {
        // Error occurred before routeLog was created (e.g., schema validation)
        routeLog = await prisma.routeLog.create({
          data: {
            routeId: route.id,
            status: "failed",
            error: errorMsg,
            triggeredBy,
            duration,
            completedAt: new Date(),
          },
        });
      }

      console.error(`[Bifrost] ${route.name}: FAILED — ${errorMsg}`);

      return {
        routeLogId: routeLog.id,
        status: "failed",
        totalExtracted: 0,
        totalLoaded: 0,
        errorCount: 0,
        duration,
      };
    } finally {
      await sourceConn.close();
      await destConn.close();
    }
  }

  // ─── Load with Rate-Limit Retry ─────────────────────

  /**
   * Attempt a load, retrying with exponential backoff on rate-limit errors.
   * BigQuery allows ~10 table modifications per 10 seconds; firing 90+ load
   * jobs back-to-back will hit this wall. Retrying with backoff lets the
   * quota recover.
   */
  private async loadWithRetry(
    provider: ConnectionProvider,
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    destConfig: DestConfig,
    maxRetries = 3
  ): Promise<import("./types").LoadResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await provider.load!(conn, rows, destConfig);
      } catch (err) {
        lastErr = err;
        if (!isRateLimitError(err) || attempt === maxRetries) {
          throw err;
        }
        // Exponential backoff: 2s, 4s, 8s
        const delayMs = 2000 * Math.pow(2, attempt);
        console.log(
          `[Bifrost] Rate limited — waiting ${delayMs / 1000}s before retry ${attempt + 1}/${maxRetries}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastErr;
  }

  // ─── Schema Validation ─────────────────────────────

  private async validateOrCreateDestTable(
    _sourceConn: ProviderConnection,
    destConn: ProviderConnection,
    route: LoadedRoute,
    _sourceProvider: ConnectionProvider,
    destProvider: ConnectionProvider
  ): Promise<void> {
    const { destConfig } = route;
    if (!destProvider.getSchema) {
      console.log(`[Bifrost] Dest provider "${route.dest.type}" has no getSchema — skipping validation`);
      return;
    }

    console.log(
      `[Bifrost] Checking dest schema: ${destConfig.dataset}.${destConfig.table} ` +
      `(autoCreateTable=${destConfig.autoCreateTable})`
    );

    const destSchema = await destProvider.getSchema(
      destConn,
      destConfig.dataset,
      destConfig.table
    );

    console.log(
      `[Bifrost] getSchema result: ${destSchema ? `found (${destSchema.fields.length} fields)` : "null (table/dataset missing)"}`
    );

    if (!destSchema) {
      if (destConfig.autoCreateTable) {
        // BigQuery autodetect will create the table on the first load job,
        // but the DATASET must already exist. Ensure it does.
        if ("ensureDataset" in destProvider) {
          console.log(`[Bifrost] Calling ensureDataset("${destConfig.dataset}")...`);
          await (destProvider as BigQueryProvider).ensureDataset(
            destConn,
            destConfig.dataset
          );
          console.log(`[Bifrost] ensureDataset completed`);
        } else {
          console.log(`[Bifrost] WARNING: dest provider has no ensureDataset method`);
        }
        console.log(
          `[Bifrost] Table ${destConfig.dataset}.${destConfig.table} will be auto-created via load job`
        );
      } else {
        throw new Error(
          `Destination table ${destConfig.dataset}.${destConfig.table} does not exist. ` +
            `Enable autoCreateTable or create it manually.`
        );
      }
    }
  }

  // ─── Query Params ──────────────────────────────────

  private buildQueryParams(route: LoadedRoute): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (route.sourceConfig.incrementalKey && route.lastCheckpoint) {
      params.last_run = route.lastCheckpoint;
    } else if (route.sourceConfig.incrementalKey) {
      // First run — use epoch to get all data
      params.last_run = new Date(0);
    }

    return params;
  }

}

// ─── Error Classification ────────────────────────────

/** Rate-limit errors from BigQuery that are safe to retry with backoff. */
function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("exceeded rate limits") || msg.includes("rateLimitExceeded".toLowerCase());
}

/** Fatal errors where retrying the same operation will never succeed. */
function isFatalLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("Not found: Dataset") ||
    msg.includes("Not found: Table") ||
    msg.includes("Access Denied") ||
    msg.includes("Permission denied") ||
    msg.includes("PERMISSION_DENIED") ||
    msg.includes("Invalid project") ||
    msg.includes("notFound")
  );
}

// ─── Route Schedule Advancement ──────────────────────

export async function advanceRouteNextRun(route: {
  id: string;
  frequency: string | null;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  timeHour: number;
  timeMinute: number;
  timezone: string;
}): Promise<void> {
  if (!route.frequency) return;

  const nextRun = calculateNextRun(
    {
      frequency: route.frequency as any,
      daysOfWeek: route.daysOfWeek,
      dayOfMonth: route.dayOfMonth,
      timeHour: route.timeHour,
      timeMinute: route.timeMinute,
      timezone: route.timezone,
    },
    new Date()
  );

  await prisma.bifrostRoute.update({
    where: { id: route.id },
    data: { nextRunAt: nextRun },
  });
}
