import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReplaceKeyConstraintPlan } from "@/lib/gates/key-ddl";

const {
  mockGatePushFindFirst,
  mockGatePushUpdate,
  mockRealmGateFindFirst,
  mockRealmGateUpdate,
  mockReadTempFile,
  mockDeleteTempFile,
  mockExecutePush,
  mockLoadRowsFromGateFile,
  mockProviderConnect,
  mockProviderQuery,
  mockProviderConn,
} = vi.hoisted(() => ({
  mockGatePushFindFirst: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockRealmGateFindFirst: vi.fn(),
  mockRealmGateUpdate: vi.fn(),
  mockReadTempFile: vi.fn(),
  mockDeleteTempFile: vi.fn(),
  mockExecutePush: vi.fn(),
  mockLoadRowsFromGateFile: vi.fn(),
  mockProviderConnect: vi.fn(),
  mockProviderQuery: vi.fn(),
  mockProviderConn: { close: vi.fn() },
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
    realmGate: {
      findFirst: mockRealmGateFindFirst,
      update: mockRealmGateUpdate,
    },
  },
}));

vi.mock("@/lib/gates/temp-files", () => ({
  readTempFile: mockReadTempFile,
  deleteTempFile: mockDeleteTempFile,
}));

vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(() => ({
    type: "POSTGRES",
    connect: mockProviderConnect,
    query: mockProviderQuery,
  })),
}));

vi.mock("@/lib/duckdb/file-analyzer", () => ({
  analyzeCSV: vi.fn(),
  analyzeExcel: vi.fn(),
}));

vi.mock("@/lib/gates/push-executor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gates/push-executor")>(
    "@/lib/gates/push-executor"
  );
  return {
    ...actual,
    executePush: mockExecutePush,
    loadRowsFromGateFile: mockLoadRowsFromGateFile,
  };
});

const keyDrift = {
  oldKey: ["job_number", "line_number"],
  duplicateExamples: [],
  nullKeyExamples: [],
  reason: "Current UPSERT key has duplicate values in this upload.",
  candidateKeys: [
    {
      columns: ["job_number", "line_number", "line_value"],
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      coverage: 1,
      width: 3,
      score: 1000,
    },
  ],
  recommendation: {
    columns: ["job_number", "line_number", "line_value"],
    score: 1000,
    source: "DETERMINISTIC",
    reason: "Selected verified key.",
  },
  validationStats: {
    rowCount: 2,
    columnsAnalyzed: 3,
    combinationsTested: 1,
    maxWidth: 4,
    maxCombinations: 25000,
    truncated: false,
    destinationValidated: false,
    destinationValidationMode: "UPLOAD_ONLY",
  },
  selectedKey: null,
};

const gate = {
  id: "gate_1",
  tenantId: "tenant_1",
  targetSchema: "public",
  targetTable: "orders",
  mergeStrategy: "UPSERT",
  primaryKeyColumns: ["Job Number", "Line Number"],
  keyConstraintName: null,
  keyHistory: null,
  columnMapping: [
    { sourceColumn: "Job Number", destinationColumn: "job_number", sourceType: "TEXT", destType: "TEXT" },
    { sourceColumn: "Line Number", destinationColumn: "line_number", sourceType: "TEXT", destType: "TEXT" },
    { sourceColumn: "Line Value", destinationColumn: "line_value", sourceType: "TEXT", destType: "TEXT" },
  ],
  connection: {
    id: "conn_1",
    type: "POSTGRES",
    config: {},
    credentials: null,
  },
};

function request(body: unknown) {
  return new Request("http://localhost/api/gates/gate_1/push/push_1/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function previewRequest(selectedKey: string[]) {
  return new Request(
    `http://localhost/api/gates/gate_1/push/push_1/resolve?selectedKey=${encodeURIComponent(selectedKey.join(","))}`,
    { method: "GET" }
  );
}

describe("Gate key hardening resolve API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderConnect.mockResolvedValue(mockProviderConn);
    mockProviderQuery.mockResolvedValue({ columns: ["count"], rows: [{ count: 0 }] });
    mockReadTempFile.mockResolvedValue({ buffer: Buffer.from("csv"), extension: ".csv" });
    mockLoadRowsFromGateFile.mockResolvedValue([
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "J1", "Line Number": "1", "Line Value": "B" },
    ]);
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      status: "KEY_DRIFT",
      tempFileId: "tmp_1",
      keyDrift,
    });
    mockRealmGateFindFirst.mockResolvedValue(gate);
    mockExecutePush.mockResolvedValue({
      status: "SUCCESS",
      rowCount: 2,
      rowsInserted: 2,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 0,
      duration: 42,
    });
  });

  it("previews a verified candidate", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: ["job_number", "line_number", "line_value"],
    });

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(["job_number", "line_number", "line_value"]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedKey: ["job_number", "line_number", "line_value"],
      manualCandidate: false,
      manualValidation: { ok: true },
      ddl: plan.ddl,
    });
  });

  it("previews a verified nullable UCC candidate with a review warning", async () => {
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      status: "KEY_DRIFT",
      tempFileId: "tmp_1",
      keyDrift: {
        ...keyDrift,
        candidateKeys: [
          {
            columns: ["job_number", "line_number", "line_value"],
            unique: true,
            nullCount: 2,
            duplicateCount: 0,
            coverage: 1,
            width: 3,
            score: 980,
            source: "UCC",
            requiresReview: true,
            reviewReason: "KEY_HAS_NULLS",
          },
        ],
      },
    });
    mockLoadRowsFromGateFile.mockResolvedValue([
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "J1", "Line Number": "1", "Line Value": "B" },
      { "Job Number": "J2", "Line Number": "1", "Line Value": null },
      { "Job Number": "J3", "Line Number": "1", "Line Value": null },
    ]);

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(["job_number", "line_number", "line_value"]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      selectedKey: ["job_number", "line_number", "line_value"],
      manualCandidate: false,
      manualValidation: { ok: false, nullCount: 2, duplicateCount: 0 },
      blocked: false,
    });
    expect(body.warnings.join(" ")).toContain("null key values");
  });

  it("previews a manually selected key after staged upload validation", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: ["line_value"],
    });

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(["line_value"]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedKey: ["line_value"],
      manualCandidate: true,
      manualValidation: { ok: true, nullCount: 0, duplicateCount: 0 },
      ddl: plan.ddl,
    });
  });

  it("rejects a manually selected key with staged upload nulls", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["not_a_candidate"],
    }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      manualCandidate: true,
      manualValidation: { ok: false, nullCount: 2 },
      blocked: true,
    });
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("revalidates the staged upload before DDL", async () => {
    mockLoadRowsFromGateFile.mockResolvedValue([
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
    ]);

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["job_number", "line_number", "line_value"],
      confirm: true,
      confirmedDdl: [],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: "KEY_DRIFT",
      error: "Selected key no longer validates against the staged upload.",
      manualValidation: { ok: false, duplicateCount: 1 },
    });
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmed DDL", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["job_number", "line_number", "line_value"],
      confirm: true,
      confirmedDdl: ["DROP TABLE nope;"],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Confirmed DDL does not match the current generated key replacement plan.",
    });
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });

  it("updates RealmGate key metadata and pushes with the approved key", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: ["job_number", "line_number", "line_value"],
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["job_number", "line_number", "line_value"],
      confirm: true,
      confirmedDdl: plan.ddl,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pushId: "push_1",
      status: "SUCCESS",
    });
    expect(mockProviderQuery).toHaveBeenCalledWith(mockProviderConn, plan.ddl[0]);
    expect(mockRealmGateUpdate).toHaveBeenCalledWith({
      where: { id: "gate_1" },
      data: expect.objectContaining({
        primaryKeyColumns: ["Job Number", "Line Number", "Line Value"],
        keyConstraintName: plan.constraintName,
        keyHistory: [
          expect.objectContaining({
            pushId: "push_1",
            newKey: ["job_number", "line_number", "line_value"],
            constraintName: plan.constraintName,
          }),
        ],
      }),
    });
    expect(mockExecutePush).toHaveBeenCalledWith("gate_1", "push_1", expect.any(Buffer), ".csv");
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("approves a manually selected key after validation and matching DDL", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: ["line_value"],
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["line_value"],
      confirm: true,
      confirmedDdl: plan.ddl,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pushId: "push_1",
      status: "SUCCESS",
    });
    expect(mockRealmGateUpdate).toHaveBeenCalledWith({
      where: { id: "gate_1" },
      data: expect.objectContaining({
        primaryKeyColumns: ["Line Value"],
        keyConstraintName: plan.constraintName,
      }),
    });
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: expect.objectContaining({
        status: "VALIDATED",
        keyDrift: expect.objectContaining({
          selectedKey: ["line_value"],
          manualSelection: true,
          manualValidation: expect.objectContaining({ ok: true }),
        }),
      }),
    });
  });

  it("cancels KEY_DRIFT review and deletes the staged file", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({ action: "CANCEL" }));

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

  it("does not report SUCCESS or delete the staged file when post-DDL push fails", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: ["job_number", "line_number", "line_value"],
    });
    mockExecutePush.mockResolvedValue({
      status: "FAILED",
      rowCount: 2,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsErrored: 2,
      blankRowsSkipped: 0,
      errorMessage: "Gate push failed for all rows.",
      duration: 42,
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(request({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: ["job_number", "line_number", "line_value"],
      confirm: true,
      confirmedDdl: plan.ddl,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "FAILED",
      rowsErrored: 2,
    });
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });
});
