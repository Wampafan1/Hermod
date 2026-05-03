import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBifrostRouteCount,
  mockBifrostRouteFindMany,
  mockRouteLogCount,
  mockRouteLogGroupBy,
  mockRouteLogAggregate,
  mockRouteLogFindMany,
  mockHelheimCount,
  mockHelheimGroupBy,
} = vi.hoisted(() => ({
  mockBifrostRouteCount: vi.fn(),
  mockBifrostRouteFindMany: vi.fn(),
  mockRouteLogCount: vi.fn(),
  mockRouteLogGroupBy: vi.fn(),
  mockRouteLogAggregate: vi.fn(),
  mockRouteLogFindMany: vi.fn(),
  mockHelheimCount: vi.fn(),
  mockHelheimGroupBy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    bifrostRoute: {
      count: mockBifrostRouteCount,
      findMany: mockBifrostRouteFindMany,
    },
    routeLog: {
      count: mockRouteLogCount,
      groupBy: mockRouteLogGroupBy,
      aggregate: mockRouteLogAggregate,
      findMany: mockRouteLogFindMany,
    },
    helheimEntry: {
      count: mockHelheimCount,
      groupBy: mockHelheimGroupBy,
    },
  },
}));

describe("dashboard tenant scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBifrostRouteCount.mockResolvedValue(0);
    mockRouteLogCount.mockResolvedValue(0);
    mockRouteLogGroupBy.mockResolvedValue([]);
    mockRouteLogAggregate.mockResolvedValue({ _sum: { rowsLoaded: null } });
    mockHelheimCount.mockResolvedValue(0);
    mockHelheimGroupBy.mockResolvedValue([]);
    mockBifrostRouteFindMany.mockResolvedValue([]);
    mockRouteLogFindMany.mockResolvedValue([]);
  });

  it("scopes all dashboard route-backed queries to the active tenant", async () => {
    const { getDashboardData } = await import("@/lib/dashboard/queries");

    await getDashboardData("user_1", "tenant_1");

    expect(mockBifrostRouteCount).toHaveBeenCalledWith({
      where: { userId: "user_1", tenantId: "tenant_1", enabled: true },
    });

    for (const call of mockRouteLogCount.mock.calls) {
      expect(call[0].where.route).toEqual({
        userId: "user_1",
        tenantId: "tenant_1",
      });
    }
    for (const call of mockRouteLogGroupBy.mock.calls) {
      expect(call[0].where.route).toEqual({
        userId: "user_1",
        tenantId: "tenant_1",
      });
    }
    for (const call of mockHelheimGroupBy.mock.calls) {
      expect(call[0].where.route).toEqual({
        userId: "user_1",
        tenantId: "tenant_1",
      });
    }
  });
});
