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

import { getLegacyBlueprintUsageInventory } from "@/lib/mjolnir/legacy-blueprint-usage-inventory";

const updatedAt = new Date("2026-05-11T12:00:00.000Z");

function isNotNullFilter(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    "not" in value &&
    (value as { not: unknown }).not === null
  );
}

function versionSummary(id: string) {
  return {
    id: `bv_${id}`,
    blueprintId: `bp_${id}`,
    version: 3,
    stepsHash: `hash_${id}`,
    blueprint: {
      name: `Published ${id}`,
      status: "ACTIVE",
    },
    steps: [{ rawSecret: "raw_steps_should_not_leak" }],
    analysisLog: { secret: "analysis_should_not_leak" },
  };
}

const legacyReport = {
  id: "report_legacy",
  name: "Legacy Report",
  tenantId: "tenant_1",
  blueprintId: "bp_legacy_report",
  blueprintVersionId: null,
  updatedAt,
  tenant: { name: "North Realm" },
  schedule: { enabled: true },
  blueprint: { name: "Legacy Blueprint" },
  blueprintVersion: null,
  query: "select password from secret_table",
};

const pinnedReport = {
  ...legacyReport,
  id: "report_pinned",
  name: "Pinned Report",
  blueprintId: null,
  blueprintVersionId: "bv_report",
  blueprint: null,
  blueprintVersion: versionSummary("report"),
};

const ambiguousReport = {
  ...legacyReport,
  id: "report_ambiguous",
  name: "Ambiguous Report",
  blueprintVersionId: "bv_report_ambiguous",
  blueprintVersion: versionSummary("report_ambiguous"),
};

const legacyBifrostRoute = {
  id: "route_legacy",
  name: "Legacy Route",
  tenantId: "tenant_1",
  blueprintId: "bp_legacy_route",
  blueprintVersionId: null,
  enabled: true,
  updatedAt,
  tenant: { name: "North Realm" },
  blueprint: { name: "Legacy Route Blueprint" },
  blueprintVersion: null,
  sourceConfig: { password: "route_secret" },
};

const pinnedBifrostRoute = {
  ...legacyBifrostRoute,
  id: "route_pinned",
  name: "Pinned Route",
  blueprintId: null,
  blueprintVersionId: "bv_route",
  blueprint: null,
  blueprintVersion: versionSummary("route"),
};

const ambiguousBifrostRoute = {
  ...legacyBifrostRoute,
  id: "route_ambiguous",
  name: "Ambiguous Route",
  blueprintVersionId: "bv_route_ambiguous",
  blueprintVersion: versionSummary("route_ambiguous"),
};

const legacyRealmGate = {
  id: "gate_legacy",
  name: "Legacy Gate",
  tenantId: "tenant_1",
  status: "ACTIVE",
  forgeBlueprintId: "forge_legacy",
  blueprintVersionId: null,
  updatedAt,
  tenant: { name: "North Realm" },
  forgeBlueprint: { name: "Legacy Forge Blueprint" },
  blueprintVersion: null,
  columnMapping: { password: "gate_secret" },
};

const pinnedRealmGate = {
  ...legacyRealmGate,
  id: "gate_pinned",
  name: "Pinned Gate",
  forgeBlueprintId: null,
  blueprintVersionId: "bv_gate",
  forgeBlueprint: null,
  blueprintVersion: versionSummary("gate"),
};

const ambiguousRealmGate = {
  ...legacyRealmGate,
  id: "gate_ambiguous",
  name: "Ambiguous Gate",
  blueprintVersionId: "bv_gate_ambiguous",
  blueprintVersion: versionSummary("gate_ambiguous"),
};

function installFindManyMocks() {
  mockReportFindMany.mockImplementation(async ({ where }) => {
    if (isNotNullFilter(where.blueprintId) && where.blueprintVersionId === null) {
      return [legacyReport];
    }
    if (where.blueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return [pinnedReport];
    }
    if (isNotNullFilter(where.blueprintId) && isNotNullFilter(where.blueprintVersionId)) {
      return [ambiguousReport];
    }
    return [];
  });

  mockBifrostRouteFindMany.mockImplementation(async ({ where }) => {
    if (isNotNullFilter(where.blueprintId) && where.blueprintVersionId === null) {
      return [legacyBifrostRoute];
    }
    if (where.blueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return [pinnedBifrostRoute];
    }
    if (isNotNullFilter(where.blueprintId) && isNotNullFilter(where.blueprintVersionId)) {
      return [ambiguousBifrostRoute];
    }
    return [];
  });

  mockRealmGateFindMany.mockImplementation(async ({ where }) => {
    if (isNotNullFilter(where.forgeBlueprintId) && where.blueprintVersionId === null) {
      return [legacyRealmGate];
    }
    if (where.forgeBlueprintId === null && isNotNullFilter(where.blueprintVersionId)) {
      return [pinnedRealmGate];
    }
    if (
      isNotNullFilter(where.forgeBlueprintId) &&
      isNotNullFilter(where.blueprintVersionId)
    ) {
      return [ambiguousRealmGate];
    }
    return [];
  });
}

describe("getLegacyBlueprintUsageInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installFindManyMocks();
  });

  it("finds legacy report, Bifrost, and RealmGate attachments", async () => {
    const inventory = await getLegacyBlueprintUsageInventory({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(inventory.reportsUsingLegacyBlueprintId).toMatchObject([
      {
        id: "report_legacy",
        type: "report",
        blueprintId: "bp_legacy_report",
        blueprintVersionId: null,
      },
    ]);
    expect(inventory.bifrostRoutesUsingLegacyBlueprintId).toMatchObject([
      {
        id: "route_legacy",
        type: "bifrost_route",
        blueprintId: "bp_legacy_route",
        blueprintVersionId: null,
      },
    ]);
    expect(inventory.realmGatesUsingLegacyForgeBlueprintId).toMatchObject([
      {
        id: "gate_legacy",
        type: "realm_gate",
        forgeBlueprintId: "forge_legacy",
        blueprintVersionId: null,
      },
    ]);
  });

  it("separates pinned attachments and reports summary counts", async () => {
    const inventory = await getLegacyBlueprintUsageInventory({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(inventory.pinnedReports[0]).toMatchObject({
      id: "report_pinned",
      blueprintId: null,
      blueprintVersionId: "bv_report",
      blueprintVersion: {
        id: "bv_report",
        version: 3,
        stepsHash: "hash_report",
      },
    });
    expect(inventory.pinnedBifrostRoutes[0]).toMatchObject({
      id: "route_pinned",
      blueprintVersionId: "bv_route",
    });
    expect(inventory.pinnedRealmGates[0]).toMatchObject({
      id: "gate_pinned",
      blueprintVersionId: "bv_gate",
    });
    expect(inventory.summary).toEqual({
      legacyReports: 1,
      legacyBifrostRoutes: 1,
      legacyRealmGates: 1,
      pinnedReports: 1,
      pinnedBifrostRoutes: 1,
      pinnedRealmGates: 1,
      ambiguousCount: 3,
    });
  });

  it("flags ambiguous attachments where legacy and pinned IDs coexist", async () => {
    const inventory = await getLegacyBlueprintUsageInventory({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(inventory.ambiguous).toHaveLength(3);
    expect(inventory.ambiguous).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "report_ambiguous",
          reason: "Report has both legacy blueprintId and blueprintVersionId.",
        }),
        expect.objectContaining({
          id: "route_ambiguous",
          reason:
            "Bifrost route has both legacy blueprintId and blueprintVersionId.",
        }),
        expect.objectContaining({
          id: "gate_ambiguous",
          reason:
            "RealmGate has both legacy forgeBlueprintId and blueprintVersionId.",
        }),
      ]),
    );
  });

  it("scopes reports and Bifrost routes by tenant/user and RealmGates by tenant", async () => {
    await getLegacyBlueprintUsageInventory({
      tenantId: "tenant_1",
      userId: "user_1",
    });

    expect(
      mockReportFindMany.mock.calls.every(([arg]) =>
        arg.where.tenantId === "tenant_1" && arg.where.userId === "user_1",
      ),
    ).toBe(true);
    expect(
      mockBifrostRouteFindMany.mock.calls.every(([arg]) =>
        arg.where.tenantId === "tenant_1" && arg.where.userId === "user_1",
      ),
    ).toBe(true);
    expect(
      mockRealmGateFindMany.mock.calls.every(
        ([arg]) => arg.where.tenantId === "tenant_1",
      ),
    ).toBe(true);
  });

  it("does not expose sensitive configs, SQL, raw steps, or analysis metadata", async () => {
    const inventory = await getLegacyBlueprintUsageInventory({
      tenantId: "tenant_1",
      userId: "user_1",
    });
    const serialized = JSON.stringify(inventory);

    expect(serialized).not.toContain("select password");
    expect(serialized).not.toContain("route_secret");
    expect(serialized).not.toContain("gate_secret");
    expect(serialized).not.toContain("raw_steps_should_not_leak");
    expect(serialized).not.toContain("analysis_should_not_leak");
  });

  it("exposes the inventory through the active tenant API route", async () => {
    const { GET } = await import(
      "@/app/api/mjolnir/version-pinning/inventory/route"
    );

    const response = await GET(
      new Request("http://localhost/api/mjolnir/version-pinning/inventory"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      legacyReports: 1,
      legacyBifrostRoutes: 1,
      legacyRealmGates: 1,
    });
    expect(
      mockReportFindMany.mock.calls.every(([arg]) =>
        arg.where.tenantId === "tenant_1" && arg.where.userId === "user_1",
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
