/**
 * Tier gating utility -- checks whether a tenant's plan allows a specific feature.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTierConfig } from "@/lib/tiers";
import type { TierConfig } from "@/lib/tiers";

export interface GateResult {
  allowed: boolean;
  tier: TierConfig;
  tenantId: string;
}

/** Check if a tenant has access to a feature. */
export async function checkTierAccess(
  tenantId: string,
  feature: keyof TierConfig["features"]
): Promise<GateResult> {
  // Use findUnique (NOT findUniqueOrThrow) to handle orphaned sessions gracefully
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });

  if (!tenant) {
    return { allowed: false, tier: getTierConfig("heimdall"), tenantId };
  }

  const tier = getTierConfig(tenant.plan);
  return {
    allowed: !!tier.features[feature],
    tier,
    tenantId,
  };
}

/**
 * Check access and return an error response if denied. Returns null if allowed.
 * Returns 401 if tenant not found (orphaned session), 403 if tier insufficient.
 */
export async function requireTierFeature(
  tenantId: string | null | undefined,
  feature: keyof TierConfig["features"],
  featureDisplayName?: string
): Promise<NextResponse | null> {
  if (!tenantId) {
    return NextResponse.json(
      { error: "No active workspace. Please complete onboarding." },
      { status: 401 }
    );
  }

  // Graceful lookup -- returns 401 on missing tenant instead of throwing 500
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });

  if (!tenant) {
    return NextResponse.json(
      { error: "Workspace not found. Your session may have expired." },
      { status: 401 }
    );
  }

  const tier = getTierConfig(tenant.plan);
  if (!tier.features[feature]) {
    const label = featureDisplayName || feature;
    const requiredTiers = feature === "mjolnirAiForge" || feature === "apiDiscovery" || feature === "whiteLabel"
      ? "Odin"
      : "Thor or Odin";

    return NextResponse.json(
      {
        error: "Feature not available on your current plan",
        feature: label,
        currentPlan: tier.displayName,
        requiredPlan: requiredTiers,
        upgradeUrl: "/api/stripe/checkout",
      },
      { status: 403 }
    );
  }

  return null;
}
