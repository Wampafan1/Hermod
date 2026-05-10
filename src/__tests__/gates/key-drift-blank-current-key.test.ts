import { beforeEach, describe, expect, it, vi } from "vitest";
import { preflightUpsertKey } from "@/lib/gates/push-executor";

const {
  mockGatePushFindFirst,
  mockGatePushUpdate,
  mockRealmGateFindFirst,
  mockRealmGateUpdate,
  mockReadTempFile,
  mockDeleteTempFile,
  mockExecutePush,
  mockLoadRowsFromGateFile,
  mockProviderQuery,
} = vi.hoisted(() => ({
  mockGatePushFindFirst: vi.fn(),
  mockGatePushUpdate: vi.fn(),
  mockRealmGateFindFirst: vi.fn(),
  mockRealmGateUpdate: vi.fn(),
  mockReadTempFile: vi.fn(),
  mockDeleteTempFile: vi.fn(),
  mockExecutePush: vi.fn(),
  mockLoadRowsFromGateFile: vi.fn(),
  mockProviderQuery: vi.fn(),
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
    connect: vi.fn(),
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

const currentKey = ["job_number", "7501_line_number", "line_entered_value"];

const blankOnlyKeyDrift = {
  oldKey: currentKey,
  driftType: "BLANK_KEY",
  currentKeyStillUniqueForBusinessRows: true,
  requiresIncompleteRowApproval: true,
  incompleteRowsHeld: 1,
  incompleteRowExamples: [
    {
      rowIndex: 3,
      keyValues: {
        job_number: "",
        "7501_line_number": "",
        line_entered_value: "22901728",
      },
      missingColumns: ["job_number", "7501_line_number"],
    },
  ],
  duplicateExamples: [],
  nullKeyExamples: [
    {
      rowIndex: 3,
      keyValues: {
        job_number: "",
        "7501_line_number": "",
        line_entered_value: "22901728",
      },
      missingColumns: ["job_number", "7501_line_number"],
    },
  ],
  reason: "Current UPSERT key has blank values in this upload.",
  candidateKeys: [
    {
      columns: ["entry_no_", "7501_line_number", "line_entered_value"],
      unique: true,
      nullCount: 0,
      duplicateCount: 0,
      coverage: 1,
      width: 3,
      score: 990,
      source: "UCC",
    },
  ],
  recommendation: {
    columns: ["entry_no_", "7501_line_number", "line_entered_value"],
    score: 990,
    source: "DETERMINISTIC",
    reason: "Alternate verified key.",
  },
  recommendedAction: "REVIEW_INCOMPLETE_ROWS",
  validationStats: null,
  selectedKey: null,
};

const gate = {
  id: "gate_1",
  tenantId: "tenant_1",
  targetSchema: "public",
  targetTable: "orders",
  mergeStrategy: "UPSERT",
  primaryKeyColumns: ["Job Number", "7501 Line Number", "Line Entered Value"],
  keyConstraintName: "hermod_orders_key",
  keyHistory: [{ old: "history" }],
  columnMapping: [
    { sourceColumn: "Job Number", destinationColumn: "job_number", sourceType: "TEXT", destType: "TEXT" },
    { sourceColumn: "7501 Line Number", destinationColumn: "7501_line_number", sourceType: "TEXT", destType: "TEXT" },
    { sourceColumn: "Line Entered Value", destinationColumn: "line_entered_value", sourceType: "TEXT", destType: "TEXT" },
    { sourceColumn: "Entry No.", destinationColumn: "entry_no_", sourceType: "TEXT", destType: "TEXT" },
  ],
  connection: {
    id: "conn_1",
    type: "POSTGRES",
    config: {},
    credentials: null,
  },
};

function resolveRequest(body: unknown) {
  return new Request("http://localhost/api/gates/gate_1/push/push_1/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("blank-only current-key Gate drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTempFile.mockResolvedValue({ buffer: Buffer.from("csv"), extension: ".csv" });
    mockLoadRowsFromGateFile.mockResolvedValue([
      {
        "Job Number": "SNGB0097414",
        "7501 Line Number": "0001",
        "Line Entered Value": "100",
        "Entry No.": "1",
      },
      {
        "Job Number": "SNGB0097746",
        "7501 Line Number": "0001",
        "Line Entered Value": "200",
        "Entry No.": "2",
      },
      {
        "Job Number": "",
        "7501 Line Number": "",
        "Line Entered Value": "22901728",
        "Entry No.": "3",
      },
    ]);
    mockGatePushFindFirst.mockResolvedValue({
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      status: "KEY_DRIFT",
      tempFileId: "tmp_1",
      keyDrift: blankOnlyKeyDrift,
    });
    mockRealmGateFindFirst.mockResolvedValue(gate);
    mockExecutePush.mockResolvedValue({
      status: "SUCCESS",
      rowCount: 3,
      rowsInserted: 2,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 0,
      duration: 25,
    });
  });

  it("marks blank-only failures as incomplete-row review instead of duplicate key drift", () => {
    const result = preflightUpsertKey({
      primaryKeyColumns: currentKey,
      rows: [
        {
          rowIndex: 1,
          row: {
            job_number: "SNGB0097414",
            "7501_line_number": "0001",
            line_entered_value: "100",
          },
        },
        {
          rowIndex: 2,
          row: {
            job_number: "SNGB0097746",
            "7501_line_number": "0001",
            line_entered_value: "200",
          },
        },
        {
          rowIndex: 3,
          row: {
            job_number: "",
            "7501_line_number": "",
            line_entered_value: "22901728",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      keyDrift: {
        driftType: "BLANK_KEY",
        currentKeyStillUniqueForBusinessRows: true,
        requiresIncompleteRowApproval: true,
        incompleteRowsHeld: 1,
        recommendedAction: "REVIEW_INCOMPLETE_ROWS",
        duplicateExamples: [],
      },
    });
  });

  it("keeps the current key and pushes after explicit incomplete-row exclusion approval", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_INCOMPLETE_ROW_EXCLUSION",
      selectedKey: currentKey,
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
      confirm: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "SUCCESS" });
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
    expect(mockGatePushUpdate).toHaveBeenCalledWith({
      where: { id: "push_1" },
      data: expect.objectContaining({
        status: "VALIDATED",
        keyDrift: expect.objectContaining({
          driftType: "BLANK_KEY",
          selectedKey: currentKey,
          incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [3],
        }),
      }),
    });
    expect(mockExecutePush).toHaveBeenCalledWith(
      "gate_1",
      "push_1",
      expect.any(Buffer),
      ".csv",
      expect.objectContaining({
        excludeRowIndexesForKeyReview: [3],
        keyDriftReviewMetadata: expect.objectContaining({
          selectedKey: currentKey,
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [3],
        }),
      })
    );
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("requires explicit incomplete-row approval before pushing with the current key", async () => {
    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_INCOMPLETE_ROW_EXCLUSION",
      selectedKey: currentKey,
      confirm: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      currentKeyStillUniqueForBusinessRows: true,
      requiresIncompleteRowApproval: true,
      incompleteRowsHeld: 1,
      blockReason: "Approve excluding the reviewed incomplete rows or cancel and fix the file.",
    });
    expect(mockExecutePush).not.toHaveBeenCalled();
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });

  it("does not allow keep-current-key exclusion when duplicates are present", async () => {
    mockLoadRowsFromGateFile.mockResolvedValue([
      {
        "Job Number": "SNGB0097414",
        "7501 Line Number": "0001",
        "Line Entered Value": "100",
        "Entry No.": "1",
      },
      {
        "Job Number": "SNGB0097414",
        "7501 Line Number": "0001",
        "Line Entered Value": "100",
        "Entry No.": "2",
      },
      {
        "Job Number": "",
        "7501 Line Number": "",
        "Line Entered Value": "22901728",
        "Entry No.": "3",
      },
    ]);

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_INCOMPLETE_ROW_EXCLUSION",
      selectedKey: currentKey,
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
      confirm: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "KEY_DRIFT",
      currentKeyStillUniqueForBusinessRows: false,
      blockReason: "Duplicate current-key values require choosing a hardened key.",
    });
    expect(mockExecutePush).not.toHaveBeenCalled();
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });
});
