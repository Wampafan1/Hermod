import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJobLineValueRows,
  jobLineValueCurrentKey,
  jobLineValueHardenedKey,
  jobLineValueMapping,
} from "./fixtures/key-drift-job-line-value";

const {
  state,
  mockAnalyzeFile,
  mockGatePushCreate,
  mockGatePushFindFirst,
  mockGatePushUpdate,
  mockRealmGateFindFirst,
  mockRealmGateFindUniqueOrThrow,
  mockRealmGateUpdate,
  mockSaveTempFile,
  mockReadTempFile,
  mockDeleteTempFile,
  mockProviderConnect,
  mockProviderQuery,
  mockProviderConn,
  mockEnsureBossStarted,
  mockBossSend,
} = vi.hoisted(() => {
  const state = {
    gate: null as any,
    push: null as any,
    csvBuffer: Buffer.alloc(0),
    providerMode: "success" as "success" | "destinationDuplicate" | "ddlFailure" | "upsertFailure",
    gateUpdates: [] as any[],
    pushUpdates: [] as any[],
  };

  return {
    state,
    mockAnalyzeFile: vi.fn(),
    mockGatePushCreate: vi.fn(),
    mockGatePushFindFirst: vi.fn(),
    mockGatePushUpdate: vi.fn(),
    mockRealmGateFindFirst: vi.fn(),
    mockRealmGateFindUniqueOrThrow: vi.fn(),
    mockRealmGateUpdate: vi.fn(),
    mockSaveTempFile: vi.fn(),
    mockReadTempFile: vi.fn(),
    mockDeleteTempFile: vi.fn(),
    mockProviderConnect: vi.fn(),
    mockProviderQuery: vi.fn(),
    mockProviderConn: { close: vi.fn() },
    mockEnsureBossStarted: vi.fn(),
    mockBossSend: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  withAuth: (handler: any) => async (req: Request) => {
    try {
      return await handler(req, {
        userId: "user_1",
        tenantId: "tenant_1",
        role: "ADMIN",
        user: { id: "user_1", tenantId: "tenant_1" },
        session: { user: { id: "user_1", tenantId: "tenant_1", role: "ADMIN" } },
      });
    } catch {
      return Response.json(
        { error: "An internal error occurred. Please try again or contact support." },
        { status: 500 }
      );
    }
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    realmGate: {
      findFirst: mockRealmGateFindFirst,
      findUniqueOrThrow: mockRealmGateFindUniqueOrThrow,
      update: mockRealmGateUpdate,
    },
    gatePush: {
      create: mockGatePushCreate,
      findFirst: mockGatePushFindFirst,
      update: mockGatePushUpdate,
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
    analyzeCSV: vi.fn(),
    analyzeExcel: vi.fn(),
    FileAnalysisError,
  };
});

vi.mock("@/lib/gates/temp-files", () => ({
  saveTempFile: mockSaveTempFile,
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

vi.mock("@/lib/pg-boss", () => ({
  ensureBossStarted: mockEnsureBossStarted,
}));

function csvFromRows(rows: Record<string, unknown>[]): Buffer<ArrayBuffer> {
  const columns = ["job_number", "7501_line_number", "line_entered_value"];
  const body = rows
    .map((row) => columns.map((column) => String(row[column] ?? "")).join(","))
    .join("\n");
  return Buffer.from(`${columns.join(",")}\n${body}`);
}

function pushRequest() {
  const formData = new FormData();
  formData.append("file", new Blob([state.csvBuffer], { type: "text/csv" }), "repeat.csv");
  return new Request("http://localhost/api/gates/gate_1/push", {
    method: "POST",
    body: formData,
  });
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

async function stageAndValidatePush() {
  const { POST: stagePush } = await import("@/app/api/gates/[gateId]/push/route");
  const stageResponse = await stagePush(pushRequest());
  const staged = await stageResponse.json();
  expect(stageResponse.status).toBe(200);
  expect(staged).toMatchObject({
    pushId: "push_1",
    status: "VALIDATING",
    validationStage: "RECEIVED",
  });

  const { validateStagedGatePush } = await import("@/lib/gates/push-validation");
  await validateStagedGatePush({
    pushId: "push_1",
    gateId: "gate_1",
    tenantId: "tenant_1",
    tempFileId: "tmp_1",
  });

  return staged;
}

function setupGateKeyHardeningFlow() {
  state.csvBuffer = csvFromRows(buildJobLineValueRows());
  state.providerMode = "success";
  state.gateUpdates = [];
  state.pushUpdates = [];
  state.push = null;
  state.gate = {
    id: "gate_1",
    tenantId: "tenant_1",
    status: "ACTIVE",
    name: "Orders Gate",
    targetSchema: "public",
    targetTable: "orders",
    mergeStrategy: "UPSERT",
    primaryKeyColumns: jobLineValueCurrentKey,
    keyConstraintName: null,
    keyHistory: null,
    columnMapping: jobLineValueMapping,
    savedSchema: jobLineValueMapping.map((mapping) => ({
      name: mapping.sourceColumn,
      duckdbType: "VARCHAR",
      inferredType: "TEXT",
      nullable: true,
    })),
    connection: {
      id: "conn_1",
      name: "Postgres",
      type: "POSTGRES",
      config: {},
      credentials: null,
    },
  };

  mockAnalyzeFile.mockResolvedValue({
    rowCount: buildJobLineValueRows().length,
    columns: state.gate.savedSchema,
  });
  mockSaveTempFile.mockResolvedValue("tmp_1");
  mockReadTempFile.mockResolvedValue({ buffer: state.csvBuffer, extension: ".csv" });
  mockEnsureBossStarted.mockResolvedValue({ send: mockBossSend });
  mockProviderConnect.mockResolvedValue(mockProviderConn);
  mockRealmGateFindFirst.mockImplementation(async () => state.gate);
  mockRealmGateFindUniqueOrThrow.mockImplementation(async () => state.gate);
  mockRealmGateUpdate.mockImplementation(async (args) => {
    state.gateUpdates.push(args);
    state.gate = { ...state.gate, ...args.data };
    return state.gate;
  });
  mockGatePushCreate.mockImplementation(async (args) => {
    state.push = {
      id: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      tempFileId: args.data.tempFileId ?? null,
      createdAt: new Date("2026-05-09T12:00:00.000Z"),
      completedAt: null,
      ...args.data,
    };
    return state.push;
  });
  mockGatePushFindFirst.mockImplementation(async () => state.push);
  mockGatePushUpdate.mockImplementation(async (args) => {
    state.pushUpdates.push(args);
    state.push = { ...state.push, ...args.data };
    return state.push;
  });
  mockProviderQuery.mockImplementation(async (_conn, sql: string) => queryResultFor(sql));
}

function queryResultFor(sql: string) {
  if (sql.includes("pg_constraint")) {
    return {
      columns: ["name", "type", "column_name", "ordinal_position"],
      rows: [
        { name: "hermod_orders_current_uk", type: "UNIQUE", column_name: "job_number", ordinal_position: 1 },
        { name: "hermod_orders_current_uk", type: "UNIQUE", column_name: "7501_line_number", ordinal_position: 2 },
      ],
    };
  }

  if (sql.includes("hermod_key_dupes")) {
    return {
      columns: ["count"],
      rows: [{ count: state.providerMode === "destinationDuplicate" ? 1 : 0 }],
    };
  }

  if (sql.includes("COUNT(*) AS count")) {
    return { columns: ["count"], rows: [{ count: 0 }] };
  }

  if (sql.startsWith("ALTER TABLE") && state.providerMode === "ddlFailure") {
    throw new Error("DDL failed");
  }

  if (sql.startsWith("INSERT INTO") && state.providerMode === "upsertFailure") {
    throw new Error("UPSERT failed");
  }

  return { columns: [], rows: [] };
}

describe("Gate key hardening end-to-end acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGateKeyHardeningFlow();
  });

  it("runs KEY_DRIFT to approved key replacement to successful reviewed push", async () => {
    await stageAndValidatePush();
    expect(mockGatePushCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "VALIDATING",
      }),
    });
    expect(mockGatePushCreate.mock.calls[0][0].data.tempFileId).toBeUndefined();
    expect(mockBossSend).toHaveBeenCalledWith("gate-validate-push", expect.objectContaining({
      pushId: "push_1",
      gateId: "gate_1",
      tenantId: "tenant_1",
      tempFileId: "tmp_1",
    }), expect.objectContaining({
      singletonKey: "gate-validate-push_1",
    }));
    const staged = state.push;
    expect(staged).toMatchObject({
      status: "KEY_DRIFT",
      blankRowsSkipped: 1,
    });
    expect(staged.keyDrift.oldKey).toEqual(jobLineValueCurrentKey);
    expect(staged.keyDrift.duplicateExamples).toEqual([
      {
        keyValues: { job_number: "SNGB0097414", "7501_line_number": "0001" },
        rowIndexes: [1144, 1145],
      },
      {
        keyValues: { job_number: "SNGB0097746", "7501_line_number": "0001" },
        rowIndexes: [1205, 1206],
      },
      {
        keyValues: { job_number: "SNGB0102183", "7501_line_number": "0007" },
        rowIndexes: [1548, 1549],
      },
    ]);
    expect(staged.keyDrift.nullKeyExamples).toEqual([]);
    expect(staged.keyDrift.candidateKeys.some((candidate: { columns: string[] }) =>
      candidate.columns.join("|") === jobLineValueHardenedKey.join("|")
    )).toBe(true);
    expect(JSON.stringify(staged)).not.toContain("VALUE-");
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();

    const { GET, POST: resolvePush } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const previewResponse = await GET(previewRequest(jobLineValueHardenedKey));
    const preview = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(preview).toMatchObject({
      selectedKey: jobLineValueHardenedKey,
      requiresConfirmation: true,
      blocked: false,
      manualValidation: { ok: true },
    });
    expect(preview.ddl.length).toBeGreaterThan(0);

    const mismatchResponse = await resolvePush(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: jobLineValueHardenedKey,
      confirm: true,
      confirmedDdl: ["DROP TABLE nope;"],
    }));
    expect(mismatchResponse.status).toBe(400);
    expect(state.gate.primaryKeyColumns).toEqual(jobLineValueCurrentKey);

    const approvalResponse = await resolvePush(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: jobLineValueHardenedKey,
      confirm: true,
      confirmedDdl: preview.ddl,
    }));
    const approval = await approvalResponse.json();

    expect(approvalResponse.status).toBe(200);
    expect(approval).toMatchObject({
      pushId: "push_1",
      status: "SUCCESS",
      rowsErrored: 0,
      blankRowsSkipped: 1,
    });
    expect(state.push.status).toBe("SUCCESS");
    expect(state.gate.primaryKeyColumns).toEqual(jobLineValueHardenedKey);
    expect(state.gate.keyConstraintName).toBeTruthy();
    expect(state.gate.keyHistory).toEqual([
      expect.objectContaining({
        pushId: "push_1",
        oldKey: jobLineValueCurrentKey,
        newKey: jobLineValueHardenedKey,
        constraintName: state.gate.keyConstraintName,
      }),
    ]);
    expect(mockProviderQuery).toHaveBeenCalledWith(mockProviderConn, preview.ddl[0]);
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("blocks invalid manual keys and preserves KEY_DRIFT", async () => {
    await stageAndValidatePush();

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(jobLineValueCurrentKey));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      status: "KEY_DRIFT",
      selectedKey: jobLineValueCurrentKey,
      manualValidation: { ok: false },
      blocked: true,
    });
    expect(state.push.status).toBe("KEY_DRIFT");
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("blocks manual keys with blank values and preserves KEY_DRIFT", async () => {
    await stageAndValidatePush();

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(["not_a_column"]));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      status: "KEY_DRIFT",
      manualValidation: { ok: false, nullCount: 1550 },
      blocked: true,
    });
    expect(state.push.status).toBe("KEY_DRIFT");
    expect(mockProviderQuery).not.toHaveBeenCalled();
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("blocks DDL when destination validation fails", async () => {
    await stageAndValidatePush();
    state.providerMode = "destinationDuplicate";

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(jobLineValueHardenedKey));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      status: "KEY_DRIFT",
      selectedKey: jobLineValueHardenedKey,
      blocked: true,
      blockReason: "Selected key has duplicate combinations in the existing destination table.",
    });
    expect(state.push.status).toBe("KEY_DRIFT");
    expect(state.gate.primaryKeyColumns).toEqual(jobLineValueCurrentKey);
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("does not report success when DDL execution fails", async () => {
    await stageAndValidatePush();

    const { GET, POST: resolvePush } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const preview = await (await GET(previewRequest(jobLineValueHardenedKey))).json();
    state.providerMode = "ddlFailure";

    const response = await resolvePush(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: jobLineValueHardenedKey,
      confirm: true,
      confirmedDdl: preview.ddl,
    }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.status).not.toBe("SUCCESS");
    expect(state.push.status).toBe("KEY_DRIFT");
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("marks post-DDL upsert failures as FAILED and preserves the staged file", async () => {
    await stageAndValidatePush();

    const { GET, POST: resolvePush } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const preview = await (await GET(previewRequest(jobLineValueHardenedKey))).json();
    state.providerMode = "upsertFailure";

    const response = await resolvePush(resolveRequest({
      action: "APPROVE_KEY_HARDENING",
      selectedKey: jobLineValueHardenedKey,
      confirm: true,
      confirmedDdl: preview.ddl,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "FAILED",
      rowsErrored: 1550,
    });
    expect(payload.status).not.toBe("SUCCESS");
    expect(state.push.status).toBe("FAILED");
    expect(mockDeleteTempFile).not.toHaveBeenCalled();
  });

  it("cancels KEY_DRIFT and deletes the staged temp file", async () => {
    await stageAndValidatePush();

    const { POST: resolvePush } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await resolvePush(resolveRequest({ action: "CANCEL" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ pushId: "push_1", status: "CANCELLED" });
    expect(state.push.status).toBe("CANCELLED");
    expect(state.push.tempFileId).toBeNull();
    expect(mockDeleteTempFile).toHaveBeenCalledWith("tmp_1");
  });

  it("returns 410 for expired staged files without changing key constraints", async () => {
    await stageAndValidatePush();
    mockReadTempFile.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/gates/[gateId]/push/[pushId]/resolve/route");
    const response = await GET(previewRequest(jobLineValueHardenedKey));
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(payload).toEqual({ error: "Temp file expired or missing" });
    expect(state.gate.primaryKeyColumns).toEqual(jobLineValueCurrentKey);
    expect(mockRealmGateUpdate).not.toHaveBeenCalled();
  });
});
