import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareMappedRowsForPush,
  type ColumnMap,
  type KeyDriftDetails,
} from "@/lib/gates/push-executor";
import { discoverGateKeyCandidates } from "@/lib/gates/gate-ucc-discovery";
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

const originalKey = ["job_number", "7501_line_number"];
const hardenedKey = ["job_number", "7501_line_number", "line_entered_value"];

const columnMapping: ColumnMap[] = [
  { sourceColumn: "job_number", destinationColumn: "job_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "7501_line_number", destinationColumn: "7501_line_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "line_entered_value", destinationColumn: "line_entered_value", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "entry_no_", destinationColumn: "entry_no_", sourceType: "TEXT", destType: "TEXT" },
];

function buildLoves2025Rows(): Record<string, unknown>[] {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    job_number: `SNGB${String(index + 1).padStart(7, "0")}`,
    "7501_line_number": String((index % 9) + 1).padStart(4, "0"),
    line_entered_value: `VALUE-${index + 1}`,
    entry_no_: `ENTRY-${index + 1}`,
  }));

  rows[4] = {
    job_number: "SNGB0097414",
    "7501_line_number": "0001",
    line_entered_value: "110.25",
    entry_no_: "ENTRY-1144",
  };
  rows[5] = {
    job_number: "SNGB0097414",
    "7501_line_number": "0001",
    line_entered_value: "115.75",
    entry_no_: "ENTRY-1145",
  };
  rows[10] = {
    job_number: "SNGB0097746",
    "7501_line_number": "0001",
    line_entered_value: "210.00",
    entry_no_: "ENTRY-1205",
  };
  rows[11] = {
    job_number: "SNGB0097746",
    "7501_line_number": "0001",
    line_entered_value: "211.00",
    entry_no_: "ENTRY-1206",
  };
  rows[18] = {
    job_number: "SNGB0102183",
    "7501_line_number": "0007",
    line_entered_value: "310.00",
    entry_no_: "ENTRY-1548",
  };
  rows[19] = {
    job_number: "SNGB0102183",
    "7501_line_number": "0007",
    line_entered_value: "315.00",
    entry_no_: "ENTRY-1549",
  };
  rows.push({
    job_number: null,
    "7501_line_number": null,
    line_entered_value: "22901728",
    entry_no_: "ENTRY-INCOMPLETE-2025",
  });

  return rows;
}

function buildLoves2026Rows(): Record<string, unknown>[] {
  return [
    {
      job_number: "SNGB0097414",
      "7501_line_number": "0001",
      line_entered_value: "110.25",
      entry_no_: "ENTRY-1144",
    },
    {
      job_number: "SNGB0097746",
      "7501_line_number": "0001",
      line_entered_value: "210.00",
      entry_no_: "ENTRY-1205",
    },
    {
      job_number: "SNGB0102183",
      "7501_line_number": "0007",
      line_entered_value: "310.00",
      entry_no_: "ENTRY-1548",
    },
    {
      job_number: null,
      "7501_line_number": null,
      line_entered_value: "22901728",
      entry_no_: "ENTRY-INCOMPLETE-2026",
    },
  ];
}

function makeGate(primaryKeyColumns: string[]) {
  return {
    id: "gate_1",
    tenantId: "tenant_1",
    targetSchema: "public",
    targetTable: "loves_lines",
    mergeStrategy: "UPSERT",
    primaryKeyColumns,
    keyConstraintName: "hermod_loves_lines_key",
    keyHistory: [{ changedAt: "2026-01-01T00:00:00.000Z", newKey: primaryKeyColumns }],
    columnMapping,
    connection: {
      id: "conn_1",
      type: "POSTGRES",
      config: {},
      credentials: null,
    },
  };
}

function makePush(keyDrift: KeyDriftDetails) {
  return {
    id: "push_1",
    gateId: "gate_1",
    tenantId: "tenant_1",
    status: "KEY_DRIFT",
    tempFileId: "tmp_1",
    keyDrift,
  };
}

function previewRequest(selectedKey: string[]) {
  return new Request(
    `http://localhost/api/gates/gate_1/push/push_1/resolve?selectedKey=${encodeURIComponent(selectedKey.join(","))}`,
    { method: "GET" }
  );
}

function resolveRequest(body: unknown) {
  return new Request("http://localhost/api/gates/gate_1/push/push_1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function buildDuplicateKeyDrift(rows: Record<string, unknown>[]): Promise<KeyDriftDetails> {
  const prepared = prepareMappedRowsForPush({
    rows,
    columnMapping,
    primaryKeyColumns: originalKey,
    mergeStrategy: "UPSERT",
  });
  expect(prepared.keyDrift).toBeTruthy();
  const discovery = await discoverGateKeyCandidates({
    mappedRows: prepared.mappedRows,
    mappedColumns: columnMapping.map((mapping) => mapping.destinationColumn),
    currentKeyColumns: originalKey,
    thorough: true,
  });

  return {
    ...prepared.keyDrift!,
    candidateKeys: discovery.candidateKeys,
    recommendation: discovery.recommendation,
    validationStats: discovery.validationStats,
    noReliableKeyReason: discovery.noReliableKeyReason,
    discoveryMode: discovery.validationStats.discoveryMode,
    searchExhaustive: discovery.validationStats.searchExhaustive,
    columnsConsidered: discovery.validationStats.columnsConsidered,
    columnsExcluded: discovery.validationStats.columnsExcluded,
    discriminatorColumns: discovery.validationStats.discriminatorColumns,
    currentKeyDuplicateGroupCount: discovery.validationStats.currentKeyDuplicateGroupCount,
    candidateSearchLimits: discovery.validationStats.candidateSearchLimits,
    mappedColumns: columnMapping.map((mapping) => ({
      name: mapping.destinationColumn,
      sourceColumn: mapping.sourceColumn,
      destinationColumn: mapping.destinationColumn,
      nonBlankCount: rows.filter((row) => row[mapping.sourceColumn] != null && row[mapping.sourceColumn] !== "").length,
      nullCount: rows.filter((row) => row[mapping.sourceColumn] == null || row[mapping.sourceColumn] === "").length,
      distinctCount: new Set(rows.map((row) => String(row[mapping.sourceColumn] ?? ""))).size,
      isCurrentKey: originalKey.includes(mapping.destinationColumn),
      isDiscriminator: mapping.destinationColumn === "line_entered_value",
    })),
  };
}

function buildBlankOnlyKeyDrift(rows: Record<string, unknown>[]): KeyDriftDetails {
  const prepared = prepareMappedRowsForPush({
    rows,
    columnMapping,
    primaryKeyColumns: hardenedKey,
    mergeStrategy: "UPSERT",
  });
  expect(prepared.keyDrift).toBeTruthy();
  return prepared.keyDrift!;
}

describe("Gate key hardening real-world acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderConnect.mockResolvedValue(mockProviderConn);
    mockProviderQuery.mockImplementation(async (_conn, sql: string) => {
      if (sql.includes("pg_constraint")) {
        return {
          columns: ["name", "type", "column_name", "ordinal_position"],
          rows: [
            { name: "hermod_loves_lines_key", type: "UNIQUE", column_name: "job_number", ordinal_position: 1 },
            { name: "hermod_loves_lines_key", type: "UNIQUE", column_name: "7501_line_number", ordinal_position: 2 },
          ],
        };
      }
      if (sql.includes("hermod_key_dupes") || sql.includes("COUNT(*) AS count")) {
        return { columns: ["count"], rows: [{ count: 0 }] };
      }
      return { columns: [], rows: [] };
    });
    mockReadTempFile.mockResolvedValue({ buffer: Buffer.from("csv"), extension: ".csv" });
    mockExecutePush.mockImplementation(async (_gateId, _pushId, _buffer, _extension, options) => ({
      status: "SUCCESS",
      rowCount: 41,
      rowsInserted: 40,
      rowsUpdated: 0,
      rowsErrored: 0,
      blankRowsSkipped: 0,
      duration: 25,
      keyDrift: options?.keyDriftReviewMetadata,
    }));
  });

  it("hardens the 2025 duplicate current key through UCC and reviewed approval", async () => {
    const rows = buildLoves2025Rows();
    const keyDrift = await buildDuplicateKeyDrift(rows);
    const hardenedCandidate = keyDrift.candidateKeys.find((candidate) =>
      sameColumns(candidate.columns, hardenedKey)
    );

    expect(keyDrift).toMatchObject({
      driftType: "DUPLICATE_AND_BLANK_KEY",
      currentKeyStillUniqueForBusinessRows: false,
      recommendedAction: "HARDEN_KEY",
    });
    expect(keyDrift.duplicateExamples.length).toBeGreaterThan(0);
    expect(keyDrift.nullKeyExamples).toEqual([
      expect.objectContaining({
        rowIndex: 41,
        missingColumns: ["job_number", "7501_line_number"],
      }),
    ]);
    expect(hardenedCandidate).toMatchObject({
      columns: hardenedKey,
      source: "UCC",
      unique: true,
      duplicateCount: 0,
      requiresReview: true,
      reviewReason: "KEY_HAS_NULLS",
    });
    expect(keyDrift.candidateKeys).not.toHaveLength(0);
    expect(keyDrift.discoveryMode).toBe("UCC");
    expect(keyDrift.discoveryMode).not.toBe("CAPPED");
    expect(keyDrift.noReliableKeyReason).toBeNull();

    const gate = makeGate(originalKey);
    mockLoadRowsFromGateFile.mockResolvedValue(rows);
    mockGatePushFindFirst.mockResolvedValue(makePush(keyDrift));
    mockRealmGateFindFirst.mockResolvedValue(gate);
    mockRealmGateUpdate.mockImplementation(async (args) => Object.assign(gate, args.data));

    const { GET, POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const previewResponse = await GET(previewRequest(hardenedKey));
    const preview = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(preview).toMatchObject({
      selectedKey: hardenedKey,
      manualCandidate: false,
      selectedKeyValidForBusinessRows: true,
      requiresIncompleteRowApproval: true,
      incompleteRowsHeld: 1,
      manualValidation: { ok: false, nullCount: 1, duplicateCount: 0 },
      blocked: false,
    });
    expect(preview.ddl.length).toBeGreaterThan(0);
    expect(JSON.stringify(preview)).not.toContain("VALUE-");

    const missingApprovalResponse = await POST(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: hardenedKey,
      confirm: true,
      confirmedDdl: preview.ddl,
    }));
    expect(missingApprovalResponse.status).toBe(409);
    expect(mockProviderQuery).not.toHaveBeenCalledWith(mockProviderConn, preview.ddl[0]);
    expect(mockExecutePush).not.toHaveBeenCalled();

    const approvalResponse = await POST(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: hardenedKey,
      confirm: true,
      confirmedDdl: preview.ddl,
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
    }));
    const approval = await approvalResponse.json();

    expect(approvalResponse.status).toBe(200);
    expect(approval).toMatchObject({
      status: "SUCCESS",
      keyDrift: {
        selectedKey: hardenedKey,
        appliedDdl: preview.ddl,
        incompleteRowsExcluded: 1,
        excludedRowIndexes: [41],
      },
    });
    expect(mockProviderQuery).toHaveBeenCalledWith(mockProviderConn, preview.ddl[0]);
    expect(mockRealmGateUpdate).toHaveBeenCalledWith({
      where: { id: "gate_1" },
      data: expect.objectContaining({
        primaryKeyColumns: hardenedKey,
        keyConstraintName: expect.any(String),
        keyHistory: expect.arrayContaining([
          expect.objectContaining({
            oldKey: originalKey,
            newKey: hardenedKey,
            ddl: preview.ddl,
          }),
        ]),
      }),
    });
    expect(mockExecutePush).toHaveBeenCalledWith(
      "gate_1",
      "push_1",
      expect.any(Buffer),
      ".csv",
      expect.objectContaining({
        excludeRowIndexesForKeyReview: [41],
        keyDriftReviewMetadata: expect.objectContaining({
          selectedKey: hardenedKey,
          appliedDdl: preview.ddl,
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [41],
        }),
      })
    );
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("keeps the 2026 current key when only incomplete key rows are present", async () => {
    const rows = buildLoves2026Rows();
    const keyDrift = buildBlankOnlyKeyDrift(rows);
    const gate = makeGate(hardenedKey);
    const originalConstraintName = gate.keyConstraintName;
    const originalKeyHistory = gate.keyHistory;

    expect(keyDrift).toMatchObject({
      driftType: "BLANK_KEY",
      currentKeyStillUniqueForBusinessRows: true,
      recommendedAction: "REVIEW_INCOMPLETE_ROWS",
      duplicateExamples: [],
      nullKeyExamples: [
        expect.objectContaining({
          rowIndex: 4,
          missingColumns: ["job_number", "7501_line_number"],
        }),
      ],
    });

    mockLoadRowsFromGateFile.mockResolvedValue(rows);
    mockGatePushFindFirst.mockResolvedValue(makePush(keyDrift));
    mockRealmGateFindFirst.mockResolvedValue(gate);
    mockRealmGateUpdate.mockImplementation(async (args) => Object.assign(gate, args.data));

    const { POST } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await POST(resolveRequest({
      action: "APPROVE_INCOMPLETE_ROW_EXCLUSION",
      selectedKey: hardenedKey,
      confirm: true,
      incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "SUCCESS",
      keyDrift: {
        driftType: "BLANK_KEY",
        incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
        incompleteRowsExcluded: 1,
        excludedRowIndexes: [4],
      },
    });
    expect(payload.keyDrift.appliedDdl).toBeUndefined();
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
    expect(gate.primaryKeyColumns).toEqual(hardenedKey);
    expect(gate.keyConstraintName).toBe(originalConstraintName);
    expect(gate.keyHistory).toBe(originalKeyHistory);
    expect(mockExecutePush).toHaveBeenCalledWith(
      "gate_1",
      "push_1",
      expect.any(Buffer),
      ".csv",
      expect.objectContaining({
        excludeRowIndexesForKeyReview: [4],
        keyDriftReviewMetadata: expect.objectContaining({
          driftType: "BLANK_KEY",
          incompleteRowAction: "EXCLUDE_REVIEWED_ROWS",
          incompleteRowsExcluded: 1,
          excludedRowIndexes: [4],
        }),
      })
    );
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });
});

function sameColumns(left: string[], right: string[]): boolean {
  return left.map((column) => column.toLowerCase()).sort().join("|") ===
    right.map((column) => column.toLowerCase()).sort().join("|");
}
