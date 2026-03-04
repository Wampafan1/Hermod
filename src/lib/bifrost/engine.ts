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

    try {
      // 1. Schema validation
      await this.validateOrCreateDestTable(
        sourceConn,
        destConn,
        route,
        sourceProvider,
        destProvider
      );

      // 2. Build query params
      const params = this.buildQueryParams(route);

      // 3. Create route log
      const routeLog = await prisma.routeLog.create({
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
      let chunkIndex = 0;

      // Build effective source config with incremental params
      const effectiveSourceConfig: SourceConfig = {
        ...route.sourceConfig,
      };
      if (params.last_run) {
        // Inject last_run into the query for incremental extraction
        const lastRunStr = params.last_run instanceof Date
          ? params.last_run.toISOString()
          : String(params.last_run);
        effectiveSourceConfig.query = effectiveSourceConfig.query.replace(
          /@last_run/g,
          `'${lastRunStr}'`
        );
      }

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
            await enqueueDeadLetter(route.id, routeLog.id, chunkIndex, chunk, err);
            errorCount += chunk.length;
            chunkIndex++;
            continue;
          }
        }

        // Load to destination
        try {
          const result = await destProvider.load!(destConn, transformed, route.destConfig);
          totalLoaded += result.rowsLoaded;
        } catch (err) {
          await enqueueDeadLetter(route.id, routeLog.id, chunkIndex, chunk, err);
          errorCount += chunk.length;
        }

        chunkIndex++;
        console.log(
          `[Bifrost] ${route.name}: Transferred ${totalLoaded} / ${totalExtracted} rows...`
        );
      }

      // 6. Update checkpoint for incremental runs
      if (totalLoaded > 0 && route.sourceConfig.incrementalKey) {
        await prisma.bifrostRoute.update({
          where: { id: route.id },
          data: { lastCheckpoint: new Date() },
        });
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

      // Create or update log
      const routeLog = await prisma.routeLog.create({
        data: {
          routeId: route.id,
          status: "failed",
          error: errorMsg,
          triggeredBy,
          duration,
          completedAt: new Date(),
        },
      });

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
      // Provider doesn't support schema inspection — skip validation
      return;
    }
    const destSchema = await destProvider.getSchema(
      destConn,
      destConfig.dataset,
      destConfig.table
    );

    if (!destSchema) {
      if (destConfig.autoCreateTable) {
        // BigQuery autodetect will infer schema from the first load job.
        // No pre-creation needed — the load call handles it.
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
