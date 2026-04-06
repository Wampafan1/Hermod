import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getStripePriceId } from "@/lib/tiers";
import type { TierName } from "@/lib/tiers";
import { z } from "zod";

const checkoutSchema = z.object({
  tier: z.enum(["thor", "odin"]),
});

// POST /api/stripe/checkout
export async function POST(req: Request) {
  const session = await requireAuth();
  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const tier = parsed.data.tier as TierName;
  const priceId = getStripePriceId(tier);
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe pricing not configured for ${tier}. Set STRIPE_PRICE_${tier.toUpperCase()} in environment variables.` },
      { status: 500 }
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session.user.tenantId! },
  });

  const stripe = getStripe();

  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email!,
      metadata: { tenantId: tenant.id, tenantName: tenant.name },
    });
    customerId = customer.id;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/dashboard?upgraded=true`,
    cancel_url: `${baseUrl}/dashboard?upgrade=cancelled`,
    metadata: { tenantId: tenant.id, tier },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
