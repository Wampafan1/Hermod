import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { calculateBlueprintStepsHash } from "@/lib/mjolnir/blueprint-version";
import {
  getLegacyBlueprintUsageInventory,
  type AmbiguousBlueprintUsageInventoryItem,
} from "@/lib/mjolnir/legacy-blueprint-usage-inventory";

export type VersionPinningBackfillConsumerType =
  | "report"
  | "bifrost_route"
  | "realm_gate";

export type VersionPinningBackfillAction =
  | "PIN_EXISTING_VERSION"
  | "PUBLISH_THEN_PIN"
  | "CREATE_BACKFILL_VERSION_THEN_PIN"
  | "PUBLISH_FORGE_BLUEPRINT_THEN_PIN";

export interface VersionPinningBackfillPlanInput {
  tenantId: string;
  userId: string;
}

export interface VersionPinningBackfillConsumer {
  type: VersionPinningBackfillConsumerType;
  id: string;
  name: string;
  tenantId: string | null;
  status: string | null;
  enabled: boolean | null;
  updatedAt: Date;
}

export interface VersionPinningBackfillSourceBlueprint {
  id: string;
  name: string;
  status: string;
  scope: string;
  tenantId: string | null;
  stepsHash: string | null;
}

export interface VersionPinningBackfillSourceForgeBlueprint {
  id: string;
  name: string | null;
  status: string;
  tenantId: string | null;
  routeId: string;
  currentVersion: number;
  sourceVersionId: string | null;
  sourceVersion: number | null;
  sourceStepsHash: string | null;
  sourceVersionLocked: boolean | null;
}

export interface VersionPinningBackfillVersionSummary {
  id: string;
  blueprintId: string;
  version: number;
  stepsHash: string;
  source: string;
  isLocked: boolean;
  createdAt: Date;
}

export interface VersionPinningBackfillPlanItem {
  consumer: VersionPinningBackfillConsumer;
  action: VersionPinningBackfillAction;
  reason: string;
  legacyBlueprintId: string | null;
  legacyForgeBlueprintId: string | null;
  targetBlueprintVersionId: string | null;
  sourceBlueprint: VersionPinningBackfillSourceBlueprint | null;
  sourceForgeBlueprint: VersionPinningBackfillSourceForgeBlueprint | null;
  existingPublishedBlueprintId: string | null;
  existingPublishedBlueprintName: string | null;
  existingVersion: VersionPinningBackfillVersionSummary | null;
}

export interface VersionPinningBackfillBlockedItem {
  consumer: VersionPinningBackfillConsumer;
  legacyBlueprintId: string | null;
  legacyForgeBlueprintId: string | null;
  reason: string;
  code:
    | "MISSING_BLUEPRINT"
    | "MISSING_FORGE_BLUEPRINT"
    | "ARCHIVED_BLUEPRINT"
    | "ARCHIVED_FORGE_BLUEPRINT"
    | "INVALID_BLUEPRINT_STATUS"
    | "INVALID_FORGE_BLUEPRINT_STATUS"
    | "OWNER_MISMATCH"
    | "TENANT_MISMATCH"
    | "MISSING_FORGE_VERSION";
}

export interface VersionPinningBackfillAmbiguousItem {
  consumer: VersionPinningBackfillConsumer;
  legacyBlueprintId: string | null;
  legacyForgeBlueprintId: string | null;
  blueprintVersionId: string | null;
  reason: string;
  tenantIds: string[];
}

export interface VersionPinningBackfillPlanSummary {
  safeToAutoPin: number;
  needsPublish: number;
  ambiguous: number;
  blocked: number;
  alreadyPinnedNoOp: number;
  legacyConsumersEvaluated: number;
}

export interface VersionPinningBackfillPlan {
  safeToAutoPin: VersionPinningBackfillPlanItem[];
  needsPublish: VersionPinningBackfillPlanItem[];
  ambiguous: VersionPinningBackfillAmbiguousItem[];
  blocked: VersionPinningBackfillBlockedItem[];
  summary: VersionPinningBackfillPlanSummary;
}

type VersionRow = {
  id: string;
  blueprintId: string;
  version: number;
  stepsHash: string;
  source: string;
  isLocked: boolean;
  createdAt: Date;
};

type PublishedCopyRow = {
  id: string;
  name: string;
  status: string;
  tenantId: string | null;
  versions: VersionRow[];
};

type BlueprintRow = {
  id: string;
  name: string;
  status: string;
  scope: string;
  tenantId: string | null;
  userId: string;
  steps: Prisma.JsonValue;
  versions: VersionRow[];
  publishedCopies: PublishedCopyRow[];
};

type LegacyReportRow = {
  id: string;
  name: string;
  tenantId: string | null;
  userId: string;
  blueprintId: string | null;
  blueprintVersionId: string | null;
  updatedAt: Date;
  schedule: { enabled: boolean } | null;
  blueprint: BlueprintRow | null;
};

type LegacyBifrostRouteRow = {
  id: string;
  name: string;
  tenantId: string | null;
  userId: string;
  enabled: boolean;
  blueprintId: string | null;
  blueprintVersionId: string | null;
  updatedAt: Date;
  blueprint: BlueprintRow | null;
};

type LegacyRealmGateRow = {
  id: string;
  name: string;
  tenantId: string;
  status: string;
  forgeBlueprintId: string | null;
  blueprintVersionId: string | null;
  updatedAt: Date;
  forgeBlueprint: {
    id: string;
    name: string | null;
    status: string;
    tenantId: string | null;
    routeId: string;
    currentVersion: number;
    route: {
      id: string;
      userId: string;
      tenantId: string | null;
    } | null;
    versions: {
      id: string;
      version: number;
      stepsHash: string;
      isLocked: boolean;
    }[];
  } | null;
};

type BlueprintUsageTenantRow = {
  blueprintId: string | null;
  tenantId: string | null;
};

type ForgeBlueprintUsageTenantRow = {
  forgeBlueprintId: string | null;
  tenantId: string | null;
};

const versionSelect = {
  id: true,
  blueprintId: true,
  version: true,
  stepsHash: true,
  source: true,
  isLocked: true,
  createdAt: true,
} satisfies Prisma.BlueprintVersionSelect;

const blueprintSelect = {
  id: true,
  name: true,
  status: true,
  scope: true,
  tenantId: true,
  userId: true,
  steps: true,
  versions: {
    where: {
      isLocked: true,
    },
    orderBy: {
      version: "desc",
    },
    take: 1,
    select: versionSelect,
  },
  publishedCopies: {
    where: {
      scope: "TENANT_PUBLISHED",
      status: { in: ["ACTIVE", "VALIDATED"] },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 2,
    select: {
      id: true,
      name: true,
      status: true,
      tenantId: true,
      versions: {
        where: {
          isLocked: true,
        },
        orderBy: {
          version: "desc",
        },
        take: 1,
        select: versionSelect,
      },
    },
  },
} satisfies Prisma.BlueprintSelect;

const reportSelect = {
  id: true,
  name: true,
  tenantId: true,
  userId: true,
  blueprintId: true,
  blueprintVersionId: true,
  updatedAt: true,
  schedule: {
    select: {
      enabled: true,
    },
  },
  blueprint: {
    select: blueprintSelect,
  },
} satisfies Prisma.ReportSelect;

const bifrostRouteSelect = {
  id: true,
  name: true,
  tenantId: true,
  userId: true,
  enabled: true,
  blueprintId: true,
  blueprintVersionId: true,
  updatedAt: true,
  blueprint: {
    select: blueprintSelect,
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
  forgeBlueprint: {
    select: {
      id: true,
      name: true,
      status: true,
      tenantId: true,
      routeId: true,
      currentVersion: true,
      route: {
        select: {
          id: true,
          userId: true,
          tenantId: true,
        },
      },
      versions: {
        orderBy: {
          version: "desc",
        },
        take: 1,
        select: {
          id: true,
          version: true,
          stepsHash: true,
          isLocked: true,
        },
      },
    },
  },
} satisfies Prisma.RealmGateSelect;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function tenantKey(tenantId: string | null): string {
  return tenantId ?? "NO_TENANT";
}

function versionSummary(version: VersionRow): VersionPinningBackfillVersionSummary {
  return {
    id: version.id,
    blueprintId: version.blueprintId,
    version: version.version,
    stepsHash: version.stepsHash,
    source: version.source,
    isLocked: version.isLocked,
    createdAt: version.createdAt,
  };
}

function reportConsumer(row: LegacyReportRow): VersionPinningBackfillConsumer {
  return {
    type: "report",
    id: row.id,
    name: row.name,
    tenantId: row.tenantId,
    status: null,
    enabled: row.schedule?.enabled ?? null,
    updatedAt: row.updatedAt,
  };
}

function bifrostConsumer(
  row: LegacyBifrostRouteRow,
): VersionPinningBackfillConsumer {
  return {
    type: "bifrost_route",
    id: row.id,
    name: row.name,
    tenantId: row.tenantId,
    status: null,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

function realmGateConsumer(
  row: LegacyRealmGateRow,
): VersionPinningBackfillConsumer {
  return {
    type: "realm_gate",
    id: row.id,
    name: row.name,
    tenantId: row.tenantId,
    status: row.status,
    enabled: null,
    updatedAt: row.updatedAt,
  };
}

function ambiguousInventoryConsumer(
  item: AmbiguousBlueprintUsageInventoryItem,
): VersionPinningBackfillConsumer {
  return {
    type: item.type,
    id: item.id,
    name: item.name,
    tenantId: item.tenantId,
    status: item.status,
    enabled: item.enabled,
    updatedAt: item.updatedAt,
  };
}

function blueprintSummary(
  blueprint: BlueprintRow,
): VersionPinningBackfillSourceBlueprint {
  return {
    id: blueprint.id,
    name: blueprint.name,
    status: blueprint.status,
    scope: blueprint.scope,
    tenantId: blueprint.tenantId,
    stepsHash: calculateBlueprintStepsHash(blueprint.steps),
  };
}

function forgeBlueprintSummary(
  forgeBlueprint: NonNullable<LegacyRealmGateRow["forgeBlueprint"]>,
): VersionPinningBackfillSourceForgeBlueprint {
  const latestVersion = forgeBlueprint.versions[0] ?? null;

  return {
    id: forgeBlueprint.id,
    name: forgeBlueprint.name,
    status: forgeBlueprint.status,
    tenantId: forgeBlueprint.tenantId,
    routeId: forgeBlueprint.routeId,
    currentVersion: forgeBlueprint.currentVersion,
    sourceVersionId: latestVersion?.id ?? null,
    sourceVersion: latestVersion?.version ?? null,
    sourceStepsHash: latestVersion?.stepsHash ?? null,
    sourceVersionLocked: latestVersion?.isLocked ?? null,
  };
}

function buildTenantMap(
  rows: BlueprintUsageTenantRow[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.blueprintId) {
      continue;
    }
    const tenants = map.get(row.blueprintId) ?? new Set<string>();
    tenants.add(tenantKey(row.tenantId));
    map.set(row.blueprintId, tenants);
  }

  return new Map(
    [...map.entries()].map(([blueprintId, tenantIds]) => [
      blueprintId,
      [...tenantIds].sort(),
    ]),
  );
}

function buildForgeTenantMap(
  rows: ForgeBlueprintUsageTenantRow[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.forgeBlueprintId) {
      continue;
    }
    const tenants = map.get(row.forgeBlueprintId) ?? new Set<string>();
    tenants.add(tenantKey(row.tenantId));
    map.set(row.forgeBlueprintId, tenants);
  }

  return new Map(
    [...map.entries()].map(([forgeBlueprintId, tenantIds]) => [
      forgeBlueprintId,
      [...tenantIds].sort(),
    ]),
  );
}

function pickPublishedVersion(input: {
  blueprint: BlueprintRow;
  tenantId: string;
}):
  | {
      kind: "version";
      parentId: string;
      parentName: string;
      version: VersionRow;
    }
  | {
      kind: "multiple_parents";
    }
  | {
      kind: "no_version";
      parentId: string | null;
      parentName: string | null;
    } {
  if (
    input.blueprint.scope === "TENANT_PUBLISHED" &&
    input.blueprint.tenantId === input.tenantId
  ) {
    const version = input.blueprint.versions[0] ?? null;
    return version
      ? {
          kind: "version",
          parentId: input.blueprint.id,
          parentName: input.blueprint.name,
          version,
        }
      : {
          kind: "no_version",
          parentId: input.blueprint.id,
          parentName: input.blueprint.name,
        };
  }

  const tenantCopies = input.blueprint.publishedCopies.filter(
    (copy) => copy.tenantId === input.tenantId,
  );

  if (tenantCopies.length > 1) {
    return { kind: "multiple_parents" };
  }

  const copy = tenantCopies[0] ?? null;
  if (!copy) {
    return {
      kind: "no_version",
      parentId: null,
      parentName: null,
    };
  }

  const version = copy.versions[0] ?? null;
  return version
    ? {
        kind: "version",
        parentId: copy.id,
        parentName: copy.name,
        version,
      }
    : {
        kind: "no_version",
        parentId: copy.id,
        parentName: copy.name,
      };
}

function blockedBlueprintItem(input: {
  consumer: VersionPinningBackfillConsumer;
  blueprintId: string | null;
  reason: string;
  code: VersionPinningBackfillBlockedItem["code"];
}): VersionPinningBackfillBlockedItem {
  return {
    consumer: input.consumer,
    legacyBlueprintId: input.blueprintId,
    legacyForgeBlueprintId: null,
    reason: input.reason,
    code: input.code,
  };
}

function blockedForgeItem(input: {
  consumer: VersionPinningBackfillConsumer;
  forgeBlueprintId: string | null;
  reason: string;
  code: VersionPinningBackfillBlockedItem["code"];
}): VersionPinningBackfillBlockedItem {
  return {
    consumer: input.consumer,
    legacyBlueprintId: null,
    legacyForgeBlueprintId: input.forgeBlueprintId,
    reason: input.reason,
    code: input.code,
  };
}

function planBlueprintConsumer(input: {
  consumer: VersionPinningBackfillConsumer;
  legacyBlueprintId: string | null;
  blueprint: BlueprintRow | null;
  tenantIds: string[];
  tenantId: string;
  userId: string;
}):
  | { bucket: "safeToAutoPin"; item: VersionPinningBackfillPlanItem }
  | { bucket: "needsPublish"; item: VersionPinningBackfillPlanItem }
  | { bucket: "ambiguous"; item: VersionPinningBackfillAmbiguousItem }
  | { bucket: "blocked"; item: VersionPinningBackfillBlockedItem } {
  const { consumer, legacyBlueprintId, blueprint } = input;

  if (!legacyBlueprintId || !blueprint) {
    return {
      bucket: "blocked",
      item: blockedBlueprintItem({
        consumer,
        blueprintId: legacyBlueprintId,
        reason: "Legacy blueprint could not be found.",
        code: "MISSING_BLUEPRINT",
      }),
    };
  }

  if (input.tenantIds.length > 1) {
    return {
      bucket: "ambiguous",
      item: {
        consumer,
        legacyBlueprintId,
        legacyForgeBlueprintId: null,
        blueprintVersionId: null,
        reason: "Legacy blueprint is attached across multiple tenants.",
        tenantIds: input.tenantIds,
      },
    };
  }

  if (blueprint.status === "ARCHIVED") {
    return {
      bucket: "blocked",
      item: blockedBlueprintItem({
        consumer,
        blueprintId: legacyBlueprintId,
        reason: "Archived blueprints cannot be backfilled automatically.",
        code: "ARCHIVED_BLUEPRINT",
      }),
    };
  }

  if (!["ACTIVE", "VALIDATED"].includes(blueprint.status)) {
    return {
      bucket: "blocked",
      item: blockedBlueprintItem({
        consumer,
        blueprintId: legacyBlueprintId,
        reason: `Blueprint status ${blueprint.status} is not publishable without review.`,
        code: "INVALID_BLUEPRINT_STATUS",
      }),
    };
  }

  if (blueprint.userId !== input.userId) {
    return {
      bucket: "blocked",
      item: blockedBlueprintItem({
        consumer,
        blueprintId: legacyBlueprintId,
        reason: "Legacy blueprint owner does not match the active user.",
        code: "OWNER_MISMATCH",
      }),
    };
  }

  if (
    blueprint.scope === "TENANT_PUBLISHED" &&
    blueprint.tenantId !== input.tenantId
  ) {
    return {
      bucket: "blocked",
      item: blockedBlueprintItem({
        consumer,
        blueprintId: legacyBlueprintId,
        reason: "Tenant-published blueprint belongs to a different tenant.",
        code: "TENANT_MISMATCH",
      }),
    };
  }

  const publishedVersion = pickPublishedVersion({
    blueprint,
    tenantId: input.tenantId,
  });

  if (publishedVersion.kind === "multiple_parents") {
    return {
      bucket: "ambiguous",
      item: {
        consumer,
        legacyBlueprintId,
        legacyForgeBlueprintId: null,
        blueprintVersionId: null,
        reason:
          "Multiple tenant-published parents exist for this legacy blueprint.",
        tenantIds: [input.tenantId],
      },
    };
  }

  if (publishedVersion.kind === "version") {
    return {
      bucket: "safeToAutoPin",
      item: {
        consumer,
        action: "PIN_EXISTING_VERSION",
        reason: "A locked tenant-published BlueprintVersion already exists.",
        legacyBlueprintId,
        legacyForgeBlueprintId: null,
        targetBlueprintVersionId: publishedVersion.version.id,
        sourceBlueprint: blueprintSummary(blueprint),
        sourceForgeBlueprint: null,
        existingPublishedBlueprintId: publishedVersion.parentId,
        existingPublishedBlueprintName: publishedVersion.parentName,
        existingVersion: versionSummary(publishedVersion.version),
      },
    };
  }

  return {
    bucket: "needsPublish",
    item: {
      consumer,
      action: publishedVersion.parentId
        ? "CREATE_BACKFILL_VERSION_THEN_PIN"
        : "PUBLISH_THEN_PIN",
      reason: publishedVersion.parentId
        ? "A tenant-published parent exists, but no locked version is available."
        : "Legacy blueprint is valid but must be published before pinning.",
      legacyBlueprintId,
      legacyForgeBlueprintId: null,
      targetBlueprintVersionId: null,
      sourceBlueprint: blueprintSummary(blueprint),
      sourceForgeBlueprint: null,
      existingPublishedBlueprintId: publishedVersion.parentId,
      existingPublishedBlueprintName: publishedVersion.parentName,
      existingVersion: null,
    },
  };
}

function planForgeConsumer(input: {
  consumer: VersionPinningBackfillConsumer;
  legacyForgeBlueprintId: string | null;
  forgeBlueprint: LegacyRealmGateRow["forgeBlueprint"];
  tenantIds: string[];
  tenantId: string;
  userId: string;
}):
  | { bucket: "needsPublish"; item: VersionPinningBackfillPlanItem }
  | { bucket: "ambiguous"; item: VersionPinningBackfillAmbiguousItem }
  | { bucket: "blocked"; item: VersionPinningBackfillBlockedItem } {
  const { consumer, legacyForgeBlueprintId, forgeBlueprint } = input;

  if (!legacyForgeBlueprintId || !forgeBlueprint) {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: "Legacy Forge blueprint could not be found.",
        code: "MISSING_FORGE_BLUEPRINT",
      }),
    };
  }

  if (input.tenantIds.length > 1) {
    return {
      bucket: "ambiguous",
      item: {
        consumer,
        legacyBlueprintId: null,
        legacyForgeBlueprintId,
        blueprintVersionId: null,
        reason: "Legacy Forge blueprint is attached across multiple tenants.",
        tenantIds: input.tenantIds,
      },
    };
  }

  if (forgeBlueprint.status === "ARCHIVED") {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: "Archived Forge blueprints cannot be backfilled automatically.",
        code: "ARCHIVED_FORGE_BLUEPRINT",
      }),
    };
  }

  if (forgeBlueprint.status !== "ACTIVE") {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: `Forge blueprint status ${forgeBlueprint.status} is not publishable without review.`,
        code: "INVALID_FORGE_BLUEPRINT_STATUS",
      }),
    };
  }

  if (forgeBlueprint.tenantId && forgeBlueprint.tenantId !== input.tenantId) {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: "Forge blueprint belongs to a different tenant.",
        code: "TENANT_MISMATCH",
      }),
    };
  }

  if (
    !forgeBlueprint.route ||
    forgeBlueprint.route.userId !== input.userId ||
    forgeBlueprint.route.tenantId !== input.tenantId
  ) {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: "Forge blueprint route owner does not match the active user.",
        code: "OWNER_MISMATCH",
      }),
    };
  }

  if (!forgeBlueprint.versions[0]) {
    return {
      bucket: "blocked",
      item: blockedForgeItem({
        consumer,
        forgeBlueprintId: legacyForgeBlueprintId,
        reason: "Forge blueprint has no version snapshot to publish from.",
        code: "MISSING_FORGE_VERSION",
      }),
    };
  }

  return {
    bucket: "needsPublish",
    item: {
      consumer,
      action: "PUBLISH_FORGE_BLUEPRINT_THEN_PIN",
      reason:
        "Legacy RealmGate Forge blueprint must be converted to a tenant-published BlueprintVersion before pinning.",
      legacyBlueprintId: null,
      legacyForgeBlueprintId,
      targetBlueprintVersionId: null,
      sourceBlueprint: null,
      sourceForgeBlueprint: forgeBlueprintSummary(forgeBlueprint),
      existingPublishedBlueprintId: null,
      existingPublishedBlueprintName: null,
      existingVersion: null,
    },
  };
}

function pushPlanResult(
  plan: VersionPinningBackfillPlan,
  result:
    | { bucket: "safeToAutoPin"; item: VersionPinningBackfillPlanItem }
    | { bucket: "needsPublish"; item: VersionPinningBackfillPlanItem }
    | { bucket: "ambiguous"; item: VersionPinningBackfillAmbiguousItem }
    | { bucket: "blocked"; item: VersionPinningBackfillBlockedItem },
) {
  if (result.bucket === "safeToAutoPin") {
    plan.safeToAutoPin.push(result.item);
  } else if (result.bucket === "needsPublish") {
    plan.needsPublish.push(result.item);
  } else if (result.bucket === "ambiguous") {
    plan.ambiguous.push(result.item);
  } else {
    plan.blocked.push(result.item);
  }
}

function mapInventoryAmbiguous(
  item: AmbiguousBlueprintUsageInventoryItem,
): VersionPinningBackfillAmbiguousItem {
  return {
    consumer: ambiguousInventoryConsumer(item),
    legacyBlueprintId: item.blueprintId,
    legacyForgeBlueprintId: item.forgeBlueprintId,
    blueprintVersionId: item.blueprintVersionId,
    reason: item.reason,
    tenantIds: item.tenantId ? [item.tenantId] : [],
  };
}

export async function buildVersionPinningBackfillPlan(
  input: VersionPinningBackfillPlanInput,
): Promise<VersionPinningBackfillPlan> {
  const inventory = await getLegacyBlueprintUsageInventory(input);

  const [legacyReports, legacyBifrostRoutes, legacyRealmGates] =
    await Promise.all([
      prisma.report.findMany({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          blueprintId: { not: null },
          blueprintVersionId: null,
        },
        orderBy: { updatedAt: "desc" },
        select: reportSelect,
      }),
      prisma.bifrostRoute.findMany({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          blueprintId: { not: null },
          blueprintVersionId: null,
        },
        orderBy: { updatedAt: "desc" },
        select: bifrostRouteSelect,
      }),
      prisma.realmGate.findMany({
        where: {
          tenantId: input.tenantId,
          forgeBlueprintId: { not: null },
          blueprintVersionId: null,
        },
        orderBy: { updatedAt: "desc" },
        select: realmGateSelect,
      }),
    ]);

  const blueprintIds = unique(
    [...legacyReports, ...legacyBifrostRoutes]
      .map((row) => row.blueprintId)
      .filter((id): id is string => Boolean(id)),
  );
  const forgeBlueprintIds = unique(
    legacyRealmGates
      .map((row) => row.forgeBlueprintId)
      .filter((id): id is string => Boolean(id)),
  );

  const [reportTenantUsage, bifrostTenantUsage, forgeTenantUsage] =
    await Promise.all([
      blueprintIds.length
        ? prisma.report.findMany({
            where: { blueprintId: { in: blueprintIds } },
            select: { blueprintId: true, tenantId: true },
          })
        : Promise.resolve([] as BlueprintUsageTenantRow[]),
      blueprintIds.length
        ? prisma.bifrostRoute.findMany({
            where: { blueprintId: { in: blueprintIds } },
            select: { blueprintId: true, tenantId: true },
          })
        : Promise.resolve([] as BlueprintUsageTenantRow[]),
      forgeBlueprintIds.length
        ? prisma.realmGate.findMany({
            where: { forgeBlueprintId: { in: forgeBlueprintIds } },
            select: { forgeBlueprintId: true, tenantId: true },
          })
        : Promise.resolve([] as ForgeBlueprintUsageTenantRow[]),
    ]);

  const blueprintTenantMap = buildTenantMap([
    ...reportTenantUsage,
    ...bifrostTenantUsage,
  ]);
  const forgeTenantMap = buildForgeTenantMap(forgeTenantUsage);

  const plan: VersionPinningBackfillPlan = {
    safeToAutoPin: [],
    needsPublish: [],
    ambiguous: inventory.ambiguous.map(mapInventoryAmbiguous),
    blocked: [],
    summary: {
      safeToAutoPin: 0,
      needsPublish: 0,
      ambiguous: 0,
      blocked: 0,
      alreadyPinnedNoOp:
        inventory.pinnedReports.length +
        inventory.pinnedBifrostRoutes.length +
        inventory.pinnedRealmGates.length,
      legacyConsumersEvaluated:
        legacyReports.length + legacyBifrostRoutes.length + legacyRealmGates.length,
    },
  };

  for (const report of legacyReports) {
    pushPlanResult(
      plan,
      planBlueprintConsumer({
        consumer: reportConsumer(report),
        legacyBlueprintId: report.blueprintId,
        blueprint: report.blueprint,
        tenantIds: blueprintTenantMap.get(report.blueprintId ?? "") ?? [],
        tenantId: input.tenantId,
        userId: input.userId,
      }),
    );
  }

  for (const route of legacyBifrostRoutes) {
    pushPlanResult(
      plan,
      planBlueprintConsumer({
        consumer: bifrostConsumer(route),
        legacyBlueprintId: route.blueprintId,
        blueprint: route.blueprint,
        tenantIds: blueprintTenantMap.get(route.blueprintId ?? "") ?? [],
        tenantId: input.tenantId,
        userId: input.userId,
      }),
    );
  }

  for (const gate of legacyRealmGates) {
    pushPlanResult(
      plan,
      planForgeConsumer({
        consumer: realmGateConsumer(gate),
        legacyForgeBlueprintId: gate.forgeBlueprintId,
        forgeBlueprint: gate.forgeBlueprint,
        tenantIds: forgeTenantMap.get(gate.forgeBlueprintId ?? "") ?? [],
        tenantId: input.tenantId,
        userId: input.userId,
      }),
    );
  }

  plan.summary.safeToAutoPin = plan.safeToAutoPin.length;
  plan.summary.needsPublish = plan.needsPublish.length;
  plan.summary.ambiguous = plan.ambiguous.length;
  plan.summary.blocked = plan.blocked.length;

  return plan;
}
