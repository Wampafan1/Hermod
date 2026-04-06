/**
 * pg-boss job handler for Bifrost routes.
 *
 * Thin adapter between pg-boss and BifrostEngine.
 * The engine does all the work — this just loads the route and calls execute().
 */

import { BifrostEngine, loadRouteWithRelations } from "../engine";
import type { RouteJobPayload, RouteJobResult } from "../types";
import { withTimeout } from "@/lib/async-utils";

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
  const result = await withTimeout(
    engine.execute(route, triggeredBy),
    SCHEDULED_ROUTE_TIMEOUT_MS,
    `Route ${routeId} execution`
  );

  if (result.status === "waiting_for_agent") {
    console.log(
      `[Bifrost] Route ${routeId} waiting_for_agent: RavenJob ${result.ravenJobId} queued`
    );
  } else {
    console.log(
      `[Bifrost] Route ${routeId} ${result.status}: ${result.totalLoaded}/${result.totalExtracted} rows`
    );
  }

  return result;
}
