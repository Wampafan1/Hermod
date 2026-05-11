import { NextResponse } from "next/server";

import { withAuth } from "@/lib/api";
import { getLegacyBlueprintUsageInventory } from "@/lib/mjolnir/legacy-blueprint-usage-inventory";

export const GET = withAuth(async (_req, ctx) => {
  const inventory = await getLegacyBlueprintUsageInventory({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });

  return NextResponse.json(inventory);
});
