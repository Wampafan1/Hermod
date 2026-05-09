import { prisma } from "@/lib/db";

export type ForgeBlueprintAttachContext = "realm-gate" | "bifrost-route";

export interface AttachableForgeBlueprint {
  id: string;
  routeId: string;
  tenantId: string | null;
  status: string;
  name: string | null;
}

export type ForgeBlueprintAttachValidationResult =
  | {
      ok: true;
      forgeBlueprint: AttachableForgeBlueprint | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function normalizeForgeBlueprintId(
  forgeBlueprintId: string | null | undefined
): { ok: true; id: string | null } | { ok: false; error: string } {
  if (forgeBlueprintId == null) {
    return { ok: true, id: null };
  }

  if (typeof forgeBlueprintId !== "string") {
    return { ok: false, error: "Forge blueprint ID must be a string." };
  }

  const trimmed = forgeBlueprintId.trim();
  return { ok: true, id: trimmed ? trimmed : null };
}

export async function validateAttachableForgeBlueprint(input: {
  forgeBlueprintId: string | null | undefined;
  tenantId: string;
  userId: string;
  context: ForgeBlueprintAttachContext;
}): Promise<ForgeBlueprintAttachValidationResult> {
  const normalized = normalizeForgeBlueprintId(input.forgeBlueprintId);
  if (!normalized.ok) {
    return {
      ok: false,
      status: 400,
      error: normalized.error,
    };
  }

  if (!normalized.id) {
    return { ok: true, forgeBlueprint: null };
  }

  const forgeBlueprint = await prisma.forgeBlueprint.findFirst({
    where: { id: normalized.id },
    select: {
      id: true,
      routeId: true,
      tenantId: true,
      status: true,
      name: true,
      route: {
        select: {
          id: true,
          userId: true,
          tenantId: true,
        },
      },
    },
  });

  if (!forgeBlueprint) {
    return {
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    };
  }

  if (forgeBlueprint.status === "ARCHIVED") {
    return {
      ok: false,
      status: 400,
      error: "Archived forge blueprints cannot be attached.",
    };
  }

  if (forgeBlueprint.tenantId && forgeBlueprint.tenantId !== input.tenantId) {
    return {
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    };
  }

  if (
    !forgeBlueprint.route ||
    forgeBlueprint.route.userId !== input.userId ||
    forgeBlueprint.route.tenantId !== input.tenantId
  ) {
    return {
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    };
  }

  return {
    ok: true,
    forgeBlueprint: {
      id: forgeBlueprint.id,
      routeId: forgeBlueprint.routeId,
      tenantId: forgeBlueprint.tenantId,
      status: forgeBlueprint.status,
      name: forgeBlueprint.name,
    },
  };
}
