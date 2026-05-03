import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRavenFindFirst,
  mockRavenJobFindMany,
} = vi.hoisted(() => ({
  mockRavenFindFirst: vi.fn(),
  mockRavenJobFindMany: vi.fn(),
}));

vi.mock("@/lib/raven/auth", () => ({
  withRavenAuth: (handler: any) => async (req: Request) =>
    handler(req, { tenantId: "tenant_1" }),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => handler,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    ravenSatellite: {
      findFirst: mockRavenFindFirst,
    },
    ravenJob: {
      findMany: mockRavenJobFindMany,
    },
  },
}));

describe("Raven jobs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRavenFindFirst.mockResolvedValue({ id: "raven_1" });
  });

  it("caps pending job polling and returns a next cursor header", async () => {
    mockRavenJobFindMany.mockResolvedValue([
      { id: "job_1", priority: 1 },
      { id: "job_2", priority: 1 },
      { id: "job_3", priority: 1 },
    ]);

    const { GET } = await import("@/app/api/raven/jobs/route");
    const response = await GET(
      new Request("http://localhost/api/raven/jobs?ravenId=raven_1&limit=2")
    );
    const body = await response.json();

    expect(body).toEqual([
      { id: "job_1", priority: 1 },
      { id: "job_2", priority: 1 },
    ]);
    expect(response.headers.get("X-Next-Cursor")).toBe("job_2");
    expect(mockRavenJobFindMany).toHaveBeenCalledWith({
      where: { ravenId: "raven_1", status: "pending" },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      cursor: undefined,
      skip: undefined,
      take: 3,
      select: {
        id: true,
        ravenId: true,
        routeId: true,
        routeLogId: true,
        connectionId: true,
        timeout: true,
        maxRows: true,
        priority: true,
        status: true,
        claimedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("uses cursor pagination when a cursor is supplied", async () => {
    mockRavenJobFindMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/raven/jobs/route");
    await GET(
      new Request("http://localhost/api/raven/jobs?ravenId=raven_1&cursor=job_2")
    );

    expect(mockRavenJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "job_2" },
        skip: 1,
        take: 26,
      })
    );
  });
});

