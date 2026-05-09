import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBlueprintVersionCreate, mockBlueprintVersionFindFirst } = vi.hoisted(() => ({
  mockBlueprintVersionCreate: vi.fn(),
  mockBlueprintVersionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    blueprintVersion: {
      create: mockBlueprintVersionCreate,
      findFirst: mockBlueprintVersionFindFirst,
    },
  },
}));

import {
  calculateBlueprintStepsHash,
  createLockedBlueprintVersion,
  getNextBlueprintVersionNumber,
  normalizeStepsForHash,
} from "@/lib/mjolnir/blueprint-version";

describe("blueprint version scaffolding helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates a stable hash regardless of object key order", () => {
    const left = [
      {
        type: "rename_columns",
        config: {
          destinationColumn: "Customer Name",
          sourceColumn: "Name",
        },
      },
    ];
    const right = [
      {
        config: {
          sourceColumn: "Name",
          destinationColumn: "Customer Name",
        },
        type: "rename_columns",
      },
    ];

    expect(calculateBlueprintStepsHash(left)).toBe(calculateBlueprintStepsHash(right));
  });

  it("changes the hash when steps change", () => {
    const base = [{ type: "remove_columns", config: { columns: ["Internal"] } }];
    const changed = [{ type: "remove_columns", config: { columns: ["Internal", "Draft"] } }];

    expect(calculateBlueprintStepsHash(base)).not.toBe(calculateBlueprintStepsHash(changed));
  });

  it("preserves array order while normalizing object keys", () => {
    const normalized = normalizeStepsForHash([
      { b: 2, a: 1 },
      { a: 1, b: 2 },
    ]);

    expect(normalized).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 2 },
    ]);
    expect(calculateBlueprintStepsHash([{ type: "a" }, { type: "b" }])).not.toBe(
      calculateBlueprintStepsHash([{ type: "b" }, { type: "a" }])
    );
  });

  it("returns version 1 when no versions exist", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue(null);

    await expect(getNextBlueprintVersionNumber({ blueprintId: "bp_1" })).resolves.toBe(1);
    expect(mockBlueprintVersionFindFirst).toHaveBeenCalledWith({
      where: { blueprintId: "bp_1" },
      select: { version: true },
      orderBy: { version: "desc" },
    });
  });

  it("creates locked blueprint versions with version number, hash, and locked timestamp", async () => {
    mockBlueprintVersionFindFirst.mockResolvedValue({ version: 2 });
    mockBlueprintVersionCreate.mockImplementation(async ({ data }) => ({
      id: "bv_3",
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
      ...data,
    }));

    const steps = [{ config: { sourceColumn: "Name", destinationColumn: "Customer Name" }, type: "rename_columns" }];
    const result = await createLockedBlueprintVersion({
      blueprintId: "bp_1",
      tenantId: "tenant_1",
      steps,
      source: "PUBLISH",
      createdBy: "user_1",
    });

    expect(result.version).toBe(3);
    expect(result.stepsHash).toBe(calculateBlueprintStepsHash(steps));
    expect(result.isLocked).toBe(true);
    expect(result.lockedAt).toBeInstanceOf(Date);
    expect(mockBlueprintVersionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        blueprintId: "bp_1",
        tenantId: "tenant_1",
        version: 3,
        steps: [{ config: { destinationColumn: "Customer Name", sourceColumn: "Name" }, type: "rename_columns" }],
        stepsHash: calculateBlueprintStepsHash(steps),
        isLocked: true,
        lockedAt: expect.any(Date),
        lockedBy: "user_1",
        createdBy: "user_1",
      }),
    });
  });
});
