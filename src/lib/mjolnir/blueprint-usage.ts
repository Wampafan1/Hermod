import { prisma } from "@/lib/db";

export interface BlueprintUsageItem {
  id: string;
  type: "report" | "bifrost_route";
  name: string;
  tenantId: string | null;
  tenantName?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  updatedAt?: string | Date | null;
}

export interface BlueprintUsageSummary {
  blueprintId: string;
  total: number;
  reports: BlueprintUsageItem[];
  bifrostRoutes: BlueprintUsageItem[];
}

export interface BlueprintVersionUsageItem {
  id: string;
  type: "report" | "bifrost_route" | "realm_gate";
  name: string;
  tenantId: string | null;
  tenantName?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  updatedAt?: string | Date | null;
}

export interface BlueprintVersionUsageSummary {
  blueprintVersionId: string;
  total: number;
  reports: BlueprintVersionUsageItem[];
  bifrostRoutes: BlueprintVersionUsageItem[];
  realmGates: BlueprintVersionUsageItem[];
}

export async function getBlueprintUsage(input: {
  blueprintId: string;
  userId: string;
}): Promise<BlueprintUsageSummary> {
  const [reports, bifrostRoutes] = await Promise.all([
    prisma.report.findMany({
      where: {
        blueprintId: input.blueprintId,
        userId: input.userId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        updatedAt: true,
        tenant: { select: { name: true } },
        schedule: { select: { enabled: true } },
      },
    }),
    prisma.bifrostRoute.findMany({
      where: {
        blueprintId: input.blueprintId,
        userId: input.userId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        enabled: true,
        updatedAt: true,
        tenant: { select: { name: true } },
      },
    }),
  ]);

  const reportItems: BlueprintUsageItem[] = reports.map((report) => ({
    id: report.id,
    type: "report",
    name: report.name,
    tenantId: report.tenantId,
    tenantName: report.tenant?.name ?? null,
    status: null,
    enabled: report.schedule?.enabled ?? null,
    updatedAt: report.updatedAt,
  }));

  const routeItems: BlueprintUsageItem[] = bifrostRoutes.map((route) => ({
    id: route.id,
    type: "bifrost_route",
    name: route.name,
    tenantId: route.tenantId,
    tenantName: route.tenant?.name ?? null,
    status: null,
    enabled: route.enabled,
    updatedAt: route.updatedAt,
  }));

  return {
    blueprintId: input.blueprintId,
    total: reportItems.length + routeItems.length,
    reports: reportItems,
    bifrostRoutes: routeItems,
  };
}

export async function getBlueprintVersionUsage(input: {
  blueprintVersionId: string;
  tenantId: string;
}): Promise<BlueprintVersionUsageSummary> {
  const [reports, bifrostRoutes, realmGates] = await Promise.all([
    prisma.report.findMany({
      where: {
        blueprintVersionId: input.blueprintVersionId,
        tenantId: input.tenantId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        updatedAt: true,
        tenant: { select: { name: true } },
        schedule: { select: { enabled: true } },
      },
    }),
    prisma.bifrostRoute.findMany({
      where: {
        blueprintVersionId: input.blueprintVersionId,
        tenantId: input.tenantId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        enabled: true,
        updatedAt: true,
        tenant: { select: { name: true } },
      },
    }),
    prisma.realmGate.findMany({
      where: {
        blueprintVersionId: input.blueprintVersionId,
        tenantId: input.tenantId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        status: true,
        updatedAt: true,
        tenant: { select: { name: true } },
      },
    }),
  ]);

  const reportItems: BlueprintVersionUsageItem[] = reports.map((report) => ({
    id: report.id,
    type: "report",
    name: report.name,
    tenantId: report.tenantId,
    tenantName: report.tenant?.name ?? null,
    status: null,
    enabled: report.schedule?.enabled ?? null,
    updatedAt: report.updatedAt,
  }));

  const routeItems: BlueprintVersionUsageItem[] = bifrostRoutes.map((route) => ({
    id: route.id,
    type: "bifrost_route",
    name: route.name,
    tenantId: route.tenantId,
    tenantName: route.tenant?.name ?? null,
    status: null,
    enabled: route.enabled,
    updatedAt: route.updatedAt,
  }));

  const gateItems: BlueprintVersionUsageItem[] = realmGates.map((gate) => ({
    id: gate.id,
    type: "realm_gate",
    name: gate.name,
    tenantId: gate.tenantId,
    tenantName: gate.tenant?.name ?? null,
    status: gate.status,
    enabled: null,
    updatedAt: gate.updatedAt,
  }));

  return {
    blueprintVersionId: input.blueprintVersionId,
    total: reportItems.length + routeItems.length + gateItems.length,
    reports: reportItems,
    bifrostRoutes: routeItems,
    realmGates: gateItems,
  };
}
