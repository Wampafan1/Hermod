import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGatePushFindFirst,
  mockGatePushUpdate,
  mockRealmGateFindFirst,
  mockDeleteTempFile,
} = vi.hoisted(() => ({
  mockGatePushFindFirst: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockRealmGateFindFirst: vi.fn(),
  mockDeleteTempFile: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) =>
    handler(req, {
      userId: "user_1",
      tenantId: "tenant_1",
      user: { id: "user_1", tenantId: "tenant_1" },
      session: { user: { id: "user_1", tenantId: "tenant_1" } },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gatePush: {
      findFirst: mockGatePushFindFirst,
      update: mockGatePushUpdate,
    },
    realmGate: {
      findFirst: mockRealmGateFindFirst,
    },
  },
}));

vi.mock("@/lib/gates/temp-files", () => ({
  deleteTempFile: mockDeleteTempFile,
  readTempFile: vi.fn(),
}));

function push(overrides: Record<string, unknown> = {}) {
  return {
    id: "push_1",
    gateId: "gate_1",
    tenantId: "tenant_1",
    fileName: "repeat.csv",
    fileSize: 123,
    fileMimeType: "text/csv",
    status: "VALIDATING",
    rowCount: null,
    rowsInserted: null,
    rowsUpdated: null,
    rowsErrored: null,
    blankRowsSkipped: 0,
    schemaDiff: null,
    keyDrift: null,
    errorMessage: null,
    errorDetails: {
      gateValidation: {
        validationStage: "ANALYZING_FILE",
        validationStartedAt: "2026-05-09T12:00:00.000Z",
        validationHeartbeatAt: "2026-05-09T12:00:10.000Z",
        validationTimeoutAt: "2026-05-09T12:05:00.000Z",
      },
    },
    tempFileId: "tmp_1",
    createdAt: new Date("2026-05-09T12:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function statusRequest() {
  return new Request("http://localhost/api/gates/gate_1/push/push_1", {
    method: "GET",
  });
}

describe("Gate push validation status endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GATE_PUSH_VALIDATION_TIMEOUT_MS = "999999999";
  });

  it("returns observable VALIDATING stage metadata without raw payloads", async () => {
    mockGatePushFindFirst
      .mockResolvedValueOnce(push())
      .mockResolvedValueOnce(push({
        keyDrift: {
          oldKey: ["id"],
          duplicateExamples: [],
          nullKeyExamples: [],
          candidateKeys: [],
          selectedKey: null,
          rawRows: [{ secret: "do-not-return" }],
        },
      }));

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await GET(statusRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: "push_1",
      status: "VALIDATING",
      validationStage: "ANALYZING_FILE",
      validationHeartbeatAt: "2026-05-09T12:00:10.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("credentials");
    expect(JSON.stringify(payload)).not.toContain("do-not-return");
    expect(JSON.stringify(payload)).not.toContain("rawRows");
  });

  it("returns SCHEMA_DRIFT resolution options safely", async () => {
    const schemaDiff = {
      added: [{ name: "new_col", type: "VARCHAR", nullable: true }],
      removed: [],
      typeChanged: [],
    };
    mockGatePushFindFirst
      .mockResolvedValueOnce(push({ status: "SCHEMA_DRIFT", schemaDiff }))
      .mockResolvedValueOnce(push({ status: "SCHEMA_DRIFT", schemaDiff }));
    mockRealmGateFindFirst.mockResolvedValue({
      id: "gate_1",
      tenantId: "tenant_1",
      targetSchema: "public",
      targetTable: "customers",
      columnMapping: [],
      connection: { type: "POSTGRES" },
      connectionConfig: { password: "do-not-return" },
    });

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
    const response = await GET(statusRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("SCHEMA_DRIFT");
    expect(payload.resolutionOptions.adjustDestination.statements.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain("do-not-return");
  });

  it("marks stale VALIDATING pushes as FAILED before returning status", async () => {
    process.env.GATE_PUSH_VALIDATION_TIMEOUT_MS = "1000";
    const oldPush = push({
      createdAt: new Date("2026-05-09T12:00:00.000Z"),
      errorDetails: {
        gateValidation: {
          validationStage: "CHECKING_KEY",
          validationHeartbeatAt: "2026-05-09T12:00:00.000Z",
        },
      },
    });
    mockGatePushFindFirst
      .mockResolvedValueOnce(oldPush)
      .mockResolvedValueOnce(push({
        status: "FAILED",
        errorMessage: "Gate push validation timed out.",
        errorDetails: {
          gateValidation: {
            validationStage: "FAILED",
            validationError: "Gate push validation timed out.",
          },
        },
        completedAt: new Date("2026-05-09T12:06:00.000Z"),
      }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:06:00.000Z"));
    try {
      const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/route");
      const response = await GET(statusRequest());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        status: "FAILED",
        validationStage: "FAILED",
        errorMessage: "Gate push validation timed out.",
      });
      expect(mockGatePushUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "push_1" },
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "Gate push validation timed out.",
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs worker validation start and final status without sensitive payloads", async () => {
    mockGatePushFindFirst
      .mockResolvedValueOnce(push({ status: "VALIDATED" }))
      .mockResolvedValueOnce(push({ status: "VALIDATED" }));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const { handleGateValidatePush } = await import("@/lib/gates/push-validation");
      await handleGateValidatePush({
        data: {
          pushId: "push_1",
          gateId: "gate_1",
          tenantId: "tenant_1",
          tempFileId: "tmp_1",
        },
      });

      const logs = info.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logs).toContain("Starting gate validation pushId=push_1 gateId=gate_1");
      expect(logs).toContain("Finished gate validation pushId=push_1 gateId=gate_1 status=VALIDATED");
      expect(logs).not.toContain("rawRows");
      expect(logs).not.toContain("credentials");
      expect(logs).not.toContain("secret");
    } finally {
      info.mockRestore();
    }
  });
});
