/**
 * Gate push execution engine.
 *
 * Reads profiled data from DuckDB, maps columns via the gate's columnMapping,
 * and pushes rows to the destination connection using the appropriate strategy.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { createAnalyticsSession } from "@/lib/duckdb/engine";
import type { DestConfig, LoadResult } from "@/lib/bifrost/types";

// ─── Types ──────────────────────────────────────────

interface ColumnMap {
  sourceColumn: string;
  destinationColumn: string;
  sourceType: string;
  destType: string;
}

interface PushResult {
  rowCount: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsErrored: number;
  duration: number;
}

// ─── Execute Push ───────────────────────────────────

export async function executePush(
  gateId: string,
  pushId: string,
  fileBuffer: Buffer,
  fileExtension: string
): Promise<PushResult> {
  const startTime = Date.now();

  // Load gate with connection
  const gate = await prisma.realmGate.findUniqueOrThrow({
    where: { id: gateId },
    include: { connection: true },
  });

  const columnMapping = gate.columnMapping as unknown as ColumnMap[];
  const mergeStrategy = gate.mergeStrategy;

  // Parse composite PK columns from Json field
  const primaryKeyColumns: string[] = Array.isArray(gate.primaryKeyColumns)
    ? (gate.primaryKeyColumns as string[])
    : [];

  // 1. Load file into DuckDB
  const session = await createAnalyticsSession();
  let rows: Record<string, unknown>[];
  try {
    if (fileExtension === ".csv" || fileExtension === ".tsv") {
      await session.loadCSV(fileBuffer, "staging", {
        delimiter: fileExtension === ".tsv" ? "\t" : undefined,
      });
    } else {
      await session.loadExcel(fileBuffer, "staging");
    }

    // Query all rows
    rows = await session.query<Record<string, unknown>>("SELECT * FROM staging");
  } finally {
    await session.close();
  }

  if (rows.length === 0) {
    return { rowCount: 0, rowsInserted: 0, rowsUpdated: 0, rowsErrored: 0, duration: Date.now() - startTime };
  }

  // 2. Map columns: rename source → destination
  const mappedRows = rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const col of columnMapping) {
      mapped[col.destinationColumn] = row[col.sourceColumn] ?? null;
    }
    return mapped;
  });

  // 3. Connect to destination
  const conn = gate.connection;
  const provider = getProvider(conn.type);
  const credentials = conn.credentials ? JSON.parse(decrypt(conn.credentials)) : {};
  const providerConn = await provider.connect({
    config: conn.config as Record<string, unknown>,
    credentials,
  });

  try {
    // 4. Execute based on merge strategy
    let result: PushResult;

    if (mergeStrategy === "TRUNCATE_RELOAD") {
      result = await truncateAndLoad(provider, providerConn, gate, mappedRows);
    } else if (mergeStrategy === "UPSERT") {
      result = await upsertRows(provider, providerConn, gate, primaryKeyColumns, mappedRows, columnMapping);
    } else {
      // APPEND
      result = await appendRows(provider, providerConn, gate, mappedRows);
    }

    result.duration = Date.now() - startTime;
    result.rowCount = rows.length;

    // 5. Update push record
    await prisma.gatePush.update({
      where: { id: pushId },
      data: {
        status: "SUCCESS",
        rowCount: result.rowCount,
        rowsInserted: result.rowsInserted,
        rowsUpdated: result.rowsUpdated,
        rowsErrored: result.rowsErrored,
        duration: result.duration,
        completedAt: new Date(),
      },
    });

    // 6. Update gate denormalized fields
    await prisma.realmGate.update({
      where: { id: gateId },
      data: {
        lastPushAt: new Date(),
        pushCount: { increment: 1 },
      },
    });

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    await prisma.gatePush.update({
      where: { id: pushId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        errorDetails: err instanceof Error ? { stack: err.stack } : undefined,
        duration,
        completedAt: new Date(),
      },
    });
    throw err;
  } finally {
    await providerConn.close();
  }
}

// ─── Strategy Implementations ───────────────────────

async function truncateAndLoad(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  rows: Record<string, unknown>[]
): Promise<PushResult> {
  if (!provider.load) throw new Error(`Provider does not support load`);

  const destConfig: DestConfig = {
    dataset: gate.targetSchema || "public",
    table: gate.targetTable,
    writeDisposition: "WRITE_TRUNCATE",
    autoCreateTable: false,
  };

  const result: LoadResult = await provider.load(conn, rows, destConfig);

  return {
    rowCount: rows.length,
    rowsInserted: result.rowsLoaded,
    rowsUpdated: 0,
    rowsErrored: result.errors.length,
    duration: 0,
  };
}

async function appendRows(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  rows: Record<string, unknown>[]
): Promise<PushResult> {
  if (!provider.load) throw new Error(`Provider does not support load`);

  const destConfig: DestConfig = {
    dataset: gate.targetSchema || "public",
    table: gate.targetTable,
    writeDisposition: "WRITE_APPEND",
    autoCreateTable: false,
  };

  const result: LoadResult = await provider.load(conn, rows, destConfig);

  return {
    rowCount: rows.length,
    rowsInserted: result.rowsLoaded,
    rowsUpdated: 0,
    rowsErrored: result.errors.length,
    duration: 0,
  };
}

async function upsertRows(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  gate: { targetSchema: string | null; targetTable: string },
  primaryKeyColumns: string[],
  rows: Record<string, unknown>[],
  columnMapping: ColumnMap[]
): Promise<PushResult> {
  // Map ALL PK source columns to destination names
  const pkColumns = primaryKeyColumns.map((srcPk) => {
    const mapped = columnMapping.find(
      (m) => m.sourceColumn.toLowerCase() === srcPk.toLowerCase()
    );
    return mapped?.destinationColumn ?? srcPk;
  });

  if (pkColumns.length === 0) {
    throw new Error("No primary key columns configured");
  }

  // Use provider.query to execute an UPSERT via SQL
  if (!provider.query) {
    throw new Error("Provider does not support query — cannot execute UPSERT");
  }

  const schema = gate.targetSchema || "public";
  const destColumns = columnMapping.map((m) => m.destinationColumn);

  let inserted = 0;
  let updated = 0;
  let errored = 0;

  // Process in batches of 200 for UPSERT (smaller than append due to ON CONFLICT complexity)
  const BATCH_SIZE = 200;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    try {
      // Build the upsert SQL based on connection type
      const connType = (provider as { type?: string }).type ?? "POSTGRES";
      const sql = buildUpsertSql(connType, schema, gate.targetTable, destColumns, pkColumns, batch);

      await provider.query(conn, sql);

      // Without RETURNING counts, approximate: assume all succeeded
      // A real implementation would parse affected rows, but this works for V1
      inserted += batch.length;
    } catch (err) {
      console.error(`[Gate] Upsert batch ${i}-${i + batch.length} failed:`, err);
      errored += batch.length;
    }
  }

  return {
    rowCount: rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    rowsErrored: errored,
    duration: 0,
  };
}

// ─── SQL Builders ───────────────────────────────────

function buildUpsertSql(
  connType: string,
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  switch (connType) {
    case "POSTGRES":
      return buildPostgresUpsert(schema, table, columns, pkColumns, rows);
    case "MSSQL":
      return buildMssqlMerge(schema, table, columns, pkColumns, rows);
    case "MYSQL":
      return buildMysqlUpsert(schema, table, columns, pkColumns, rows);
    default:
      return buildPostgresUpsert(schema, table, columns, pkColumns, rows);
  }
}

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPostgresUpsert(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = `"${schema}"."${table}"`;
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");
  const conflictCols = pkColumns.map((c) => `"${c}"`).join(", ");

  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  return `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}
    ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`;
}

function buildMssqlMerge(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = `[${schema}].[${table}]`;
  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  const colList = columns.map((c) => `[${c}]`).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `T.[${c}] = S.[${c}]`)
    .join(", ");
  const insertCols = columns.map((c) => `[${c}]`).join(", ");
  const insertVals = columns.map((c) => `S.[${c}]`).join(", ");
  const onClause = pkColumns.map((c) => `T.[${c}] = S.[${c}]`).join(" AND ");

  return `MERGE ${fullTable} AS T
    USING (VALUES ${valueClauses.join(", ")}) AS S (${colList})
    ON ${onClause}
    WHEN MATCHED THEN UPDATE SET ${updateCols}
    WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`;
}

function buildMysqlUpsert(
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  rows: Record<string, unknown>[]
): string {
  const fullTable = schema ? `\`${schema}\`.\`${table}\`` : `\`${table}\``;
  const colList = columns.map((c) => `\`${c}\``).join(", ");
  const pkSet = new Set(pkColumns.map((c) => c.toLowerCase()));
  const updateCols = columns
    .filter((c) => !pkSet.has(c.toLowerCase()))
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(", ");

  const valueClauses = rows.map((row) => {
    const vals = columns.map((c) => sqlEscape(row[c]));
    return `(${vals.join(", ")})`;
  });

  return `INSERT INTO ${fullTable} (${colList}) VALUES ${valueClauses.join(", ")}
    ON DUPLICATE KEY UPDATE ${updateCols}`;
}
