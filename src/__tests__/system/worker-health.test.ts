import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWithAuth, mockEnsureBossStarted, mockGetQueueSize } = vi.hoisted(() => ({
  mockWithAuth: vi.fn((handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1", tenantId: "tenant_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    })
  ),
  mockEnsureBossStarted: vi.fn(),
  mockGetQueueSize: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: mockWithAuth,
}));

vi.mock("@/lib/pg-boss", () => ({
  ensureBossStarted: mockEnsureBossStarted,
}));

describe("worker health route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockEnsureBossStarted.mockResolvedValue({ getQueueSize: mockGetQueueSize });
    mockGetQueueSize.mockImplementation(async (_name: string, options?: { before?: string }) =>
      options?.before === "completed" ? 3 : 2
    );
  });

  it("returns a safe worker-required payload with queue summaries", async () => {
    const { GET } = await import("@/app/api/system/worker-health/route");
    const response = await GET(new Request("http://localhost/api/system/worker-health"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      workerRequired: true,
      queues: {
        gateValidation: {
          pending: 2,
          active: 1,
          failedRecently: null,
          status: "available",
          queues: ["gate-validate-push"],
        },
        reports: {
          pending: 2,
          active: 1,
          status: "available",
          queues: ["send-report"],
        },
        bifrost: {
          pending: 4,
          active: 2,
          status: "available",
        },
        backups: {
          pending: 12,
          active: 6,
          status: "available",
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(payload)).not.toContain("credentials");
    expect(JSON.stringify(payload)).not.toContain("npm run worker");
    expect(mockWithAuth).toHaveBeenCalled();
  });

  it("falls back safely when queue introspection is unavailable", async () => {
    mockEnsureBossStarted.mockRejectedValue(new Error("DATABASE_URL=secret postgres://hidden"));

    const { GET } = await import("@/app/api/system/worker-health/route");
    const response = await GET(new Request("http://localhost/api/system/worker-health"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(false);
    expect(payload.workerRequired).toBe(true);
    expect(payload.queues.gateValidation).toMatchObject({
      pending: null,
      active: null,
      failedRecently: null,
      status: "unavailable",
    });
    expect(payload.message).toBe("Worker queue metrics are unavailable. Check the Hermod worker process and worker logs.");
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("postgres://hidden");
    expect(JSON.stringify(payload)).not.toContain("credentials");
  });

  it("keeps development and production worker guidance distinct", async () => {
    const {
      backupWorkerStuckMessage,
      scheduledWorkerStuckMessage,
      workerHealthMessage,
    } = await import("@/lib/system/worker-health");

    expect(workerHealthMessage({
      nodeEnv: "development",
      queueStatsAvailable: false,
    })).toContain("npm run worker");
    expect(workerHealthMessage({
      nodeEnv: "production",
      queueStatsAvailable: false,
    })).not.toContain("npm run worker");
    expect(workerHealthMessage({
      nodeEnv: "production",
      queueStatsAvailable: true,
    })).toContain("Hermod worker");

    vi.stubEnv("NODE_ENV", "production");
    expect(scheduledWorkerStuckMessage()).not.toContain("npm run worker");
    expect(backupWorkerStuckMessage()).not.toContain("npm run worker");

    vi.stubEnv("NODE_ENV", "development");
    expect(scheduledWorkerStuckMessage()).toContain("npm run worker");
    expect(backupWorkerStuckMessage()).toContain("npm run worker");
    vi.unstubAllEnvs();
  });
});
