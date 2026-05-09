import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBlueprintVersionFindFirst } = vi.hoisted(() => ({
  mockBlueprintVersionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprintVersion: {
      findFirst: mockBlueprintVersionFindFirst,
    },
  },
}));

import { validateOptionalAttachableBlueprintVersion } from "@/lib/mjolnir/blueprint-version-attach";

const baseInput = {
  blueprintVersionId: "bv_1",
  tenantId: "tenant_1",
  context: "report" as const,
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

describe("validateOptionalAttachableBlueprintVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts absent blueprintVersionId", async () => {
    const result = await validateOptionalAttachableBlueprintVersion({
      ...baseInput,
      blueprintVersionId: null,
    });

    expect(result).toEqual({ ok: true, blueprintVersion: null });
    expect(mockBlueprintVersionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects missing versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const result = await validateOptionalAttachableBlueprintVersion(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Blueprint version not found",
    });
  });

  it("rejects cross-tenant versions by loading through the active tenant boundary", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    const result = await validateOptionalAttachableBlueprintVersion({
      ...baseInput,
      tenantId: "tenant_2",
    });

    expect(result.ok).toBe(false);
    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "bv_1",
        tenantId: "tenant_2",
      },
      select: expect.any(Object),
    });
  });

  it("rejects unlocked versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(blueprintVersion({ isLocked: false }));

    const result = await validateOptionalAttachableBlueprintVersion(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version must be locked before it can be attached.",
    });
  });

  it("rejects versions whose parent is not tenant-published", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(
      blueprintVersion({
        blueprint: {
          scope: "PERSONAL_DRAFT",
          status: "VALIDATED",
        },
      })
    );

    const result = await validateOptionalAttachableBlueprintVersion(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Blueprint version is not tenant-published.",
    });
  });

  it("accepts locked VALIDATED and ACTIVE tenant-published versions", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValueOnce(blueprintVersion({
      blueprint: {
        scope: "TENANT_PUBLISHED",
        status: "VALIDATED",
      },
    }));
    mockBlueprintVersionFindFirst.mockResolvedValueOnce(blueprintVersion({
      blueprint: {
        scope: "TENANT_PUBLISHED",
        status: "ACTIVE",
      },
    }));

    const validated = await validateOptionalAttachableBlueprintVersion(baseInput);
    const active = await validateOptionalAttachableBlueprintVersion({
      ...baseInput,
      blueprintVersionId: "bv_2",
    });

    expect(validated.ok).toBe(true);
    expect(active.ok).toBe(true);
  });

  it("rejects streaming-incompatible versions when streaming compatibility is required", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(
      blueprintVersion({
        steps: [{ type: "rename_columns" }, { type: "sort" }],
      })
    );

    const result = await validateOptionalAttachableBlueprintVersion({
      ...baseInput,
      context: "bifrost-route",
      requireStreamingCompatible: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("Blueprint version contains stateful steps not supported in streaming mode");
      expect(result.statefulSteps).toEqual(["sort"]);
      expect(result.suggestion).toContain("ORDER BY");
    }
  });
});
