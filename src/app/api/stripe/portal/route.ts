import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

// POST /api/stripe/portal
export async function POST() {
  const session = await requireAuth();

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session.user.tenantId! },
  });

  if (!tenant.stripeCustomerId) {
    return NextResponse.json(
      { error: "No subscription found. You are on the free Heimdall tier." },
      { status: 400 }
    );
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${baseUrl}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
