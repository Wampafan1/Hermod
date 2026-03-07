/**
 * pg-boss job handler for Bifrost routes.
 *
 * Thin adapter between pg-boss and BifrostEngine.
 * The engine does all the work — this just loads the route and calls execute().
 */

import { BifrostEngine, loadRouteWithRelations } from "../engine";
import type { RouteJobPayload, RouteJobResult } from "../types";

const SCHEDULED_ROUTE_TIMEOUT_MS = 30 * 60_000; // 30 minutes

export async function handleRouteJob(job: {
  data: RouteJobPayload;
}): Promise<RouteJobResult> {
  const { routeId, triggeredBy } = job.data;

  console.log(
    `[Bifrost] Processing run-route: route=${routeId} triggeredBy=${triggeredBy}`
  );

  const route = await loadRouteWithRelations(routeId);

  // Skip if route was disabled after job was enqueued
  if (!route.enabled) {
    console.log(`[Bifrost] Route ${routeId} is disabled — skipping`);
    return {
      routeLogId: "",
      status: "skipped",
      totalExtracted: 0,
      totalLoaded: 0,
      errorCount: 0,
      duration: 0,
    };
  }

  const engine = new BifrostEngine();

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Route execution timed out after ${SCHEDULED_ROUTE_TIMEOUT_MS / 60_000} minutes`)),
      SCHEDULED_ROUTE_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([engine.execute(route, triggeredBy), timeout]);
    clearTimeout(timer!);

    console.log(
      `[Bifrost] Route ${routeId} ${result.status}: ${result.totalLoaded}/${result.totalExtracted} rows`
    );

    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}
