import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireTierFeature } from "@/lib/tier-gate";
import { cleanupStaleJobs } from "@/lib/raven/cleanup";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 2 * 60_000; // 2 minutes
const DISCONNECTED_THRESHOLD_MS = 5 * 60_000; // 5 minutes

function computeStatusDisplay(
  status: string,
  lastHeartbeatAt: Date | null
): string {
  if (status === "revoked") return "revoked";
  if (!lastHeartbeatAt) return "pending";

  const age = Date.now() - lastHeartbeatAt.getTime();
  if (age < STALE_THRESHOLD_MS) return "active";
  if (age < DISCONNECTED_THRESHOLD_MS) return "stale";
  return "disconnected";
}

// GET /api/settings/ravens — List all Ravens for the current tenant
export const GET = withAuth(async (_req, ctx) => {
  const denied = await requireTierFeature(ctx.tenantId, "dataAgent", "Data Agent");
  if (denied) return denied;

  try {
    const cleaned = await cleanupStaleJobs(ctx.tenantId);
    if (cleaned > 0) {
      console.log(`[RAVEN] Cleaned up ${cleaned} stale jobs for tenant ${ctx.tenantId}`);
    }
  } catch (err) {
    console.error("[RAVEN] Stale job cleanup failed:", err);
    // Don't block dashboard load
  }

  const ravens = await prisma.ravenSatellite.findMany({
    where: { tenantId: ctx.tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      hostname: true,
      platform: true,
      lastHeartbeatAt: true,
      metadata: true,
      connections: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { jobs: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = ravens.map((r) => ({
    ...r,
    statusDisplay: computeStatusDisplay(r.status, r.lastHeartbeatAt),
    jobCount: r._count.jobs,
    _count: undefined,
  }));

  return NextResponse.json(result);
});
