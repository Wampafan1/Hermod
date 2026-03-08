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
import { enqueueDeadLetter } from "./helheim/dead-letter";
import { validateBlueprintForStreaming } from "./forge/forge-validator";
import { executeBlueprint } from "@/lib/mjolnir/engine/blueprint-executor";
import { calculateNextRun } from "@/lib/schedule-utils";
import type {
  DestConfig,
  RouteJobResult,
  SourceConfig,
  SchemaDefinition,
  SchemaField,
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

// ─── Schema Inference ────────────────────────────────

/**
 * Infer a BigQuery-compatible schema by scanning ALL values in the batch.
 *
 * Type resolution per column (scans every row, not just a sample):
 *   - All null/undefined → STRING (safe fallback)
 *   - Any number (int or float) → FLOAT64 (matches floatSafeJsonLine serialization)
 *   - All booleans → BOOLEAN
 *   - Date-only strings (no time component) → DATE
 *   - Datetime strings (with time component) → TIMESTAMP
 *   - Mixed types or plain strings → STRING
 *
 * FLOAT64 is used for ALL numeric columns because floatSafeJsonLine() writes
 * integers as "5.0" in NDJSON. Using INT64 would risk schema mismatch if a
 * later chunk contains decimal values for the same column.
 */
export function inferSchemaFromRows(rows: Record<string, unknown>[]): SchemaDefinition {
  if (rows.length === 0) return { fields: [] };

  const columns = Object.keys(rows[0]);
  const fields: SchemaField[] = columns.map((col) => ({
    name: col,
    type: inferBqTypeFromColumn(rows, col),
    mode: "NULLABLE",
  }));

  return { fields };
}

function inferBqTypeFromColumn(rows: Record<string, unknown>[], column: string): string {
  let hasNumber = false;
  let hasBool = false;
  let hasDate = false;      // date-only (no time component)
  let hasTimestamp = false;  // date with time component
  let hasOtherStr = false;
  let nonNullCount = 0;

  for (const row of rows) {
    const val = row[column];
    if (val === null || val === undefined) continue;
    nonNullCount++;

    if (typeof val === "boolean") {
      hasBool = true;
    } else if (typeof val === "number") {
      hasNumber = true;
    } else if (typeof val === "string") {
      // ISO datetime: "2024-01-15T10:30:00" or "2024-01-15 10:30:00"
      if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(val)) {
        hasTimestamp = true;
      // ISO date only: "2024-01-15"
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        hasDate = true;
      // US datetime: "1/15/2024 12:00:00 AM"
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}/.test(val)) {
        hasTimestamp = true;
      // US date only: "6/29/2024"
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
        hasDate = true;
      } else {
        hasOtherStr = true;
      }
    } else {
      hasOtherStr = true;
    }
  }

  if (nonNullCount === 0) return "STRING";

  // Mixed types → STRING (safe fallback)
  const hasDateLike = hasDate || hasTimestamp;
  const typeCount = [hasNumber, hasBool, hasDateLike, hasOtherStr].filter(Boolean).length;
  if (typeCount > 1) return "STRING";

  if (hasNumber) return "FLOAT64";
  if (hasBool) return "BOOLEAN";
  // If ANY value has a time component → TIMESTAMP (wider); otherwise DATE
  if (hasTimestamp) return "TIMESTAMP";
  if (hasDate) return "DATE";
  return "STRING";
}

// ─── Date Normalization ─────────────────────────────

// US date: "6/29/2024" or "11/3/2024"
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
// US datetime: "1/15/2024 12:00:00 AM" or "6/29/2024 3:45:00 PM"
const US_DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i;

/**
 * Convert US-format date strings (M/D/YYYY) to ISO format (YYYY-MM-DD)
 * in-place for columns identified as DATE or TIMESTAMP by schema inference.
 *
 * BigQuery requires YYYY-MM-DD for DATE and YYYY-MM-DD HH:MM:SS for TIMESTAMP.
 * NetSuite returns M/D/YYYY and M/D/YYYY h:mm:ss AM/PM.
 */
export function normalizeRowDates(
  rows: Record<string, unknown>[],
  dateColumns: ReadonlySet<string>
): void {
  for (const row of rows) {
    for (const col of dateColumns) {
      const val = row[col];
      if (typeof val !== "string" || val === "") continue;

      // US datetime: "1/15/2024 12:00:00 AM" → "2024-01-15 00:00:00"
      const dtMatch = val.match(US_DATETIME_RE);
      if (dtMatch) {
        const [, mo, d, y, h, min, sec, ampm] = dtMatch;
        let hour = parseInt(h, 10);
        if (ampm?.toUpperCase() === "PM" && hour < 12) hour += 12;
        if (ampm?.toUpperCase() === "AM" && hour === 12) hour = 0;
        row[col] = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ` +
          `${String(hour).padStart(2, "0")}:${min}:${sec}`;
        continue;
      }

      // US date only: "6/29/2024" → "2024-06-29"
      const dateMatch = val.match(US_DATE_RE);
      if (dateMatch) {
        const [, mo, d, y] = dateMatch;
        row[col] = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
  }
}

/** Collect DATE and TIMESTAMP column names from a schema. */
export function getDateColumns(schema: SchemaDefinition | null | undefined): Set<string> {
  if (!schema) return new Set();
  return new Set(
    schema.fields
      .filter((f) => f.type === "DATE" || f.type === "TIMESTAMP")
      .map((f) => f.name)
  );
}

// ─── Engine ──────────────────────────────────────────

export class BifrostEngine {
  /**
   * Execute a Bifrost route: extract → (transform) → load.
   */
  async execute(
    route: LoadedRoute,
    triggeredBy: "schedule" | "manual" | "webhook",
    existingRouteLogId?: string
  ): Promise<RouteJobResult> {
    const startTime = Date.now();
    const sourceProvider = getProvider(route.source.type);
    const destProvider = getProvider(route.dest.type);

    const sourceConnLike = toConnectionLike(route.source);
    const destConnLike = toConnectionLike(route.dest);
    const sourceConn = await sourceProvider.connect(sourceConnLike);
    const destConn = await destProvider.connect(destConnLike);

    let routeLog: { id: string } | null = null;

    try {
      // 1. Schema validation — also tells us if the target table exists
      const destTableExists = await this.validateOrCreateDestTable(
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

      // 3. Create or reuse route log (manual trigger pre-creates for atomic locking)
      if (existingRouteLogId) {
        routeLog = { id: existingRouteLogId };
      } else {
        routeLog = await prisma.routeLog.create({
          data: {
            routeId: route.id,
            status: "running",
            triggeredBy,
          },
        });
      }

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

      // New path: cursorConfig + watermark — wrap query as subquery for safe WHERE injection
      // Avoids regex matching WHERE in CTEs/subqueries/string literals
      if (incrementalClause && effectiveSourceConfig.query) {
        const q = effectiveSourceConfig.query.trimEnd().replace(/;$/, "");
        effectiveSourceConfig.query = `SELECT * FROM (${q}) AS __incr WHERE ${incrementalClause}`;
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

      // Track running max watermark — only advanced on successful loads
      let runningMaxWatermark: string | null = null;
      // Pending max from current batch buffer (not yet confirmed loaded)
      let pendingBatchMax: string | null = null;

      // Determine if this route should use MERGE (upsert) instead of APPEND.
      // Conditions: incremental cursor with a primaryKey AND target table exists.
      // First run (table doesn't exist) uses WRITE_TRUNCATE to create the table,
      // then subsequent runs MERGE to avoid duplicates.
      const useMerge = !!(
        cursorConfig &&
        cursorConfig.primaryKey &&
        cursorConfig.strategy !== "full_refresh" &&
        destTableExists &&
        "mergeInto" in destProvider
      );

      // Staging table name for MERGE — suffixed with routeLog ID for uniqueness
      const stagingTableName = useMerge
        ? `${route.destConfig.table}__staging_${Date.now()}`
        : null;

      if (useMerge) {
        console.log(
          `[Bifrost] ${route.name}: Using MERGE (upsert) keyed on "${cursorConfig!.primaryKey}" ` +
          `via staging table "${stagingTableName}"`
        );
      }

      // Explicit schema — inferred once from the first batch and reused for
      // every subsequent load job. Prevents BigQuery from re-inferring types
      // per chunk, which causes "Schema does not match" / "changed type from"
      // errors when different chunks produce different inferred types.
      let schemaDestConfig: DestConfig = useMerge
        ? { ...route.destConfig, table: stagingTableName!, writeDisposition: "WRITE_TRUNCATE" as const }
        : route.destConfig;

      /** Flush the batch buffer to the destination. */
      const flushBatch = async () => {
        if (batchBuffer.length === 0) return;

        const rows = batchBuffer;
        const batchMax = pendingBatchMax;
        batchBuffer = [];
        pendingBatchMax = null;

        try {
          // Infer explicit schema from the first batch (before any load jobs).
          // Deferred to flush time so ALL accumulated rows are scanned, not just
          // the first chunk. The schema is reused for every subsequent load job.
          if (loadBatchIndex === 0 && !route.destConfig.schema) {
            const inferred = inferSchemaFromRows(rows);
            schemaDestConfig = { ...schemaDestConfig, schema: inferred };
            console.log(
              `[Bifrost] Inferred explicit schema (${inferred.fields.length} fields) ` +
              `from ${rows.length} rows — will be used for all load jobs`
            );
          }

          // Normalize US date formats (M/D/YYYY → YYYY-MM-DD) for DATE/TIMESTAMP columns
          const dateCols = getDateColumns(schemaDestConfig.schema);
          if (dateCols.size > 0) {
            normalizeRowDates(rows, dateCols);
          }

          const effectiveDestConfig = loadBatchIndex === 0
            ? schemaDestConfig
            : schemaDestConfig.writeDisposition === "WRITE_TRUNCATE"
              ? { ...schemaDestConfig, writeDisposition: "WRITE_APPEND" as const }
              : schemaDestConfig;
          const result = await this.loadWithRetry(destProvider, destConn, rows, effectiveDestConfig);
          totalLoaded += result.rowsLoaded;

          // Only advance watermark after confirmed load
          if (batchMax) {
            if (!runningMaxWatermark) {
              runningMaxWatermark = batchMax;
            } else {
              const combined = [
                { [cursorConfig!.cursorColumn!]: runningMaxWatermark },
                { [cursorConfig!.cursorColumn!]: batchMax },
              ];
              runningMaxWatermark = extractNewWatermark(
                combined,
                cursorConfig!.cursorColumn!,
                cursorConfig!.strategy
              ) ?? runningMaxWatermark;
            }
          }
        } catch (err) {
          // Fail-fast on fatal errors (missing dataset/table, auth)
          if (isFatalLoadError(err)) {
            // Invalidate only this table's cached schema, not all schemas
            if ("invalidateSchema" in destProvider) {
              const projectId = (route.dest.config as Record<string, unknown>).projectId as string;
              (destProvider as any).invalidateSchema(projectId, route.destConfig.dataset, route.destConfig.table);
            }
            await enqueueDeadLetter(route.id, routeLog!.id, loadBatchIndex, rows, err);
            errorCount += rows.length;
            throw err;
          }
          await enqueueDeadLetter(route.id, routeLog!.id, loadBatchIndex, rows, err);
          errorCount += rows.length;
          // batchMax is intentionally NOT promoted — those rows failed to load
        }

        loadBatchIndex++;
        console.log(
          `[Bifrost] ${route.name}: Transferred ${totalLoaded} / ${totalExtracted} rows...`
        );
      };

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

        // Track pending watermark max for this batch (promoted only after successful load)
        if (cursorConfig?.cursorColumn && cursorConfig.strategy !== "full_refresh") {
          const chunkMax = extractNewWatermark(
            transformed as Record<string, unknown>[],
            cursorConfig.cursorColumn,
            cursorConfig.strategy
          );
          if (chunkMax) {
            if (!pendingBatchMax) {
              pendingBatchMax = chunkMax;
            } else {
              const combined = [
                { [cursorConfig.cursorColumn]: pendingBatchMax },
                { [cursorConfig.cursorColumn]: chunkMax },
              ];
              pendingBatchMax = extractNewWatermark(
                combined,
                cursorConfig.cursorColumn,
                cursorConfig.strategy
              ) ?? pendingBatchMax;
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

      // 5b. MERGE staging → target (if using upsert mode)
      if (useMerge && totalLoaded > 0 && stagingTableName) {
        try {
          const bqProvider = destProvider as BigQueryProvider;
          // Get columns from the inferred schema
          const mergeColumns = schemaDestConfig.schema
            ? schemaDestConfig.schema.fields.map((f) => f.name)
            : [];

          if (mergeColumns.length === 0) {
            throw new Error("Cannot MERGE — no schema columns available");
          }

          console.log(
            `[Bifrost] ${route.name}: Executing MERGE from "${stagingTableName}" → "${route.destConfig.table}" ` +
            `(${totalLoaded} rows, key="${cursorConfig!.primaryKey}")`
          );

          await bqProvider.mergeInto(
            destConn,
            route.destConfig.dataset,
            route.destConfig.table,
            stagingTableName,
            cursorConfig!.primaryKey!,
            mergeColumns
          );

          console.log(`[Bifrost] ${route.name}: MERGE completed successfully`);
        } catch (mergeErr) {
          // MERGE failed — staging table has the data, report failure
          console.error(
            `[Bifrost] ${route.name}: MERGE failed — staging table "${stagingTableName}" preserved for debugging`,
            mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
          );
          throw mergeErr;
        } finally {
          // Clean up staging table (best-effort)
          try {
            await (destProvider as BigQueryProvider).dropTable(
              destConn,
              route.destConfig.dataset,
              stagingTableName
            );
            console.log(`[Bifrost] ${route.name}: Staging table "${stagingTableName}" dropped`);
          } catch (dropErr) {
            console.warn(
              `[Bifrost] ${route.name}: Failed to drop staging table "${stagingTableName}":`,
              dropErr instanceof Error ? dropErr.message : String(dropErr)
            );
          }
        }
      }

      // 6. Update watermark + legacy checkpoint
      if (totalLoaded > 0) {
        // New watermark path
        if (cursorConfig?.cursorColumn && cursorConfig.strategy !== "full_refresh" && runningMaxWatermark) {
          await setWatermark({
            routeId: route.id,
            tableName,
            watermark: runningMaxWatermark,
            watermarkType: cursorConfig.strategy,
            rowsSynced: totalLoaded,
          });
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

  /**
   * Check whether the destination table exists and create dataset if needed.
   * Returns true if the table already exists, false if it will be auto-created.
   */
  private async validateOrCreateDestTable(
    _sourceConn: ProviderConnection,
    destConn: ProviderConnection,
    route: LoadedRoute,
    _sourceProvider: ConnectionProvider,
    destProvider: ConnectionProvider
  ): Promise<boolean> {
    const { destConfig } = route;
    if (!destProvider.getSchema) {
      console.log(`[Bifrost] Dest provider "${route.dest.type}" has no getSchema — skipping validation`);
      return false;
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
        return false;
      } else {
        throw new Error(
          `Destination table ${destConfig.dataset}.${destConfig.table} does not exist. ` +
            `Enable autoCreateTable or create it manually.`
        );
      }
    }

    return true;
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
  monthsOfYear?: number[];
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
      monthsOfYear: route.monthsOfYear,
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
