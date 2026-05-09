import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockForgeBlueprintFindFirst } = vi.hoisted(() => ({
  mockForgeBlueprintFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    forgeBlueprint: {
      findFirst: mockForgeBlueprintFindFirst,
    },
  },
}));

import { validateAttachableForgeBlueprint } from "@/lib/mjolnir/forge-blueprint-attach";

const baseInput = {
  forgeBlueprintId: "forge_1",
  tenantId: "tenant_1",
  userId: "user_1",
  context: "realm-gate" as const,
};

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

describe("validateAttachableForgeBlueprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows absent forgeBlueprintId", async () => {
    const result = await validateAttachableForgeBlueprint({
      ...baseInput,
      forgeBlueprintId: null,
    });

    expect(result).toEqual({ ok: true, forgeBlueprint: null });
    expect(mockForgeBlueprintFindFirst).not.toHaveBeenCalled();
  });

  it("accepts same-tenant forge blueprints", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint());

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forgeBlueprint?.id).toBe("forge_1");
      expect(result.forgeBlueprint?.routeId).toBe("route_1");
    }
    expect(mockForgeBlueprintFindFirst).toHaveBeenCalledWith({
      where: { id: "forge_1" },
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
  });

  it("accepts null tenant forge blueprints when the owning route matches", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({ tenantId: null }));

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result.ok).toBe(true);
  });

  it("rejects missing forge blueprints", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(null);

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    });
  });

  it("rejects forge blueprints from another tenant", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({
      tenantId: "tenant_2",
      route: {
        id: "route_2",
        tenantId: "tenant_2",
        userId: "user_1",
        sourceConfig: { query: "select secret" },
      },
    }));

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    });
    expect(JSON.stringify(result)).not.toContain("select secret");
  });

  it("rejects forge blueprints whose route belongs to another user", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({
      tenantId: null,
      route: {
        id: "route_1",
        tenantId: "tenant_1",
        userId: "user_2",
        destConfig: { token: "do-not-return" },
      },
    }));

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Forge blueprint not found",
    });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("rejects archived forge blueprints", async () => {
    mockForgeBlueprintFindFirst.mockResolvedValue(forgeBlueprint({ status: "ARCHIVED" }));

    const result = await validateAttachableForgeBlueprint(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Archived forge blueprints cannot be attached.",
    });
  });
});
