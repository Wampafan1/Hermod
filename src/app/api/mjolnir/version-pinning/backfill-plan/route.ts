import { NextResponse } from "next/server";

import { withAuth } from "@/lib/api";
import { buildVersionPinningBackfillPlan } from "@/lib/mjolnir/version-pinning-backfill-plan";

export const GET = withAuth(async (_req, ctx) => {
  const plan = await buildVersionPinningBackfillPlan({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });

  return NextResponse.json(plan);
});
