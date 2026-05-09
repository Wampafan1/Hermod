import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBlueprintVersionFindFirst,
  mockForgeBlueprintFindFirst,
} = vi.hoisted(() => ({
  mockBlueprintVersionFindFirst: vi.fn(),
  mockForgeBlueprintFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
    },
  },
}));

import { validateRealmGateBlueprintAttachment } from "@/lib/mjolnir/realm-gate-blueprint-attach";

const baseInput = {
  userId: "user_1",
  tenantId: "tenant_1",
  forgeEnabled: true,
};

function blueprintVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "bv_1",
    blueprintId: "bp_published",
    tenantId: "tenant_1",
    version: 1,
    steps: [{ type: "rename_columns" }],
    stepsHash: "steps_hash",
    isLocked: true,
    blueprint: {
      scope: "TENANT_PUBLISHED",
      status: "VALIDATED",
    },
    ...overrides,
  };
}

function forgeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "forge_1",
    routeId: "route_1",
    tenantId: "tenant_1",
    status: "ACTIVE",
    name: "Route Forge",
    route: {
      id: "route_1",
      tenantId: "tenant_1",
      userId: "user_1",
    },
    ...overrides,
  };
}

describe("validateRealmGateBlueprintAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts no attachment when Forge is disabled", async () => {
    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      forgeEnabled: false,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: null,
        forgeBlueprintId: null,
        mode: "NONE",
      },
    });
    expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid blueprintVersionId", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: "bv_1",
        forgeBlueprintId: null,
        mode: "PINNED_VERSION",
      },
    });
  });

  it("rejects cross-tenant blueprintVersionId values", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      tenantId: "tenant_2",
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Blueprint version not found",
    });
    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "bv_1", tenantId: "tenant_2" },
    }));
  });

  it("rejects unlocked blueprint versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({ isLocked: false }));

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version must be locked before it can be attached.",
    });
  });

  it("rejects DRAFT parent blueprints", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      blueprint: { scope: "TENANT_PUBLISHED", status: "DRAFT" },
    }));

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    });
  });

  it("rejects ARCHIVED parent blueprints", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({
      blueprint: { scope: "TENANT_PUBLISHED", status: "ARCHIVED" },
    }));

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version parent must be validated or active before it can be attached.",
    });
  });

  it("accepts legacy valid forgeBlueprintId attachments", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint());

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      legacyForgeBlueprintId: "forge_1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: null,
        forgeBlueprintId: "forge_1",
        mode: "LEGACY_FORGE_BLUEPRINT",
      },
    });
  });

  it("rejects legacy cross-tenant forgeBlueprintId attachments", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({
      tenantId: "tenant_2",
      route: {
        id: "route_2",
        tenantId: "tenant_2",
        userId: "user_1",
        sourceConfig: { query: "select secret" },
      },
    }));

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      legacyForgeBlueprintId: "forge_1",
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    });
    expect(JSON.stringify(result)).not.toContain("select secret");
  });

  it("prefers blueprintVersionId when both version and legacy IDs are provided", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion());

    const result = await validateRealmGateBlueprintAttachment({
      ...baseInput,
      blueprintVersionId: "bv_1",
      legacyForgeBlueprintId: "forge_1",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        blueprintVersionId: "bv_1",
        forgeBlueprintId: null,
        mode: "PINNED_VERSION",
      },
    });
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
  });
});
