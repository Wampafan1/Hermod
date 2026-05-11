import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type LegacyBlueprintUsageType = "report" | "bifrost_route" | "realm_gate";

export interface LegacyBlueprintUsageInventoryInput {
  tenantId?: string;
  userId?: string;
}

export interface BlueprintVersionInventorySummary {
  id: string;
  blueprintId: string;
  version: number;
  stepsHash: string;
  blueprintName: string | null;
  blueprintStatus: string | null;
}

export interface LegacyBlueprintUsageInventoryItem {
  id: string;
  type: LegacyBlueprintUsageType;
  name: string;
  tenantId: string | null;
  tenantName: string | null;
  status: string | null;
  enabled: boolean | null;
  blueprintId: string | null;
  forgeBlueprintId: string | null;
  blueprintVersionId: string | null;
  blueprintName: string | null;
  forgeBlueprintName: string | null;
  blueprintVersion: BlueprintVersionInventorySummary | null;
  updatedAt: Date;
}

export interface AmbiguousBlueprintUsageInventoryItem
  extends LegacyBlueprintUsageInventoryItem {
  reason: string;
}

export interface LegacyBlueprintUsageInventorySummary {
  legacyReports: number;
  legacyBifrostRoutes: number;
  legacyRealmGates: number;
  pinnedReports: number;
  pinnedBifrostRoutes: number;
  pinnedRealmGates: number;
  ambiguousCount: number;
}

export interface LegacyBlueprintUsageInventory {
  reportsUsingLegacyBlueprintId: LegacyBlueprintUsageInventoryItem[];
  bifrostRoutesUsingLegacyBlueprintId: LegacyBlueprintUsageInventoryItem[];
  realmGatesUsingLegacyForgeBlueprintId: LegacyBlueprintUsageInventoryItem[];
  pinnedReports: LegacyBlueprintUsageInventoryItem[];
  pinnedBifrostRoutes: LegacyBlueprintUsageInventoryItem[];
  pinnedRealmGates: LegacyBlueprintUsageInventoryItem[];
  ambiguous: AmbiguousBlueprintUsageInventoryItem[];
  summary: LegacyBlueprintUsageInventorySummary;
}

type VersionRow = {
  id: string;
  blueprintId: string;
  version: number;
  stepsHash: string;
  blueprint: {
    name: string;
    status: string;
  } | null;
} | null;

type ReportInventoryRow = {
  id: string;
  name: string;
  tenantId: string | null;
  blueprintId: string | null;
  blueprintVersionId: string | null;
  updatedAt: Date;
  tenant: { name: string } | null;
  schedule: { enabled: boolean } | null;
  blueprint: { name: string } | null;
  blueprintVersion: VersionRow;
};

type BifrostInventoryRow = {
  id: string;
  name: string;
  tenantId: string | null;
  blueprintId: string | null;
  blueprintVersionId: string | null;
  enabled: boolean;
  updatedAt: Date;
  tenant: { name: string } | null;
  blueprint: { name: string } | null;
  blueprintVersion: VersionRow;
};

type RealmGateInventoryRow = {
  id: string;
  name: string;
  tenantId: string | null;
  status: string;
  forgeBlueprintId: string | null;
  blueprintVersionId: string | null;
  updatedAt: Date;
  tenant: { name: string } | null;
  forgeBlueprint: { name: string } | null;
  blueprintVersion: VersionRow;
};

const blueprintVersionSelect = {
  id: true,
  blueprintId: true,
  version: true,
  stepsHash: true,
  blueprint: {
    select: {
      name: true,
      status: true,
    },
  },
} satisfies Prisma.BlueprintVersionSelect;

const reportSelect = {
  id: true,
  name: true,
  tenantId: true,
  blueprintId: true,
  blueprintVersionId: true,
  updatedAt: true,
  tenant: {
    select: {
      name: true,
    },
  },
  schedule: {
    select: {
      enabled: true,
    },
  },
  blueprint: {
    select: {
      name: true,
    },
  },
  blueprintVersion: {
    select: blueprintVersionSelect,
  },
} satisfies Prisma.ReportSelect;

const bifrostRouteSelect = {
  id: true,
  name: true,
  tenantId: true,
  blueprintId: true,
  blueprintVersionId: true,
  enabled: true,
  updatedAt: true,
  tenant: {
    select: {
      name: true,
    },
  },
  blueprint: {
    select: {
      name: true,
    },
  },
  blueprintVersion: {
    select: blueprintVersionSelect,
  },
} satisfies Prisma.BifrostRouteSelect;

const realmGateSelect = {
  id: true,
  name: true,
  tenantId: true,
  status: true,
  forgeBlueprintId: true,
  blueprintVersionId: true,
  updatedAt: true,
  tenant: {
    select: {
      name: true,
    },
  },
  forgeBlueprint: {
    select: {
      name: true,
    },
  },
  blueprintVersion: {
    select: blueprintVersionSelect,
  },
} satisfies Prisma.RealmGateSelect;

function scopedReportWhere(
  input: LegacyBlueprintUsageInventoryInput,
  where: Prisma.ReportWhereInput,
): Prisma.ReportWhereInput {
  return {
    ...where,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
  };
}

function scopedBifrostWhere(
  input: LegacyBlueprintUsageInventoryInput,
  where: Prisma.BifrostRouteWhereInput,
): Prisma.BifrostRouteWhereInput {
  return {
    ...where,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
  };
}

function scopedRealmGateWhere(
  input: LegacyBlueprintUsageInventoryInput,
  where: Prisma.RealmGateWhereInput,
): Prisma.RealmGateWhereInput {
  return {
    ...where,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  };
}

function mapBlueprintVersion(
  version: VersionRow,
): BlueprintVersionInventorySummary | null {
  if (!version) {
    return null;
  }

  return {
    id: version.id,
    blueprintId: version.blueprintId,
    version: version.version,
    stepsHash: version.stepsHash,
    blueprintName: version.blueprint?.name ?? null,
    blueprintStatus: version.blueprint?.status ?? null,
  };
}

function mapReport(row: ReportInventoryRow): LegacyBlueprintUsageInventoryItem {
  return {
    id: row.id,
    type: "report",
    name: row.name,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    status: null,
    enabled: row.schedule?.enabled ?? null,
    blueprintId: row.blueprintId,
    forgeBlueprintId: null,
    blueprintVersionId: row.blueprintVersionId,
    blueprintName: row.blueprint?.name ?? null,
    forgeBlueprintName: null,
    blueprintVersion: mapBlueprintVersion(row.blueprintVersion),
    updatedAt: row.updatedAt,
  };
}

function mapBifrostRoute(
  row: BifrostInventoryRow,
): LegacyBlueprintUsageInventoryItem {
  return {
    id: row.id,
    type: "bifrost_route",
    name: row.name,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    status: null,
    enabled: row.enabled,
    blueprintId: row.blueprintId,
    forgeBlueprintId: null,
    blueprintVersionId: row.blueprintVersionId,
    blueprintName: row.blueprint?.name ?? null,
    forgeBlueprintName: null,
    blueprintVersion: mapBlueprintVersion(row.blueprintVersion),
    updatedAt: row.updatedAt,
  };
}

function mapRealmGate(
  row: RealmGateInventoryRow,
): LegacyBlueprintUsageInventoryItem {
  return {
    id: row.id,
    type: "realm_gate",
    name: row.name,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    status: row.status,
    enabled: null,
    blueprintId: null,
    forgeBlueprintId: row.forgeBlueprintId,
    blueprintVersionId: row.blueprintVersionId,
    blueprintName: null,
    forgeBlueprintName: row.forgeBlueprint?.name ?? null,
    blueprintVersion: mapBlueprintVersion(row.blueprintVersion),
    updatedAt: row.updatedAt,
  };
}

export async function getLegacyBlueprintUsageInventory(
  input: LegacyBlueprintUsageInventoryInput,
): Promise<LegacyBlueprintUsageInventory> {
  const [
    legacyReports,
    pinnedReports,
    ambiguousReports,
    legacyBifrostRoutes,
    pinnedBifrostRoutes,
    ambiguousBifrostRoutes,
    legacyRealmGates,
    pinnedRealmGates,
    ambiguousRealmGates,
  ] = await Promise.all([
    prisma.report.findMany({
      where: scopedReportWhere(input, {
        blueprintId: { not: null },
        blueprintVersionId: null,
      }),
      orderBy: { updatedAt: "desc" },
      select: reportSelect,
    }),
    prisma.report.findMany({
      where: scopedReportWhere(input, {
        blueprintId: null,
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: reportSelect,
    }),
    prisma.report.findMany({
      where: scopedReportWhere(input, {
        blueprintId: { not: null },
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: reportSelect,
    }),
    prisma.bifrostRoute.findMany({
      where: scopedBifrostWhere(input, {
        blueprintId: { not: null },
        blueprintVersionId: null,
      }),
      orderBy: { updatedAt: "desc" },
      select: bifrostRouteSelect,
    }),
    prisma.bifrostRoute.findMany({
      where: scopedBifrostWhere(input, {
        blueprintId: null,
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: bifrostRouteSelect,
    }),
    prisma.bifrostRoute.findMany({
      where: scopedBifrostWhere(input, {
        blueprintId: { not: null },
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: bifrostRouteSelect,
    }),
    prisma.realmGate.findMany({
      where: scopedRealmGateWhere(input, {
        forgeBlueprintId: { not: null },
        blueprintVersionId: null,
      }),
      orderBy: { updatedAt: "desc" },
      select: realmGateSelect,
    }),
    prisma.realmGate.findMany({
      where: scopedRealmGateWhere(input, {
        forgeBlueprintId: null,
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: realmGateSelect,
    }),
    prisma.realmGate.findMany({
      where: scopedRealmGateWhere(input, {
        forgeBlueprintId: { not: null },
        blueprintVersionId: { not: null },
      }),
      orderBy: { updatedAt: "desc" },
      select: realmGateSelect,
    }),
  ]);

  const reportsUsingLegacyBlueprintId = legacyReports.map(mapReport);
  const pinnedReportItems = pinnedReports.map(mapReport);
  const bifrostRoutesUsingLegacyBlueprintId =
    legacyBifrostRoutes.map(mapBifrostRoute);
  const pinnedBifrostRouteItems = pinnedBifrostRoutes.map(mapBifrostRoute);
  const realmGatesUsingLegacyForgeBlueprintId =
    legacyRealmGates.map(mapRealmGate);
  const pinnedRealmGateItems = pinnedRealmGates.map(mapRealmGate);

  const ambiguous: AmbiguousBlueprintUsageInventoryItem[] = [
    ...ambiguousReports.map((row) => ({
      ...mapReport(row),
      reason: "Report has both legacy blueprintId and blueprintVersionId.",
    })),
    ...ambiguousBifrostRoutes.map((row) => ({
      ...mapBifrostRoute(row),
      reason:
        "Bifrost route has both legacy blueprintId and blueprintVersionId.",
    })),
    ...ambiguousRealmGates.map((row) => ({
      ...mapRealmGate(row),
      reason:
        "RealmGate has both legacy forgeBlueprintId and blueprintVersionId.",
    })),
  ];

  return {
    reportsUsingLegacyBlueprintId,
    bifrostRoutesUsingLegacyBlueprintId,
    realmGatesUsingLegacyForgeBlueprintId,
    pinnedReports: pinnedReportItems,
    pinnedBifrostRoutes: pinnedBifrostRouteItems,
    pinnedRealmGates: pinnedRealmGateItems,
    ambiguous,
    summary: {
      legacyReports: reportsUsingLegacyBlueprintId.length,
      legacyBifrostRoutes: bifrostRoutesUsingLegacyBlueprintId.length,
      legacyRealmGates: realmGatesUsingLegacyForgeBlueprintId.length,
      pinnedReports: pinnedReportItems.length,
      pinnedBifrostRoutes: pinnedBifrostRouteItems.length,
      pinnedRealmGates: pinnedRealmGateItems.length,
      ambiguousCount: ambiguous.length,
    },
  };
}
