import { NextResponse } from "next/server";
import { BlueprintStatus } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

const LISTABLE_STATUSES = new Set<BlueprintStatus>([
  BlueprintStatus.VALIDATED,
  BlueprintStatus.ACTIVE,
  BlueprintStatus.ARCHIVED,
]);
const DEFAULT_STATUSES = [BlueprintStatus.ACTIVE, BlueprintStatus.VALIDATED] as const;

function parseBoolean(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue;
  return value === "true";
}

function parseStatusFilter(value: string | null): { ok: true; statuses: BlueprintStatus[] } | { ok: false; error: string } {
  if (!value) {
    return { ok: true, statuses: [...DEFAULT_STATUSES] };
  }

  const statuses = value
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);

  if (statuses.length === 0 || statuses.some((status) => !LISTABLE_STATUSES.has(status as BlueprintStatus))) {
    return {
      ok: false,
      error: "Invalid status filter. Use ACTIVE, VALIDATED, or ARCHIVED.",
    };
  }

  return { ok: true, statuses: statuses as BlueprintStatus[] };
}

// GET /api/mjolnir/published-blueprints
export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const includeArchived = parseBoolean(url.searchParams.get("includeArchived"), false);
  const includeVersions = parseBoolean(url.searchParams.get("includeVersions"), false);
  const parsedStatuses = parseStatusFilter(url.searchParams.get("status"));

  if (!parsedStatuses.ok) {
    return NextResponse.json({ error: parsedStatuses.error }, { status: 400 });
  }

  const statuses = includeArchived
    ? Array.from(new Set([...parsedStatuses.statuses, BlueprintStatus.ARCHIVED]))
    : parsedStatuses.statuses.filter((status) => status !== BlueprintStatus.ARCHIVED);

  const where = {
    scope: "TENANT_PUBLISHED" as const,
    tenantId: ctx.tenantId,
    status: { in: statuses },
  };

  const safeSelect = {
    id: true,
    name: true,
    description: true,
    scope: true,
    tenantId: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  if (!includeVersions) {
    const blueprints = await prisma.blueprint.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: safeSelect,
    });

    return NextResponse.json({ blueprints });
  }

  const blueprints = await prisma.blueprint.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      ...safeSelect,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          blueprintId: true,
          version: true,
          stepsHash: true,
          createdAt: true,
          source: true,
          isLocked: true,
        },
      },
    },
  });

  return NextResponse.json({
    blueprints: blueprints.map((blueprint) => {
      const { versions, ...safeBlueprint } = blueprint;
      return {
        ...safeBlueprint,
        latestVersion: includeVersions ? versions[0] ?? null : undefined,
      };
    }),
  });
});
