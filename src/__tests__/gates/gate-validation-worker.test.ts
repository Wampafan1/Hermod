import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGatePushFindFirst,
  mockGatePushFindMany,
  mockGatePushUpdate,
  mockRealmGateFindFirst,
  mockAnalyzeFile,
  mockReadTempFile,
  mockPreflightGatePushKeyDrift,
} = vi.hoisted(() => ({
  mockGatePushFindFirst: vi.fn(),
  mockGatePushFindMany: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockRealmGateFindFirst: vi.fn(),
  mockAnalyzeFile: vi.fn(),
  mockReadTempFile: vi.fn(),
  mockPreflightGatePushKeyDrift: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gatePush: {
      findFirst: mockGatePushFindFirst,
      findMany: mockGatePushFindMany,
      update: mockGatePushUpdate,
    },
    realmGate: {
      findFirst: mockRealmGateFindFirst,
    },
  },
}));

vi.mock("@/lib/duckdb/file-analyzer", () => {
  class FileAnalysisError extends Error {
    code: string;

    constructor(message: string, code = "ANALYSIS_FAILED") {
      super(message);
      this.code = code;
    }
  }

  return {
    analyzeFile: mockAnalyzeFile,
    FileAnalysisError,
  };
});

vi.mock("@/lib/gates/temp-files", () => ({
  readTempFile: mockReadTempFile,
}));

vi.mock("@/lib/gates/push-executor", () => ({
  preflightGatePushKeyDrift: mockPreflightGatePushKeyDrift,
}));

function validationPush(overrides: Record<string, unknown> = {}) {
  return {
    id: "push_1",
    gateId: "gate_1",
    tenantId: "tenant_1",
    status: "VALIDATING",
    fileName: "repeat.csv",
    fileSize: 100,
    tempFileId: "tmp_1",
    createdAt: new Date("2026-05-09T12:00:00.000Z"),
    errorDetails: {
      gateValidation: {
        validationStage: "ANALYZING_FILE",
        validationStartedAt: "2026-05-09T12:00:00.000Z",
        validationHeartbeatAt: "2026-05-09T12:00:00.000Z",
      },
    },
    ...overrides,
  };
}

function activeGate() {
  return {
    id: "gate_1",
    tenantId: "tenant_1",
    status: "ACTIVE",
    savedSchema: [
      { name: "Job Number", duckdbType: "VARCHAR", inferredType: "TEXT", nullable: false },
      { name: "Line Number", duckdbType: "VARCHAR", inferredType: "TEXT", nullable: false },
    ],
    columnMapping: [
      {
        sourceColumn: "Job Number",
        destinationColumn: "job_number",
        sourceType: "TEXT",
        destType: "TEXT",
      },
      {
        sourceColumn: "Line Number",
        destinationColumn: "line_number",
        sourceType: "TEXT",
        destType: "TEXT",
      },
    ],
    primaryKeyColumns: ["job_number", "line_number"],
    mergeStrategy: "UPSERT",
    connection: { name: "Postgres", type: "POSTGRES" },
  };
}

describe("Gate validation worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GATE_PUSH_VALIDATION_TIMEOUT_MS = "1000";
    mockGatePushUpdate.mockResolvedValue({});
  });

  it("refreshes validation heartbeat while a long operation is pending", async () => {
    vi.useFakeTimers();
    try {
      const { runWithGateValidationHeartbeat } = await import("@/lib/gates/validation-timeouts");
      let finishOperation!: (value: string) => void;
      const task = runWithGateValidationHeartbeat({
        pushId: "push_1",
        stage: "DISCOVERING_KEY",
        startedAt: new Date("2026-05-09T12:00:00.000Z"),
        intervalMs: 50,
        operation: () => new Promise<string>((resolve) => {
          finishOperation = resolve;
        }),
      });

      await vi.advanceTimersByTimeAsync(125);
      expect(mockGatePushUpdate.mock.calls.length).toBeGreaterThanOrEqual(3);

      finishOperation("done");
      await expect(task).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark an old VALIDATING push failed when heartbeat is recent", async () => {
    const { markStaleGatePushValidationsFailed } = await import("@/lib/gates/validation-timeouts");
    mockGatePushFindMany.mockResolvedValue([
      validationPush({
        errorDetails: {
          gateValidation: {
            validationStage: "DISCOVERING_KEY",
            validationStartedAt: "2026-05-09T12:00:00.000Z",
            validationHeartbeatAt: "2026-05-09T12:05:59.500Z",
          },
        },
      }),
    ]);

    const failed = await markStaleGatePushValidationsFailed(new Date("2026-05-09T12:06:00.000Z"));

    expect(failed).toBe(0);
    expect(mockGatePushUpdate).not.toHaveBeenCalled();
  });

  it("marks an old VALIDATING push failed when heartbeat is stale", async () => {
    const { markStaleGatePushValidationsFailed } = await import("@/lib/gates/validation-timeouts");
    mockGatePushFindMany.mockResolvedValue([
      validationPush({
        errorDetails: {
          gateValidation: {
            validationStage: "DISCOVERING_KEY",
            validationStartedAt: "2026-05-09T12:00:00.000Z",
            validationHeartbeatAt: "2026-05-09T12:00:00.000Z",
          },
        },
      }),
    ]);

    const failed = await markStaleGatePushValidationsFailed(new Date("2026-05-09T12:06:00.000Z"));

    expect(failed).toBe(1);
    expect(mockGatePushUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "push_1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: expect.stringContaining(
          "The worker did not refresh validation heartbeat before the timeout"
        ),
      }),
    }));
  });

  it("uses schema-only analysis and still runs key preflight for KEY_DRIFT", async () => {
    mockGatePushFindFirst.mockResolvedValue(validationPush());
    mockRealmGateFindFirst.mockResolvedValue(activeGate());
    mockReadTempFile.mockResolvedValue({ buffer: Buffer.from("csv"), extension: ".csv" });
    mockAnalyzeFile.mockResolvedValue({
      rowCount: 2,
      columns: [
        { name: "Job Number", duckdbType: "VARCHAR", inferredType: "TEXT", nullable: false },
        { name: "Line Number", duckdbType: "VARCHAR", inferredType: "TEXT", nullable: false },
      ],
    });
    mockPreflightGatePushKeyDrift.mockResolvedValue({
      rowCount: 2,
      blankRowsSkipped: 0,
      keyDrift: {
        oldKey: ["job_number", "line_number"],
        duplicateExamples: [],
        nullKeyExamples: [],
        reason: "Current UPSERT key has duplicate values in this upload.",
        candidateKeys: [],
        recommendation: null,
        validationStats: null,
        selectedKey: null,
      },
    });

    const { validateStagedGatePush } = await import("@/lib/gates/push-validation");
    await validateStagedGatePush({
      pushId: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      tempFileId: "tmp_1",
    });

    expect(mockAnalyzeFile).toHaveBeenCalledWith(
      Buffer.from("csv"),
      "repeat.csv",
      { skipUCC: true }
    );
    expect(mockPreflightGatePushKeyDrift).toHaveBeenCalledWith(expect.objectContaining({
      mergeStrategy: "UPSERT",
      primaryKeyColumns: ["job_number", "line_number"],
    }));
    expect(mockGatePushUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "push_1" },
      data: expect.objectContaining({
        status: "KEY_DRIFT",
      }),
    }));
  });
});
