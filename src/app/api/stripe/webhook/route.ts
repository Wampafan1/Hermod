import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import type Stripe from "stripe";

export const runtime = "nodejs";

function tierFromPriceId(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_THOR) return "thor";
  if (priceId === process.env.STRIPE_PRICE_ODIN) return "odin";
  return "heimdall";
}

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Stripe] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[Stripe] Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[Stripe] Received event: ${event.type} (id: ${event.id})`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId;
      const tier = session.metadata?.tier;

      if (tenantId && tier) {
        // Idempotency: check if this subscription is already recorded
        const existing = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { stripeSubscriptionId: true },
        });
        if (existing?.stripeSubscriptionId === (session.subscription as string)) {
          console.log(`[Stripe] Checkout event ${event.id} already processed for tenant ${tenantId}. Skipping.`);
          break;
        }

        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: tier,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          },
        });
        console.log(`[Stripe] Tenant ${tenantId} upgraded to ${tier}`);
      }
      break;
    }

    case "customer.subscription.updated": {
      // Naturally idempotent: findFirst + update with same data = no-op
      const subscription = event.data.object as Stripe.Subscription;
      const tenant = await prisma.tenant.findFirst({
        where: { stripeCustomerId: subscription.customer as string },
      });

      if (tenant) {
        const priceId = subscription.items.data[0]?.price.id;
        const tier = priceId ? tierFromPriceId(priceId) : tenant.plan;
        // current_period_end is always present on the webhook payload but may not be in the SDK type
        const rawPeriodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number | undefined;
        const periodEnd = rawPeriodEnd ? new Date(rawPeriodEnd * 1000) : null;

        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            plan: tier,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: periodEnd,
            stripeSubscriptionId: subscription.id,
          },
        });
        console.log(`[Stripe] Tenant ${tenant.id} subscription updated: ${tier}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      // Naturally idempotent: downgrading an already-heimdall tenant = no-op
      const subscription = event.data.object as Stripe.Subscription;
      const tenant = await prisma.tenant.findFirst({
        where: { stripeCustomerId: subscription.customer as string },
      });

      if (tenant) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            plan: "heimdall",
            stripeSubscriptionId: null,
            stripePriceId: null,
            stripeCurrentPeriodEnd: null,
          },
        });
        console.log(`[Stripe] Tenant ${tenant.id} downgraded to heimdall`);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenant = await prisma.tenant.findFirst({
        where: { stripeCustomerId: invoice.customer as string },
      });
      if (tenant) {
        console.warn(`[Stripe] Payment failed for tenant ${tenant.id} -- Stripe will retry automatically`);
        // Don't downgrade immediately -- Stripe retries failed payments.
        // Downgrade only happens on subscription.deleted after all retries exhaust.
      }
      break;
    }

    default:
      console.log(`[Stripe] Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
