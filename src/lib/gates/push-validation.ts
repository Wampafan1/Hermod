import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { analyzeFile, FileAnalysisError } from "@/lib/duckdb/file-analyzer";
import {
  generateAlterStatements,
  mapSchemaDiffToDestination,
  type GateColumnMapping,
} from "@/lib/gates/alter-generator";
import { computeSchemaDiff, type SavedColumn, type SchemaDiff } from "@/lib/gates/schema-diff";
import { readTempFile } from "@/lib/gates/temp-files";
import { preflightGatePushKeyDrift, type ColumnMap } from "@/lib/gates/push-executor";
import {
  buildGatePushValidationErrorDetails,
  updateGatePushValidationStage,
} from "@/lib/gates/validation-timeouts";

export const GATE_VALIDATE_PUSH_JOB = "gate-validate-push";
export const MAX_GATE_PUSH_FILE_SIZE = 20 * 1024 * 1024;

export interface GateValidatePushJob {
  pushId: string;
  gateId: string;
  tenantId: string;
  tempFileId: string;
}

type AnalysisColumn = {
  name: string;
  duckdbType: string;
  inferredType: string;
  nullable: boolean;
};

export function getGateUploadExtension(fileName: string): string | null {
  const ext = fileName.match(/\.(csv|tsv|xlsx)$/i)?.[1]?.toLowerCase();
  return ext ? `.${ext}` : null;
}

export function buildSchemaDriftResolutionOptions(input: {
  diff: SchemaDiff;
  columnMapping: GateColumnMapping[];
  connectionType: string;
  targetSchema: string | null;
  targetTable: string;
}) {
  const destinationDiff = mapSchemaDiffToDestination(input.diff, input.columnMapping);
  const alterStatements = generateAlterStatements(
    input.connectionType,
    input.targetSchema || "public",
    input.targetTable,
    destinationDiff,
    input.diff
  );

  const adjustFileActions: string[] = [];
  for (const col of input.diff.added) {
    adjustFileActions.push(`Remove column: ${col.name} (not in destination)`);
  }
  for (const col of input.diff.removed) {
    adjustFileActions.push(`Add column: ${col.name} (expected by destination, will be NULL)`);
  }
  for (const col of input.diff.typeChanged) {
    adjustFileActions.push(`Cast column: ${col.name} from ${col.newType} to ${col.oldType}`);
  }

  return {
    adjustFile: {
      description: "Modify your file to match the existing destination",
      actions: adjustFileActions,
    },
    adjustDestination: {
      description: "Modify the destination table to accept the new schema",
      databaseType: input.connectionType === "MSSQL"
        ? "SQLSERVER"
        : input.connectionType === "POSTGRES"
          ? "POSTGRESQL"
          : input.connectionType,
      statements: alterStatements,
      warning: "These statements will modify your production table. Review carefully.",
    },
  };
}

export async function handleGateValidatePush(job: { data: GateValidatePushJob }) {
  await validateStagedGatePush(job.data);
}

export async function validateStagedGatePush(input: GateValidatePushJob): Promise<void> {
  const push = await prisma.gatePush.findFirst({
    where: {
      id: input.pushId,
      gateId: input.gateId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      status: true,
      fileName: true,
      fileSize: true,
      createdAt: true,
      tempFileId: true,
    },
  });

  if (!push || push.status !== "VALIDATING") return;

  const gate = await prisma.realmGate.findFirst({
    where: { id: input.gateId, tenantId: input.tenantId },
    include: { connection: { select: { name: true, type: true } } },
  });

  if (!gate) {
    await markValidationFailed(input.pushId, "Gate not found.", push.createdAt);
    return;
  }

  if (gate.status !== "ACTIVE") {
    await markValidationFailed(input.pushId, "Gate is not active.", push.createdAt);
    return;
  }

  try {
    await updateGatePushValidationStage({
      pushId: input.pushId,
      stage: "READING_FILE",
      startedAt: push.createdAt,
    });

    const tempFile = await readTempFile(input.tempFileId);
    if (!tempFile) {
      await markValidationFailed(input.pushId, "Temp file expired or missing.", push.createdAt);
      return;
    }

    await updateGatePushValidationStage({
      pushId: input.pushId,
      stage: "ANALYZING_FILE",
      startedAt: push.createdAt,
    });

    const analysis = await analyzeFile(tempFile.buffer, push.fileName, { skipUCC: true });

    await updateGatePushValidationStage({
      pushId: input.pushId,
      stage: "VALIDATING_SCHEMA",
      startedAt: push.createdAt,
    });

    const savedColumns = gate.savedSchema as unknown as SavedColumn[];
    const { hasDrift, diff: rawDiff } = computeSchemaDiff(savedColumns, analysis.columns);
    const columnMapping = gate.columnMapping as unknown as GateColumnMapping[];
    const diff = removeKnownMappedAddedColumns(rawDiff, columnMapping);
    const hasActionableDrift = hasSchemaChanges(diff);

    if (hasActionableDrift) {
      await prisma.gatePush.update({
        where: { id: input.pushId },
        data: {
          status: "SCHEMA_DRIFT",
          rowCount: analysis.rowCount,
          schemaDiff: diff as unknown as Prisma.InputJsonValue,
          errorDetails: buildGatePushValidationErrorDetails({
            stage: "READY",
            startedAt: push.createdAt,
          }),
        },
      });
      return;
    }

    if (hasDrift) {
      await prisma.realmGate.update({
        where: { id: gate.id },
        data: {
          savedSchema: toSavedSchema(analysis.columns) as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await updateGatePushValidationStage({
      pushId: input.pushId,
      stage: "CHECKING_KEY",
      startedAt: push.createdAt,
    });

    const primaryKeyColumns: string[] = Array.isArray(gate.primaryKeyColumns)
      ? (gate.primaryKeyColumns as string[])
      : [];

    await updateGatePushValidationStage({
      pushId: input.pushId,
      stage: "DISCOVERING_KEY",
      startedAt: push.createdAt,
    });

    const keyPreflight = await preflightGatePushKeyDrift({
      fileBuffer: tempFile.buffer,
      fileExtension: tempFile.extension,
      columnMapping: columnMapping as unknown as ColumnMap[],
      primaryKeyColumns,
      mergeStrategy: gate.mergeStrategy,
    });

    if (keyPreflight.keyDrift) {
      await prisma.gatePush.update({
        where: { id: input.pushId },
        data: {
          status: "KEY_DRIFT",
          rowCount: keyPreflight.rowCount,
          blankRowsSkipped: keyPreflight.blankRowsSkipped,
          keyDrift: keyPreflight.keyDrift as unknown as Prisma.InputJsonValue,
          errorDetails: buildGatePushValidationErrorDetails({
            stage: "READY",
            startedAt: push.createdAt,
          }),
        },
      });
      return;
    }

    await prisma.gatePush.update({
      where: { id: input.pushId },
      data: {
        status: "VALIDATED",
        rowCount: analysis.rowCount,
        errorDetails: buildGatePushValidationErrorDetails({
          stage: "READY",
          startedAt: push.createdAt,
        }),
      },
    });
  } catch (err) {
    const errorMessage = validationErrorMessage(err);
    await markValidationFailed(input.pushId, errorMessage, push.createdAt);
  }
}

async function markValidationFailed(
  pushId: string,
  errorMessage: string,
  startedAt: Date
): Promise<void> {
  await prisma.gatePush.update({
    where: { id: pushId },
    data: {
      status: "FAILED",
      errorMessage,
      errorDetails: buildGatePushValidationErrorDetails({
        stage: "FAILED",
        startedAt,
        validationError: errorMessage,
      }),
      completedAt: new Date(),
    },
  });
}

function validationErrorMessage(err: unknown): string {
  if (err instanceof FileAnalysisError) return err.message;
  return err instanceof Error ? err.message : "Gate push validation failed.";
}

function hasSchemaChanges(diff: SchemaDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.typeChanged.length > 0;
}

function removeKnownMappedAddedColumns(
  diff: SchemaDiff,
  columnMapping: GateColumnMapping[]
): SchemaDiff {
  const mappedSourceColumns = new Set(
    columnMapping.map((mapping) => mapping.sourceColumn.toLowerCase())
  );

  return {
    ...diff,
    added: diff.added.filter((column) => !mappedSourceColumns.has(column.name.toLowerCase())),
  };
}

function toSavedSchema(columns: AnalysisColumn[]) {
  return columns.map((column) => ({
    name: column.name,
    duckdbType: column.duckdbType,
    inferredType: column.inferredType,
    nullable: column.nullable,
  }));
}
