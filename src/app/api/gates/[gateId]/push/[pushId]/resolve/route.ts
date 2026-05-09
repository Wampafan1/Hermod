import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { readTempFile, deleteTempFile } from "@/lib/gates/temp-files";
import {
  executePush,
  loadRowsFromGateFile,
  prepareMappedRowsForPush,
  type ColumnMap,
  type KeyDriftDetails,
} from "@/lib/gates/push-executor";
import { analyzeCSV, analyzeExcel } from "@/lib/duckdb/file-analyzer";
import {
  generateAlterStatements,
  mapSchemaDiffToDestination,
  type GateColumnMapping,
} from "@/lib/gates/alter-generator";
import type { SchemaDiff } from "@/lib/gates/schema-diff";
import {
  buildReplaceKeyConstraintPlan,
  detectForeignKeyDependencies,
  findHermodManagedKeyConstraint,
  getExistingKeyConstraints,
  validateCandidateKeyInDestination,
  type KeyDdlProviderType,
  type ReplaceKeyConstraintPlan,
} from "@/lib/gates/key-ddl";
import {
  validateSelectedGateKey,
  type SelectedGateKeyValidationResult,
} from "@/lib/gates/key-discovery";

type KeyHardeningAction = "APPROVE_KEY_HARDENING" | "CANCEL";

interface KeyHardeningBody {
  action: KeyHardeningAction;
  selectedKey?: string[];
  confirmedDdl?: string[];
  confirm?: boolean;
}

interface SchemaDriftBody {
  resolution: "ADJUST_DESTINATION" | "ADJUST_FILE";
  executeStatements?: boolean;
  confirmedStatements?: string[];
}

interface KeyHardeningReview {
  plan: ReplaceKeyConstraintPlan;
  tempFile: { buffer: Buffer; extension: string };
  blankRowsSkipped: number;
  manualCandidate: boolean;
  manualValidation: SelectedGateKeyValidationResult;
}

// GET /api/gates/[gateId]/push/[pushId]/resolve?selectedKey=a,b - DDL preview
export const GET = withAuth(async (req, ctx) => {
  const { gateId, pushId } = parseGatePushIds(req.url);
  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  const selectedKey = new URL(req.url).searchParams
    .get("selectedKey")
    ?.split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  if (!selectedKey || selectedKey.length === 0) {
    return NextResponse.json({ error: "selectedKey query parameter is required" }, { status: 400 });
  }

  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });
  if (!push) return NextResponse.json({ error: "Push not found" }, { status: 404 });
  if (push.status !== "KEY_DRIFT") {
    return NextResponse.json(
      { error: `Push is not in KEY_DRIFT status (current: ${push.status})` },
      { status: 400 }
    );
  }

  const gate = await loadGateForResolve(gateId, ctx.tenantId);
  if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

  const keyDrift = parseKeyDrift(push.keyDrift);
  const candidate = findVerifiedCandidate(keyDrift, selectedKey);

  const review = await buildKeyHardeningReview({
    gate,
    push,
    keyDrift,
    selectedKey,
    manualCandidate: !candidate,
  });
  if ("response" in review) return review.response;

  return NextResponse.json({
    selectedKey,
    manualCandidate: review.manualCandidate,
    manualValidation: review.manualValidation,
    ddl: review.plan.ddl,
    warnings: review.plan.warnings,
    blocked: review.plan.blocked,
    blockReason: review.plan.blockReason,
    requiresConfirmation: true,
  });
});

// POST /api/gates/[gateId]/push/[pushId]/resolve
export const POST = withAuth(async (req, ctx) => {
  const { gateId, pushId } = parseGatePushIds(req.url);
  if (!gateId || !pushId) {
    return NextResponse.json({ error: "Missing gateId or pushId" }, { status: 400 });
  }

  const push = await prisma.gatePush.findFirst({
    where: { id: pushId, gateId, tenantId: ctx.tenantId },
  });
  if (!push) return NextResponse.json({ error: "Push not found" }, { status: 404 });

  const body = await req.json();
  if (isKeyHardeningBody(body)) {
    return resolveKeyDriftPush({ body, gateId, pushId, push, tenantId: ctx.tenantId });
  }

  return resolveSchemaDriftPush({
    body: body as SchemaDriftBody,
    gateId,
    pushId,
    push,
    tenantId: ctx.tenantId,
  });
});

async function resolveKeyDriftPush(input: {
  body: KeyHardeningBody;
  gateId: string;
  pushId: string;
  push: { id: string; status: string; tempFileId: string | null; keyDrift: unknown };
  tenantId: string;
}) {
  if (input.push.status !== "KEY_DRIFT") {
    return NextResponse.json(
      { error: `Push is not in KEY_DRIFT status (current: ${input.push.status})` },
      { status: 400 }
    );
  }

  if (input.body.action === "CANCEL") {
    await prisma.gatePush.update({
      where: { id: input.pushId },
      data: {
        status: "CANCELLED",
        tempFileId: null,
        completedAt: new Date(),
      },
    });
    if (input.push.tempFileId) await deleteTempFile(input.push.tempFileId);
    return NextResponse.json({ pushId: input.pushId, status: "CANCELLED" });
  }

  const selectedKey = input.body.selectedKey?.map((column) => column.trim()).filter(Boolean);
  if (!selectedKey || selectedKey.length === 0) {
    return NextResponse.json({ error: "selectedKey is required" }, { status: 400 });
  }

  const gate = await loadGateForResolve(input.gateId, input.tenantId);
  if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

  const keyDrift = parseKeyDrift(input.push.keyDrift);
  const candidate = findVerifiedCandidate(keyDrift, selectedKey);

  const review = await buildKeyHardeningReview({
    gate,
    push: input.push,
    keyDrift,
    selectedKey,
    manualCandidate: !candidate,
    executeDdl: input.body.confirm === true,
    confirmedDdl: input.body.confirmedDdl,
  });
  if ("response" in review) return review.response;

  if (!input.body.confirm) {
    return NextResponse.json({
      pushId: input.pushId,
      status: "KEY_DRIFT",
      selectedKey,
      manualCandidate: review.manualCandidate,
      manualValidation: review.manualValidation,
      ddl: review.plan.ddl,
      warnings: review.plan.warnings,
      blocked: review.plan.blocked,
      blockReason: review.plan.blockReason,
      requiresConfirmation: true,
    });
  }

  const columnMapping = gate.columnMapping as unknown as ColumnMap[];
  const storedPrimaryKeyColumns = destinationKeyToStoredPrimaryKey(selectedKey, columnMapping);
  const keyHistory = appendKeyHistory(gate.keyHistory, {
    changedAt: new Date().toISOString(),
    pushId: input.pushId,
    oldKey: keyDrift.oldKey,
    newKey: selectedKey,
    storedPrimaryKeyColumns,
    constraintName: review.plan.constraintName,
    ddl: review.plan.ddl,
    warnings: review.plan.warnings,
  });

  await prisma.realmGate.update({
    where: { id: input.gateId },
    data: {
      primaryKeyColumns: storedPrimaryKeyColumns as unknown as Prisma.InputJsonValue,
      keyConstraintName: review.plan.constraintName,
      keyHistory: keyHistory as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.gatePush.update({
    where: { id: input.pushId },
    data: {
      status: "VALIDATED",
      keyDrift: {
        ...keyDrift,
        selectedKey,
        manualSelection: review.manualCandidate,
        manualValidation: review.manualValidation,
        appliedDdl: review.plan.ddl,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await executePush(
      input.gateId,
      input.pushId,
      review.tempFile.buffer,
      review.tempFile.extension
    );
    if (result.status === "SUCCESS" && input.push.tempFileId) {
      await deleteTempFile(input.push.tempFileId);
    }

    return NextResponse.json({
      pushId: input.pushId,
      status: result.status,
      rowCount: result.rowCount,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsErrored: result.rowsErrored,
      blankRowsSkipped: result.blankRowsSkipped,
      keyDrift: result.keyDrift,
      errorMessage: result.errorMessage,
      duration: result.duration,
    });
  } catch (err) {
    return NextResponse.json(
      {
        pushId: input.pushId,
        status: "FAILED",
        error: err instanceof Error ? err.message : "Push failed after key hardening",
      },
      { status: 500 }
    );
  }
}

async function resolveSchemaDriftPush(input: {
  body: SchemaDriftBody;
  gateId: string;
  pushId: string;
  push: { id: string; status: string; tempFileId: string | null; schemaDiff?: unknown };
  tenantId: string;
}) {
  if (input.push.status !== "SCHEMA_DRIFT") {
    return NextResponse.json(
      { error: `Push is not in SCHEMA_DRIFT status (current: ${input.push.status})` },
      { status: 400 }
    );
  }

  const { resolution, executeStatements, confirmedStatements } = input.body;

  if (resolution === "ADJUST_FILE") {
    await prisma.gatePush.update({
      where: { id: input.pushId },
      data: {
        status: "CANCELLED",
        driftResolution: "ADJUSTED_FILE",
        completedAt: new Date(),
      },
    });

    if (input.push.tempFileId) await deleteTempFile(input.push.tempFileId);

    return NextResponse.json({ status: "CANCELLED", resolution: "ADJUSTED_FILE" });
  }

  if (resolution !== "ADJUST_DESTINATION") {
    return NextResponse.json({ error: "Invalid resolution type" }, { status: 400 });
  }

  const gate = await loadGateForResolve(input.gateId, input.tenantId);
  if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

  const existingMapping = gate.columnMapping as unknown as GateColumnMapping[];
  const sourceDiff = (input.push.schemaDiff ?? {
    added: [],
    removed: [],
    typeChanged: [],
  }) as unknown as SchemaDiff;
  const destinationDiff = mapSchemaDiffToDestination(sourceDiff, existingMapping);
  const generatedStatements = generateAlterStatements(
    gate.connection.type,
    gate.targetSchema || "public",
    gate.targetTable,
    destinationDiff,
    sourceDiff
  );
  const generatedExecutableSql = new Set(
    generatedStatements.filter((stmt) => !stmt.isComment).map((stmt) => stmt.sql)
  );
  const confirmedSql = new Set(confirmedStatements ?? []);
  const unknownStatements = [...confirmedSql].filter((sql) => !generatedExecutableSql.has(sql));

  if (unknownStatements.length > 0) {
    return NextResponse.json(
      { error: "One or more confirmed schema changes no longer match the expected drift plan" },
      { status: 400 }
    );
  }

  const confirmedAddedColumns = new Map(
    generatedStatements
      .filter(
        (stmt) =>
          !stmt.isComment &&
          stmt.sourceColumn &&
          stmt.destinationColumn &&
          confirmedSql.has(stmt.sql)
      )
      .map((stmt) => [
        stmt.sourceColumn!.toLowerCase(),
        {
          sourceColumn: stmt.sourceColumn!,
          destinationColumn: stmt.destinationColumn!,
        },
      ])
  );

  if (executeStatements && confirmedStatements && confirmedStatements.length > 0) {
    const conn = gate.connection;
    const provider = getProvider(conn.type);
    if (!provider.query) {
      return NextResponse.json({ error: "Provider does not support query execution" }, { status: 400 });
    }

    const credentials = conn.credentials ? JSON.parse(decrypt(conn.credentials)) : {};
    const providerConn = await provider.connect({
      type: conn.type,
      config: conn.config as Record<string, unknown>,
      credentials,
    });

    try {
      for (const stmt of generatedStatements) {
        if (stmt.isComment || !confirmedSql.has(stmt.sql)) continue;
        await provider.query(providerConn, stmt.sql);
      }
    } finally {
      await providerConn.close();
    }
  }

  if (!input.push.tempFileId) {
    return NextResponse.json({ error: "Temp file expired - please re-upload the file" }, { status: 410 });
  }

  const tempFile = await readTempFile(input.push.tempFileId);
  if (!tempFile) {
    return NextResponse.json({ error: "Temp file expired - please re-upload the file" }, { status: 410 });
  }

  const analysis =
    tempFile.extension === ".xlsx"
      ? await analyzeExcel(tempFile.buffer)
      : await analyzeCSV(tempFile.buffer, {
          delimiter: tempFile.extension === ".tsv" ? "\t" : undefined,
        });

  const existingSourceCols = new Set(existingMapping.map((m) => m.sourceColumn.toLowerCase()));
  const acceptedColumns = analysis.columns.filter((c) =>
    existingSourceCols.has(c.name.toLowerCase()) ||
    confirmedAddedColumns.has(c.name.toLowerCase())
  );

  const newSavedSchema = acceptedColumns.map((c) => ({
    name: c.name,
    duckdbType: c.duckdbType,
    inferredType: c.inferredType,
    nullable: c.nullable,
  }));

  const newMappings = [...existingMapping];
  for (const col of analysis.columns) {
    const confirmedAdded = confirmedAddedColumns.get(col.name.toLowerCase());
    if (!existingSourceCols.has(col.name.toLowerCase()) && confirmedAdded) {
      newMappings.push({
        sourceColumn: col.name,
        destinationColumn: confirmedAdded.destinationColumn,
        sourceType: col.duckdbType,
        destType: col.duckdbType,
      });
    }
  }

  await prisma.realmGate.update({
    where: { id: input.gateId },
    data: {
      savedSchema: newSavedSchema,
      columnMapping: newMappings as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.gatePush.update({
    where: { id: input.pushId },
    data: {
      status: "VALIDATED",
      driftResolution: "ADJUSTED_DESTINATION",
    },
  });

  try {
    const result = await executePush(input.gateId, input.pushId, tempFile.buffer, tempFile.extension);
    if (result.status === "SUCCESS" && input.push.tempFileId) {
      await deleteTempFile(input.push.tempFileId);
    }

    return NextResponse.json({
      pushId: input.push.id,
      status: result.status,
      resolution: "ADJUSTED_DESTINATION",
      rowCount: result.rowCount,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsErrored: result.rowsErrored,
      blankRowsSkipped: result.blankRowsSkipped,
      keyDrift: result.keyDrift,
      errorMessage: result.errorMessage,
      duration: result.duration,
    });
  } catch (err) {
    return NextResponse.json(
      {
        pushId: input.push.id,
        status: "FAILED",
        error: err instanceof Error ? err.message : "Push failed after destination adjustment",
      },
      { status: 500 }
    );
  }
}

async function buildKeyHardeningReview(input: {
  gate: NonNullable<Awaited<ReturnType<typeof loadGateForResolve>>>;
  push: { tempFileId: string | null };
  keyDrift: KeyDriftDetails;
  selectedKey: string[];
  manualCandidate?: boolean;
  executeDdl?: boolean;
  confirmedDdl?: string[];
}): Promise<KeyHardeningReview | { response: NextResponse }> {
  if (!input.push.tempFileId) {
    return { response: NextResponse.json({ error: "Temp file reference missing" }, { status: 410 }) };
  }

  const tempFile = await readTempFile(input.push.tempFileId);
  if (!tempFile) {
    return { response: NextResponse.json({ error: "Temp file expired or missing" }, { status: 410 }) };
  }

  const rows = await loadRowsFromGateFile(tempFile.buffer, tempFile.extension);
  const columnMapping = input.gate.columnMapping as unknown as ColumnMap[];
  const prepared = prepareMappedRowsForPush({
    rows,
    columnMapping,
    primaryKeyColumns: input.selectedKey,
    mergeStrategy: "UPSERT",
  });
  const manualValidation = validateSelectedGateKey({
    rows: prepared.mappedRows,
    selectedKey: input.selectedKey,
    blankRowsAlreadyRemoved: true,
  });
  if (prepared.keyDrift) {
    const responseValidation: SelectedGateKeyValidationResult = {
      ...manualValidation,
      ok: false,
      duplicateExamples: prepared.keyDrift.duplicateExamples.length > 0
        ? prepared.keyDrift.duplicateExamples
        : manualValidation.duplicateExamples,
      nullKeyExamples: prepared.keyDrift.nullKeyExamples.length > 0
        ? prepared.keyDrift.nullKeyExamples
        : manualValidation.nullKeyExamples,
    };
    return {
      response: NextResponse.json(
        {
          status: "KEY_DRIFT",
          error: "Selected key no longer validates against the staged upload.",
          selectedKey: input.selectedKey,
          manualCandidate: input.manualCandidate === true,
          manualValidation: responseValidation,
          blocked: true,
          blockReason: buildManualValidationBlockReason(responseValidation),
          keyDrift: {
            ...input.keyDrift,
            selectedKey: input.selectedKey,
            manualSelection: input.manualCandidate === true,
            manualValidation: responseValidation,
            duplicateExamples: prepared.keyDrift.duplicateExamples,
            nullKeyExamples: prepared.keyDrift.nullKeyExamples,
            reason: prepared.keyDrift.reason,
          },
          blankRowsSkipped: prepared.blankRowsSkipped,
        },
        { status: 409 }
      ),
    };
  }

  if (!isKeyDdlProviderType(input.gate.connection.type)) {
    return {
      response: NextResponse.json(
        { error: "Key constraint replacement is only supported for Postgres, SQL Server, and MySQL." },
        { status: 400 }
      ),
    };
  }

  const provider = getProvider(input.gate.connection.type);
  if (!provider.query) {
    return {
      response: NextResponse.json({ error: "Provider does not support query execution" }, { status: 400 }),
    };
  }

  const credentials = input.gate.connection.credentials
    ? JSON.parse(decrypt(input.gate.connection.credentials))
    : {};
  const providerConn = await provider.connect({
    type: input.gate.connection.type,
    config: input.gate.connection.config as Record<string, unknown>,
    credentials,
  });

  try {
    const providerType = input.gate.connection.type;
    const schema = input.gate.targetSchema || "public";
    const constraints = await getExistingKeyConstraints({
      provider,
      conn: providerConn,
      providerType,
      schema,
      table: input.gate.targetTable,
    });
    const matchedConstraint = findHermodManagedKeyConstraint({
      constraints,
      oldKey: input.keyDrift.oldKey,
      storedConstraintName: input.gate.keyConstraintName,
    });
    const shouldDropStoredName = Boolean(input.gate.keyConstraintName && !matchedConstraint);
    const foreignKeys = matchedConstraint?.type === "PRIMARY"
      ? await detectForeignKeyDependencies({
          provider,
          conn: providerConn,
          providerType,
          schema,
          table: input.gate.targetTable,
        })
      : { count: 0, blocked: false };
    const destinationValidation = await validateCandidateKeyInDestination({
      provider,
      conn: providerConn,
      providerType,
      schema,
      table: input.gate.targetTable,
      keyColumns: input.selectedKey,
    });
    const plan = buildReplaceKeyConstraintPlan({
      providerType,
      schema,
      table: input.gate.targetTable,
      oldKey: input.keyDrift.oldKey,
      newKey: input.selectedKey,
      existingConstraintName: shouldDropStoredName
        ? input.gate.keyConstraintName
        : matchedConstraint?.name ?? null,
      replacePrimaryKey: matchedConstraint?.type === "PRIMARY",
      matchedExistingConstraint: matchedConstraint,
      foreignKeyDependencyCount: foreignKeys.count,
    });

    if (!destinationValidation.ok) {
      return {
        response: NextResponse.json(
          {
            status: "KEY_DRIFT",
            error: destinationValidation.reason,
            selectedKey: input.selectedKey,
            manualCandidate: input.manualCandidate === true,
            manualValidation,
            destinationValidation,
            ddl: plan.ddl,
            warnings: plan.warnings,
            blocked: true,
            blockReason: destinationValidation.reason,
          },
          { status: 409 }
        ),
      };
    }

    if (plan.blocked) {
      return {
        response: NextResponse.json(
          {
            status: "KEY_DRIFT",
            selectedKey: input.selectedKey,
            manualCandidate: input.manualCandidate === true,
            manualValidation,
            ddl: plan.ddl,
            warnings: plan.warnings,
            blocked: true,
            blockReason: plan.blockReason,
          },
          { status: 409 }
        ),
      };
    }

    if (input.executeDdl) {
      if (!arraysEqual(input.confirmedDdl ?? [], plan.ddl)) {
        return {
          response: NextResponse.json(
            { error: "Confirmed DDL does not match the current generated key replacement plan." },
            { status: 400 }
          ),
        };
      }
      for (const statement of plan.ddl) {
        await provider.query(providerConn, statement);
      }
    }

    return {
      plan,
      tempFile,
      blankRowsSkipped: prepared.blankRowsSkipped,
      manualCandidate: input.manualCandidate === true,
      manualValidation,
    };
  } finally {
    await providerConn.close();
  }
}

async function loadGateForResolve(gateId: string, tenantId: string) {
  return prisma.realmGate.findFirst({
    where: { id: gateId, tenantId },
    include: { connection: true },
  });
}

function parseGatePushIds(url: string): { gateId: string | undefined; pushId: string | undefined } {
  const parts = url.split("/gates/")[1]?.split("/") ?? [];
  return {
    gateId: parts[0],
    pushId: parts[2],
  };
}

function isKeyHardeningBody(body: unknown): body is KeyHardeningBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "action" in body &&
    ((body as { action?: unknown }).action === "APPROVE_KEY_HARDENING" ||
      (body as { action?: unknown }).action === "CANCEL")
  );
}

function parseKeyDrift(value: unknown): KeyDriftDetails {
  const keyDrift = value as Partial<KeyDriftDetails> | null | undefined;
  return {
    oldKey: Array.isArray(keyDrift?.oldKey) ? keyDrift.oldKey : [],
    duplicateExamples: Array.isArray(keyDrift?.duplicateExamples) ? keyDrift.duplicateExamples : [],
    nullKeyExamples: Array.isArray(keyDrift?.nullKeyExamples) ? keyDrift.nullKeyExamples : [],
    reason: typeof keyDrift?.reason === "string" ? keyDrift.reason : "Current UPSERT key failed preflight.",
    candidateKeys: Array.isArray(keyDrift?.candidateKeys) ? keyDrift.candidateKeys : [],
    recommendation: keyDrift?.recommendation ?? null,
    validationStats: keyDrift?.validationStats ?? null,
    aiUsed: keyDrift?.aiUsed ?? false,
    aiExplanation: keyDrift?.aiExplanation ?? null,
    noReliableKeyReason: keyDrift?.noReliableKeyReason ?? null,
    discoveryMode: keyDrift?.discoveryMode,
    searchExhaustive: keyDrift?.searchExhaustive,
    columnsConsidered: Array.isArray(keyDrift?.columnsConsidered) ? keyDrift.columnsConsidered : undefined,
    columnsExcluded: Array.isArray(keyDrift?.columnsExcluded) ? keyDrift.columnsExcluded : undefined,
    discriminatorColumns: Array.isArray(keyDrift?.discriminatorColumns) ? keyDrift.discriminatorColumns : undefined,
    currentKeyDuplicateGroupCount: typeof keyDrift?.currentKeyDuplicateGroupCount === "number"
      ? keyDrift.currentKeyDuplicateGroupCount
      : undefined,
    candidateSearchLimits: keyDrift?.candidateSearchLimits,
    mappedColumns: Array.isArray(keyDrift?.mappedColumns) ? keyDrift.mappedColumns : undefined,
    manualSelection: keyDrift?.manualSelection === true,
    manualValidation: keyDrift?.manualValidation,
    selectedKey: Array.isArray(keyDrift?.selectedKey) ? keyDrift.selectedKey : null,
  };
}

function findVerifiedCandidate(keyDrift: KeyDriftDetails, selectedKey: string[]) {
  return keyDrift.candidateKeys.find(
    (candidate) =>
      candidate.unique &&
      candidate.nullCount === 0 &&
      candidate.duplicateCount === 0 &&
      arraysEqual(candidate.columns, selectedKey)
  );
}

function destinationKeyToStoredPrimaryKey(selectedKey: string[], columnMapping: ColumnMap[]): string[] {
  return selectedKey.map((destinationColumn) => {
    const mapping = columnMapping.find(
      (candidate) => candidate.destinationColumn.toLowerCase() === destinationColumn.toLowerCase()
    );
    return mapping?.sourceColumn ?? destinationColumn;
  });
}

function appendKeyHistory(existing: unknown, entry: Record<string, unknown>): Record<string, unknown>[] {
  const history = Array.isArray(existing) ? existing.filter(isPlainObject) : [];
  return [...history, entry];
}

function buildManualValidationBlockReason(validation: SelectedGateKeyValidationResult): string {
  if (validation.nullCount > 0 && validation.duplicateCount > 0) {
    return "Selected key has blank and duplicate values in the staged upload.";
  }
  if (validation.nullCount > 0) {
    return "Selected key has blank values in the staged upload.";
  }
  return "Selected key is not unique in the staged upload.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeyDdlProviderType(value: string): value is KeyDdlProviderType {
  return value === "POSTGRES" || value === "MSSQL" || value === "MYSQL";
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value.toLowerCase() === right[index]?.toLowerCase());
}
