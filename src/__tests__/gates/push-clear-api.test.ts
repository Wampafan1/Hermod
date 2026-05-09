import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGatePushFindFirst, mockGatePushUpdate, mockDeleteTempFile } = vi.hoisted(() => ({
  mockGatePushFindFirst: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockDeleteTempFile: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      role: "ADMIN",
      user: { id: "user_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gatePush: {
      findFirst: mockGatePushFindFirst,
      update: mockGatePushUpdate,
    },
  },
}));

vi.mock("@/lib/gates/temp-files", () => ({
  deleteTempFile: mockDeleteTempFile,
}));

function request() {
  return new Request("http://localhost/api/gates/gate_1/push/push_1", {
    method: "DELETE",
  });
}

describe("gate push clear API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels a staged push and deletes the temp file", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      status: "SCHEMA_DRIFT",
      tempFileId: "tmp_1",
    });

    const { DELETE } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pushId: "push_1", status: "CANCELLED" });
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: {
        status: "CANCELLED",
        tempFileId: null,
        completedAt: expect.any(Date),
      },
    });
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("does not clear a running push", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      status: "PUSHING",
      tempFileId: "tmp_1",
    });

    const { DELETE } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await DELETE(request());

    expect(response.status).toBe(409);
    expect(mockGatePushUpdate).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });
});
