import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBlueprintFindFirst } = vi.hoisted(() => ({
  mockBlueprintFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprint: {
      findFirst: mockBlueprintFindFirst,
    },
  },
}));

import { validateAttachableBlueprint } from "@/lib/mjolnir/blueprint-attach";

const baseInput = {
  blueprintId: "bp_1",
  userId: "user_1",
  tenantId: "tenant_1",
  context: "report" as const,
};

function blueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp_1",
    userId: "user_1",
    status: "ACTIVE",
    steps: [{ type: "rename_columns" }],
    name: "Customer Cleanup",
    ...overrides,
  };
}

describe("validateAttachableBlueprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts ACTIVE blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ACTIVE" }));

    const result = await validateAttachableBlueprint(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blueprint.id).toBe("bp_1");
      expect(result.blueprint.name).toBe("Customer Cleanup");
    }
    expect(mockBlueprintFindFirst).toHaveBeenCalledWith({
      where: { id: "bp_1", userId: "user_1" },
      select: {
        id: true,
        userId: true,
        status: true,
        steps: true,
        name: true,
      },
    });
  });

  it("accepts VALIDATED blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "VALIDATED" }));

    const result = await validateAttachableBlueprint(baseInput);

    expect(result.ok).toBe(true);
  });

  it("rejects DRAFT blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "DRAFT" }));

    const result = await validateAttachableBlueprint(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("Blueprint must be validated before it can be attached.");
    }
  });

  it("rejects missing blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(null);

    const result = await validateAttachableBlueprint(baseInput);

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Blueprint not found",
    });
  });

  it("rejects archived blueprints", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({ status: "ARCHIVED" }));

    const result = await validateAttachableBlueprint(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Archived blueprints");
    }
  });

  it("rejects streaming-incompatible blueprints when required", async () => {
    mockBlueprintFindFirst.mockResolvedValue(blueprint({
      steps: [
        { type: "rename_columns" },
        { type: "sort" },
        { type: "custom_sql" },
      ],
    }));

    const result = await validateAttachableBlueprint({
      ...baseInput,
      context: "bifrost-route",
      requireStreamingCompatible: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("Blueprint contains stateful steps not supported in streaming mode");
      expect(result.statefulSteps).toEqual(["sort", "custom_sql"]);
      expect(result.suggestion).toContain("ORDER BY");
      expect(result.suggestion).toContain("custom SQL");
    }
  });
});
