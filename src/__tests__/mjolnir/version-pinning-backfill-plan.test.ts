import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReportFindMany,
  mockBifrostRouteFindMany,
  mockRealmGateFindMany,
} = vi.hoisted(() => ({
  mockReportFindMany: vi.fn(),
  mockBifrostRouteFindMany: vi.fn(),
  mockRealmGateFindMany: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    report: {
      findMany: mockReportFindMany,
    },
    bifrostRoute: {
      findMany: mockBifrostRouteFindMany,
    },
    realmGate: {
      findMany: mockRealmGateFindMany,
    },
  },
}));

import { calculateBlueprintStepsHash } from "@/lib/mjolnir/blueprint-version";
import { buildVersionPinningBackfillPlan } from "@/lib/mjolnir/version-pinning-backfill-plan";

const updatedAt = new Date("2026-05-11T12:00:00.000Z");

type MockState = {
  legacyReports: any[];
  pinnedReports: any[];
  ambiguousReports: any[];
  reportTenantUsage: any[];
  legacyBifrostRoutes: any[];
  pinnedBifrostRoutes: any[];
  ambiguousBifrostRoutes: any[];
  bifrostTenantUsage: any[];
  legacyRealmGates: any[];
  pinnedRealmGates: any[];
  ambiguousRealmGates: any[];
  forgeTenantUsage: any[];
};

const state: MockState = {
  legacyReports: [],
  pinnedReports: [],
  ambiguousReports: [],
  reportTenantUsage: [],
  legacyBifrostRoutes: [],
  pinnedBifrostRoutes: [],
  ambiguousBifrostRoutes: [],
  bifrostTenantUsage: [],
  legacyRealmGates: [],
  pinnedRealmGates: [],
  ambiguousRealmGates: [],
  forgeTenantUsage: [],
};

function resetState() {
  state.legacyReports = [];
  state.pinnedReports = [];
  state.ambiguousReports = [];
  state.reportTenantUsage = [];
  state.legacyBifrostRoutes = [];
  state.pinnedBifrostRoutes = [];
  state.ambiguousBifrostRoutes = [];
  state.bifrostTenantUsage = [];
  state.legacyRealmGates = [];
  state.pinnedRealmGates = [];
  state.ambiguousRealmGates = [];
  state.forgeTenantUsage = [];
}

function isNotNullFilter(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    "not" in value &&
    (value as { not: unknown }).not === null
  );
}

function isInFilter(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    "in" in value &&
    Array.isArray((value as { in: unknown }).in)
  );
}

function version(id: string, blueprintId = "bp_published") {
  return {
    id,
    blueprintId,
    version: 2,
    stepsHash: `hash_${id}`,
    source: "BACKFILL",
    isLocked: true,
    createdAt: updatedAt,
    blueprint: {
      name: `Published ${id}`,
      status: "ACTIVE",
    },
    steps: [{ secret: "raw_steps_should_not_leak" }],
  };
}

function blueprint(overrides: Record<string, unknown> = {}) {
  const steps = [{ order: 0, type: "rename_columns", secret: "raw_blueprint_steps" }];

  return {
    id: "bp_legacy",
    name: "Legacy Blueprint",
    status: "VALIDATED",
    scope: "PERSONAL_DRAFT",
    tenantId: null,
    userId: "user_1",
    steps,
    versions: [],
    publishedCopies: [],
    analysisLog: { secret: "analysis_should_not_leak" },
    ...overrides,
  };
}

function publishedCopy(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_published",
    name: "Published Blueprint",
    status: "ACTIVE",
    tenantId: "tenant_1",
    versions: [version("bv_existing", "bp_published")],
    ...overrides,
  };
}

function legacyReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report_1",
    name: "Legacy Report",
    tenantId: "tenant_1",
    userId: "user_1",
    blueprintId: "bp_legacy",
    blueprintVersionId: null,
    updatedAt,
    schedule: { enabled: true },
    blueprint: blueprint(),
    sqlQuery: "select secret from credentials",
    ...overrides,
  };
}

function pinnedReport(overrides: Record<string, unknown> = {}) {
  return {
    ...legacyReport({
      id: "report_pinned",
      blueprintId: null,
      blueprintVersionId: "bv_report",
      blueprint: null,
    }),
    blueprintVersion: version("bv_report", "bp_published"),
    ...overrides,
  };
}

function legacyBifrostRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: "route_1",
    name: "Legacy Route",
    tenantId: "tenant_1",
    userId: "user_1",
    enabled: true,
    blueprintId: "bp_route",
    blueprintVersionId: null,
    updatedAt,
    blueprint: blueprint({ id: "bp_route", name: "Route Blueprint" }),
    sourceConfig: { password: "route_secret" },
    destConfig: { password: "dest_secret" },
    ...overrides,
  };
}

function legacyRealmGate(overrides: Record<string, unknown> = {}) {
  return {
    id: "gate_1",
    name: "Legacy Gate",
    tenantId: "tenant_1",
    status: "ACTIVE",
    forgeBlueprintId: "forge_1",
    blueprintVersionId: null,
    updatedAt,
    forgeBlueprint: {
      id: "forge_1",
      name: "Legacy Forge Blueprint",
      status: "ACTIVE",
      tenantId: "tenant_1",
      routeId: "route_forge",
      currentVersion: 1,
      route: {
        id: "route_forge",
        userId: "user_1",
        tenantId: "tenant_1",
      },
      versions: [{
        id: "forge_version_1",
        version: 1,
        stepsHash: "forge_hash_1",
        isLocked: true,
        steps: [{ secret: "forge_steps_should_not_leak" }],
      }],
    },
    columnMapping: { password: "gate_secret" },
    ...overrides,
  };
}

function installFindManyMocks() {
  mockReportFindMany.mockImplementation(async ({ where }) => {
    if (isInFilter(where.blueprintId)) {
      return state.reportTenantUsage.length
        ? state.reportTenantUsage
        : state.legacyReports.map((row) => ({
            blueprintId: row.blueprintId,
            tenantId: row.tenantId,
          }));
    }
    if (isNotNullFilter(where.blueprintId) && where.blueprintVersionId === null) {
      return state.legacyReports;
    }
    if (where.blueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return state.pinnedReports;
    }
    if (isNotNullFilter(where.blueprintId) && isNotNullFilter(where.blueprintVersionId)) {
      return state.ambiguousReports;
    }
    return [];
  });

  mockBifrostRouteFindMany.mockImplementation(async ({ where }) => {
    if (isInFilter(where.blueprintId)) {
      return state.bifrostTenantUsage.length
        ? state.bifrostTenantUsage
        : state.legacyBifrostRoutes.map((row) => ({
            blueprintId: row.blueprintId,
            tenantId: row.tenantId,
          }));
    }
    if (isNotNullFilter(where.blueprintId) && where.blueprintVersionId === null) {
      return state.legacyBifrostRoutes;
    }
    if (where.blueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return state.pinnedBifrostRoutes;
    }
    if (isNotNullFilter(where.blueprintId) && isNotNullFilter(where.blueprintVersionId)) {
      return state.ambiguousBifrostRoutes;
    }
    return [];
  });

  mockRealmGateFindMany.mockImplementation(async ({ where }) => {
    if (isInFilter(where.forgeBlueprintId)) {
      return state.forgeTenantUsage.length
        ? state.forgeTenantUsage
        : state.legacyRealmGates.map((row) => ({
            forgeBlueprintId: row.forgeBlueprintId,
            tenantId: row.tenantId,
          }));
    }
    if (isNotNullFilter(where.forgeBlueprintId) && where.blueprintVersionId === null) {
      return state.legacyRealmGates;
    }
    if (where.forgeBlueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return state.pinnedRealmGates;
    }
    if (
      isNotNullFilter(where.forgeBlueprintId) &&
      isNotNullFilter(where.blueprintVersionId)
    ) {
      return state.ambiguousRealmGates;
    }
    return [];
  });
}

describe("buildVersionPinningBackfillPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    installFindManyMocks();
  });

  it("plans a safe single-tenant legacy report for existing version auto-pin", async () => {
    const sourceBlueprint = blueprint({
      publishedCopies: [publishedCopy()],
    });
    state.legacyReports = [legacyReport({ blueprint: sourceBlueprint })];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.safeToAutoPin).toHaveLength(1);
    expect(plan.safeToAutoPin[0]).toMatchObject({
      action: "PIN_EXISTING_VERSION",
      legacyBlueprintId: "bp_legacy",
      targetBlueprintVersionId: "bv_existing",
      existingPublishedBlueprintId: "bp_published",
      sourceBlueprint: {
        id: "bp_legacy",
        status: "VALIDATED",
        stepsHash: calculateBlueprintStepsHash(sourceBlueprint.steps),
      },
    });
    expect(plan.summary).toMatchObject({
      safeToAutoPin: 1,
      legacyConsumersEvaluated: 1,
    });
  });

  it("plans a valid single-tenant legacy Bifrost route for publish before pin", async () => {
    state.legacyBifrostRoutes = [legacyBifrostRoute()];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.needsPublish).toHaveLength(1);
    expect(plan.needsPublish[0]).toMatchObject({
      action: "PUBLISH_THEN_PIN",
      legacyBlueprintId: "bp_route",
      consumer: {
        type: "bifrost_route",
        id: "route_1",
      },
    });
  });

  it("plans a valid single-tenant RealmGate Forge blueprint for publish before pin", async () => {
    state.legacyRealmGates = [legacyRealmGate()];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.needsPublish).toHaveLength(1);
    expect(plan.needsPublish[0]).toMatchObject({
      action: "PUBLISH_FORGE_BLUEPRINT_THEN_PIN",
      legacyForgeBlueprintId: "forge_1",
      sourceForgeBlueprint: {
        id: "forge_1",
        sourceVersionId: "forge_version_1",
        sourceStepsHash: "forge_hash_1",
      },
    });
  });

  it("flags legacy blueprints attached across multiple tenants as ambiguous", async () => {
    state.legacyReports = [legacyReport()];
    state.reportTenantUsage = [
      { blueprintId: "bp_legacy", tenantId: "tenant_1" },
      { blueprintId: "bp_legacy", tenantId: "tenant_2" },
    ];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.ambiguous).toEqual([
      expect.objectContaining({
        legacyBlueprintId: "bp_legacy",
        reason: "Legacy blueprint is attached across multiple tenants.",
        tenantIds: ["tenant_1", "tenant_2"],
      }),
    ]);
    expect(plan.safeToAutoPin).toHaveLength(0);
    expect(plan.needsPublish).toHaveLength(0);
  });

  it("blocks missing, archived, invalid, and owner-mismatched blueprints", async () => {
    state.legacyReports = [
      legacyReport({
        id: "report_missing",
        blueprintId: "bp_missing",
        blueprint: null,
      }),
      legacyReport({
        id: "report_archived",
        blueprintId: "bp_archived",
        blueprint: blueprint({ id: "bp_archived", status: "ARCHIVED" }),
      }),
      legacyReport({
        id: "report_draft",
        blueprintId: "bp_draft",
        blueprint: blueprint({ id: "bp_draft", status: "DRAFT" }),
      }),
      legacyReport({
        id: "report_owner",
        blueprintId: "bp_owner",
        blueprint: blueprint({ id: "bp_owner", userId: "user_2" }),
      }),
    ];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_BLUEPRINT" }),
        expect.objectContaining({ code: "ARCHIVED_BLUEPRINT" }),
        expect.objectContaining({ code: "INVALID_BLUEPRINT_STATUS" }),
        expect.objectContaining({ code: "OWNER_MISMATCH" }),
      ]),
    );
    expect(plan.blocked).toHaveLength(4);
  });

  it("counts already pinned attachments as no-op and excludes them from action buckets", async () => {
    state.pinnedReports = [pinnedReport()];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(plan.safeToAutoPin).toHaveLength(0);
    expect(plan.needsPublish).toHaveLength(0);
    expect(plan.blocked).toHaveLength(0);
    expect(plan.summary).toMatchObject({
      alreadyPinnedNoOp: 1,
      legacyConsumersEvaluated: 0,
    });
  });

  it("does not expose raw steps, SQL, route configs, gate mappings, or analysis logs", async () => {
    state.legacyReports = [legacyReport()];
    state.legacyBifrostRoutes = [legacyBifrostRoute()];
    state.legacyRealmGates = [legacyRealmGate()];

    const plan = await buildVersionPinningBackfillPlan({
      tenantId: "tenant_1",
      userId: "user_1",
    });
    const serialized = JSON.stringify(plan);

    expect(serialized).not.toContain("raw_blueprint_steps");
    expect(serialized).not.toContain("raw_steps_should_not_leak");
    expect(serialized).not.toContain("analysis_should_not_leak");
    expect(serialized).not.toContain("select secret");
    expect(serialized).not.toContain("route_secret");
    expect(serialized).not.toContain("dest_secret");
    expect(serialized).not.toContain("gate_secret");
    expect(serialized).not.toContain("forge_steps_should_not_leak");
  });

  it("exposes the dry-run plan through the active tenant API route", async () => {
    state.legacyReports = [legacyReport({ blueprint: blueprint({ publishedCopies: [publishedCopy()] }) })];
    const { GET } = await import(
      "@/app/api/mjolnir/version-pinning/backfill-plan/route"
    );

    const response = await GET(
      new Request("http://localhost/api/mjolnir/version-pinning/backfill-plan"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.safeToAutoPin).toBe(1);
    expect(JSON.stringify(body)).not.toContain("raw_blueprint_steps");
  });
});
