import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPolicyFindFirst,
  mockRunFindMany,
} = vi.hoisted(() => ({
  mockPolicyFindFirst: vi.fn(),
  mockRunFindMany: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => handler(req, {
    userId: "user_1",
    tenantId: "tenant_1",
    role: "ADMIN",
    user: { id: "user_1" },
    session: { user: { id: "user_1", tenantId: "tenant_1", role: "ADMIN" } },
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    postgresBackupPolicy: { findFirst: mockPolicyFindFirst },
    postgresBackupRun: { findMany: mockRunFindMany },
  },
}));

describe("backup restore-point API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only queries successful FULL_LOGICAL backup runs", async () => {
    mockPolicyFindFirst.mockResolvedValue({
      id: "policy_1",
      name: "Prod Backups",
      sourceConnection: {
        id: "conn_1",
        name: "Prod",
        config: { database: "prod" },
      },
      storageTarget: {
        id: "target_1",
        name: "S3",
        provider: "AWS_S3",
        config: { bucket: "backups" },
      },
    });
    mockRunFindMany.mockResolvedValue([
      {
        id: "run_1",
        type: "FULL_LOGICAL",
        status: "SUCCESS",
        objectKeys: [{ key: "dump" }],
        bytesWritten: BigInt(10),
        checksumSha256: "abc",
        durationMs: 100,
        startedAt: new Date("2026-05-02T20:00:00Z"),
        completedAt: new Date("2026-05-02T20:00:01Z"),
        triggeredBy: "manual",
      },
    ]);

    const { GET } = await import("@/app/api/backups/restore-points/route");
    const res = await GET(new Request("http://localhost/api/backups/restore-points?policyId=policy_1"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockRunFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        policyId: "policy_1",
        status: { in: ["SUCCESS", "PARTIAL"] },
        type: "FULL_LOGICAL",
      },
    }));
    expect(data.items[0].bytesWritten).toBe("10");
    expect(data.policy.sourceConnection.database).toBe("prod");
  });
});
