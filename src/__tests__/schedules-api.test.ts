import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockScheduleFindMany,
  mockRecipientFindMany,
} = vi.hoisted(() => ({
  mockScheduleFindMany: vi.fn(),
  mockRecipientFindMany: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, { user: { id: "user_1" } }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    schedule: {
      findMany: mockScheduleFindMany,
    },
    recipient: {
      findMany: mockRecipientFindMany,
    },
  },
}));

describe("schedules API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can filter schedule lookup to one report", async () => {
    mockScheduleFindMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/schedules/route");
    await GET(new Request("http://localhost/api/schedules?reportId=report_1"));

    expect(mockScheduleFindMany).toHaveBeenCalledWith({
      where: {
        report: {
          userId: "user_1",
          id: "report_1",
        },
      },
      include: {
        report: { select: { id: true, name: true } },
        recipients: { select: { email: true, name: true } },
        emailConnection: { select: { id: true, name: true } },
      },
      orderBy: { nextRunAt: "asc" },
      take: 1,
    });
  });

  it("returns capped distinct recipient suggestions", async () => {
    mockRecipientFindMany.mockResolvedValue([
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);

    const { GET } = await import("@/app/api/schedules/recipient-suggestions/route");
    const response = await GET(
      new Request("http://localhost/api/schedules/recipient-suggestions?limit=2")
    );

    expect(await response.json()).toEqual(["a@example.com", "b@example.com"]);
    expect(mockRecipientFindMany).toHaveBeenCalledWith({
      where: { schedule: { report: { userId: "user_1" } } },
      select: { email: true },
      distinct: ["email"],
      orderBy: { email: "asc" },
      take: 2,
    });
  });
});

