import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    helheimEntry: {
      create: mockCreate,
    },
  },
}));

import { enqueueDeadLetter } from "@/lib/bifrost/helheim/dead-letter";

describe("Helheim dead-letter persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "hlh_1" });
  });

  it("stores the route tenant ID on new dead-letter entries", async () => {
    const id = await enqueueDeadLetter(
      "route_1",
      "log_1",
      0,
      [{ id: 1 }],
      new Error("load failed password=secret"),
      "tenant_1"
    );

    expect(id).toBe("hlh_1");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        routeId: "route_1",
        tenantId: "tenant_1",
        jobId: "log_1",
        rowCount: 1,
        errorMessage: "load failed password=[redacted]",
      }),
    }));
  });
});
