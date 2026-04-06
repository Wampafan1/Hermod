/**
 * Tier definitions and helpers for Hermod subscription plans.
 */

export type TierName = "heimdall" | "thor" | "odin";

export interface TierConfig {
  name: TierName;
  displayName: string;
  priceMonthly: number;
  features: {
    dataAgent: boolean;
    webhookTriggers: boolean;
    mjolnirAiForge: boolean;
    apiDiscovery: boolean;
    whiteLabel: boolean;
    customSmtp: boolean;
    maxAttachmentMb: number;
    emailBranding: "full" | "powered_by" | "none";
    prioritySupport: boolean;
  };
}

export const TIERS: Record<TierName, TierConfig> = {
  heimdall: {
    name: "heimdall",
    displayName: "Heimdall",
    priceMonthly: 0,
    features: {
      dataAgent: false,
      webhookTriggers: false,
      mjolnirAiForge: false,
      apiDiscovery: false,
      whiteLabel: false,
      customSmtp: false,
      maxAttachmentMb: 5,
      emailBranding: "full",
      prioritySupport: false,
    },
  },
  thor: {
    name: "thor",
    displayName: "Thor",
    priceMonthly: 99,
    features: {
      dataAgent: true,
      webhookTriggers: true,
      mjolnirAiForge: false,
      apiDiscovery: false,
      whiteLabel: false,
      customSmtp: false,
      maxAttachmentMb: 10,
      emailBranding: "powered_by",
      prioritySupport: false,
    },
  },
  odin: {
    name: "odin",
    displayName: "Odin",
    priceMonthly: 299,
    features: {
      dataAgent: true,
      webhookTriggers: true,
      mjolnirAiForge: true,
      apiDiscovery: true,
      whiteLabel: true,
      customSmtp: true,
      maxAttachmentMb: 25,
      emailBranding: "none",
      prioritySupport: true,
    },
  },
};

/** Get the tier config for a tenant's plan. Defaults to heimdall if unknown. */
export function getTierConfig(plan: string): TierConfig {
  return TIERS[plan as TierName] ?? TIERS.heimdall;
}

/** Check if a tenant has access to a specific feature. */
export function hasTierFeature(
  plan: string,
  feature: keyof TierConfig["features"]
): boolean {
  const tier = getTierConfig(plan);
  return !!tier.features[feature];
}

/**
 * Get the Stripe Price ID for a tier from environment variables.
 * Returns undefined if the tier is free or the env var is not set.
 * Callers MUST check for undefined before passing to the Stripe SDK.
 */
export function getStripePriceId(tier: TierName): string | undefined {
  if (tier === "heimdall") return undefined; // free tier, no Stripe price
  const envMap: Record<string, string | undefined> = {
    thor: process.env.STRIPE_PRICE_THOR,
    odin: process.env.STRIPE_PRICE_ODIN,
  };
  return envMap[tier] || undefined;
}
