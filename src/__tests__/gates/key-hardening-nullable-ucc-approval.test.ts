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

const selectedKey = ["job_number", "line_number", "line_value"];

const nullableCandidate = {
  columns: selectedKey,
  unique: true,
  nullCount: 1,
  duplicateCount: 0,
  coverage: 0.99,
  width: 3,
  score: 980,
  source: "UCC",
  requiresReview: true,
  reviewReason: "KEY_HAS_NULLS",
};

const keyDrift = {
  oldKey: ["job_number", "line_number"],
  duplicateExamples: [],
  nullKeyExamples: [],
  reason: "Current UPSERT key has duplicate values in this upload.",
  candidateKeys: [nullableCandidate],
  recommendation: {
    columns: selectedKey,
    score: 980,
    source: "DETERMINISTIC",
    reason: "UCC discovery verified this key with null values requiring review.",
  },
  validationStats: {
    rowCount: 3,
    inputRowCount: 3,
    blankRowsSkipped: 0,
    columnsAnalyzed: 3,
    combinationsTested: 1,
    maxWidth: 4,
    maxColumns: 3,
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

function previewRequest(key = selectedKey) {
  return new Request(
    `http://localhost/api/gates/gate_1/push/push_1/resolve?selectedKey=${encodeURIComponent(key.join(","))}`,
    { method: "GET" }
  );
}

function resolveRequest(body: unknown) {
  return new Request("http://localhost/api/gates/gate_1/push/push_1/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("nullable UCC Gate key approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderConnect.mockResolvedValue(mockProviderConn);
    mockProviderQuery.mockResolvedValue({ columns: ["count"], rows: [{ count: 0 }] });
    mockReadTempFile.mockResolvedValue({ buffer: Buffer.from("csv"), extension: ".csv" });
    mockLoadRowsFromGateFile.mockResolvedValue([
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "J1", "Line Number": "1", "Line Value": "B" },
      { "Job Number": "", "Line Number": "", "Line Value": "22901728" },
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
      rowCount: 3,
      rowsInserted: 2,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 0,
      duration: 42,
    });
  });

  it("previews a verified nullable UCC candidate as reviewable instead of invalid", async () => {
    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      selectedKey,
      manualCandidate: false,
      selectedKeyValidForBusinessRows: true,
      requiresIncompleteRowApproval: true,
      incompleteRowsHeld: 1,
      incompleteRowExamples: [
        {
          rowIndex: 3,
          missingColumns: ["job_number", "line_number"],
          keyValues: {
            job_number: "",
            line_number: "",
            line_value: "22901728",
          },
        },
      ],
      manualValidation: {
        ok: false,
        nullCount: 1,
        duplicateCount: 0,
      },
      blocked: false,
    });
    expect(body.error ?? "").not.toContain("Selected key is not valid");
    expect(JSON.stringify(body)).not.toContain("rawRows");
  });

  it("blocks approval without explicit incomplete-row action and does not run DDL", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: selectedKey,
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey,
      confirm: true,
      confirmedDdl: plan.ddl,
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      requiresIncompleteRowApproval: true,
      incompleteRowsHeld: 1,
      blockReason: "Approve excluding the reviewed incomplete rows or cancel and fix the file.",
    });
    expect(mockProviderQuery).not.toHaveBeenCalledWith(mockProviderConn, plan.ddl[0]);
    expect(mockExecutePush).not.toHaveBeenCalled();
  });

  it("executes DDL and pushes with only reviewed incomplete rows excluded after explicit approval", async () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["job_number", "line_number"],
      newKey: selectedKey,
    });

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey,
      confirm: true,
      confirmedDdl: plan.ddl,
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "SUCCESS" });
    expect(mockProviderQuery).toHaveBeenCalledWith(mockProviderConn, plan.ddl[0]);
    expect(mockExecutePush).toHaveBeenCalledWith(
      "gate_1",
      "push_1",
      expect.any(Buffer),
      ".csv",
      expect.objectContaining({
        excludeRowIndexesForKeyReview: [3],
        keyDriftReviewMetadata: expect.objectContaining({
          incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [3],
        }),
      })
    );
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: expect.objectContaining({
        status: "VALIDATED",
        keyDrift: expect.objectContaining({
          incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [3],
        }),
      }),
    });
  });

  it("still blocks duplicate selected-key rows", async () => {
    mockLoadRowsFromGateFile.mockResolvedValue([
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "J1", "Line Number": "1", "Line Value": "A" },
      { "Job Number": "", "Line Number": "", "Line Value": "22901728" },
    ]);

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      blocked: true,
      manualValidation: { duplicateCount: 1 },
    });
    expect(mockProviderQuery).not.toHaveBeenCalled();
  });

  it("still blocks destination validation failures", async () => {
    mockProviderQuery.mockImplementation(async (_conn, sql: string) => {
      if (sql.includes("hermod_key_dupes")) {
        return { columns: ["count"], rows: [{ count: 1 }] };
      }
      return { columns: ["count"], rows: [{ count: 0 }] };
    });

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      blocked: true,
      blockReason: "Selected key has duplicate combinations in the existing destination table.",
    });
  });

  it("still blocks mismatched confirmed DDL", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey,
      confirm: true,
      confirmedDdl: ["DROP TABLE nope;"],
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Confirmed DDL does not match the current generated key replacement plan.",
    });
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });
});
