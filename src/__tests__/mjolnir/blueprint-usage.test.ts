import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReportFindMany, mockBifrostRouteFindMany } = vi.hoisted(() => ({
  mockReportFindMany: vi.fn(),
  mockBifrostRouteFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    report: {
      findMany: mockReportFindMany,
    },
    bifrostRoute: {
      findMany: mockBifrostRouteFindMany,
    },
  },
}));

import { getBlueprintUsage } from "@/lib/mjolnir/blueprint-usage";

describe("getBlueprintUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReportFindMany.mockResolvedValue([]);
    mockBifrostRouteFindMany.mockResolvedValue([]);
  });

  it("returns reports and routes using a blueprint", async () => {
    const updatedAt = new Date("2026-05-08T12:00:00.000Z");
    mockReportFindMany.mockResolvedValue([
      {
        id: "report_1",
        name: "Revenue Report",
        tenantId: "tenant_1",
        tenant: { name: "Midgard" },
        schedule: { enabled: true },
        updatedAt,
      },
    ]);
    mockBifrostRouteFindMany.mockResolvedValue([
      {
        id: "route_1",
        name: "Customer Sync",
        tenantId: "tenant_2",
        tenant: { name: "Vanaheim" },
        enabled: false,
        updatedAt,
      },
    ]);

    const usage = await getBlueprintUsage({
      blueprintId: "bp_1",
      userId: "user_1",
    });

    expect(usage).toEqual({
      blueprintId: "bp_1",
      total: 2,
      reports: [{
        id: "report_1",
        type: "report",
        name: "Revenue Report",
        tenantId: "tenant_1",
        tenantName: "Midgard",
        status: null,
        enabled: true,
        updatedAt,
      }],
      bifrostRoutes: [{
        id: "route_1",
        type: "bifrost_route",
        name: "Customer Sync",
        tenantId: "tenant_2",
        tenantName: "Vanaheim",
        status: null,
        enabled: false,
        updatedAt,
      }],
    });
  });

  it("does not select credentials, SQL query text, or route configs", async () => {
    await getBlueprintUsage({
      blueprintId: "bp_1",
      userId: "user_1",
    });

    expect(mockReportFindMany).toHaveBeenCalledWith({
      where: { blueprintId: "bp_1", userId: "user_1" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        updatedAt: true,
        tenant: { select: { name: true } },
        schedule: { select: { enabled: true } },
      },
    });
    expect(mockBifrostRouteFindMany).toHaveBeenCalledWith({
      where: { blueprintId: "bp_1", userId: "user_1" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        tenantId: true,
        enabled: true,
        updatedAt: true,
        tenant: { select: { name: true } },
      },
    });
    expect(JSON.stringify(mockReportFindMany.mock.calls[0][0])).not.toContain("sqlQuery");
    expect(JSON.stringify(mockBifrostRouteFindMany.mock.calls[0][0])).not.toContain("sourceConfig");
    expect(JSON.stringify(mockBifrostRouteFindMany.mock.calls[0][0])).not.toContain("destConfig");
  });

  it("scopes usage by userId", async () => {
    await getBlueprintUsage({
      blueprintId: "bp_1",
      userId: "user_2",
    });

    expect(mockReportFindMany.mock.calls[0][0].where).toEqual({
      blueprintId: "bp_1",
      userId: "user_2",
    });
    expect(mockBifrostRouteFindMany.mock.calls[0][0].where).toEqual({
      blueprintId: "bp_1",
      userId: "user_2",
    });
  });
});
