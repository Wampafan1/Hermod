/**
 * DuckDB Analytical Engine — Nidavellir Foundation
 *
 * Ephemeral in-process analytical database for data profiling,
 * schema detection, and transformation operations.
 *
 * Every session is :memory: — no persistence, no disk footprint,
 * no multi-tenant data leak risk.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import ExcelJS from "exceljs";
import { toInferredType } from "./type-mapper";

// ─── Public Types ───────────────────────────────────

export interface AnalyticsSession {
  /** Run a SQL query and return results as an array of objects */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;

  /** Run a SQL statement that returns no results (CREATE, INSERT, etc.) */
  execute(sql: string): Promise<void>;

  /** Load a CSV buffer into a named table */
  loadCSV(buffer: Buffer, tableName: string, options?: CSVLoadOptions): Promise<TableInfo>;

  /** Load parsed rows (from any source) into a named table */
  loadRows(rows: Record<string, unknown>[], tableName: string): Promise<TableInfo>;

  /** Load an Excel file into a named table (first sheet, or specified sheet) */
  loadExcel(buffer: Buffer, tableName: string, options?: ExcelLoadOptions): Promise<TableInfo>;

  /** Get table metadata: column names, types, row count */
  describeTable(tableName: string): Promise<TableInfo>;

  /** Run full data profile on a table */
  profileTable(tableName: string): Promise<TableProfile>;

  /** Destroy the DuckDB instance — MUST be called */
  close(): Promise<void>;
}

export interface CSVLoadOptions {
  delimiter?: string;
  hasHeaders?: boolean;
  skipRows?: number;
  sampleSize?: number;
}

export interface ExcelLoadOptions {
  sheetName?: string;
  sheetIndex?: number;
  hasHeaders?: boolean;
  skipRows?: number;
}

export interface TableInfo {
  tableName: string;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  duckdbType: string;
  inferredType: string;
  nullable: boolean;
}

export interface TableProfile {
  tableName: string;
  rowCount: number;
  columns: ColumnProfile[];
}

export interface ColumnProfile {
  name: string;
  duckdbType: string;
  inferredType: string;

  // Cardinality
  distinctCount: number;
  uniquenessRatio: number;

  // Nulls
  nullCount: number;
  nullPercentage: number;

  // Value stats
  minValue: string | null;
  maxValue: string | null;
  avgLength: number | null;

  // Sample values (first 5 non-null distinct values)
  sampleValues: string[];
}

// ─── Helpers ────────────────────────────────────────

/** Quote a SQL identifier (table/column name) to prevent injection */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Write buffer to a temp file, return path. Caller MUST delete in finally block. */
async function writeTempFile(buffer: Buffer, ext: string): Promise<string> {
  const tempPath = join(tmpdir(), `hermod_duckdb_${randomUUID()}.${ext}`);
  await writeFile(tempPath, buffer);
  return tempPath;
}

/** Safely delete a temp file, ignoring errors */
async function cleanupTempFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // File may already be deleted or not exist — safe to ignore
  }
}

// ─── Session Implementation ─────────────────────────

class DuckDBAnalyticsSession implements AnalyticsSession {
  private instance: DuckDBInstance;
  private conn: DuckDBConnection;
  private closed = false;

  constructor(instance: DuckDBInstance, conn: DuckDBConnection) {
    this.instance = instance;
    this.conn = conn;
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    this.ensureOpen();
    const reader = await this.conn.runAndReadAll(sql);
    return reader.getRowObjectsJson() as T[];
  }

  async execute(sql: string): Promise<void> {
    this.ensureOpen();
    await this.conn.run(sql);
  }

  async loadCSV(buffer: Buffer, tableName: string, options?: CSVLoadOptions): Promise<TableInfo> {
    this.ensureOpen();
    const tempPath = await writeTempFile(buffer, "csv");
    try {
      const opts: string[] = [];
      if (options?.delimiter) opts.push(`delim = '${options.delimiter.replace(/'/g, "''")}'`);
      if (options?.hasHeaders === false) opts.push("header = false");
      if (options?.hasHeaders === true) opts.push("header = true");
      if (options?.skipRows) opts.push(`skip = ${Math.floor(options.skipRows)}`);
      if (options?.sampleSize) opts.push(`sample_size = ${Math.floor(options.sampleSize)}`);

      const optsStr = opts.length > 0 ? `, ${opts.join(", ")}` : "";
      const escapedPath = tempPath.replace(/\\/g, "/").replace(/'/g, "''");

      await this.conn.run(
        `CREATE TABLE ${quoteIdent(tableName)} AS SELECT * FROM read_csv_auto('${escapedPath}'${optsStr})`
      );

      return this.describeTable(tableName);
    } finally {
      await cleanupTempFile(tempPath);
    }
  }

  async loadRows(rows: Record<string, unknown>[], tableName: string): Promise<TableInfo> {
    this.ensureOpen();

    if (rows.length === 0) {
      await this.conn.run(`CREATE TABLE ${quoteIdent(tableName)} (empty_placeholder VARCHAR)`);
      return { tableName, rowCount: 0, columns: [] };
    }

    // Write rows as NDJSON to temp file, let DuckDB infer types
    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
    const tempPath = await writeTempFile(Buffer.from(ndjson, "utf-8"), "jsonl");
    try {
      const escapedPath = tempPath.replace(/\\/g, "/").replace(/'/g, "''");
      await this.conn.run(
        `CREATE TABLE ${quoteIdent(tableName)} AS SELECT * FROM read_json_auto('${escapedPath}')`
      );
      return this.describeTable(tableName);
    } finally {
      await cleanupTempFile(tempPath);
    }
  }

  async loadExcel(buffer: Buffer, tableName: string, options?: ExcelLoadOptions): Promise<TableInfo> {
    this.ensureOpen();

    // Use exceljs to parse the workbook, then load rows via DuckDB
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    let worksheet: ExcelJS.Worksheet | undefined;
    if (options?.sheetName) {
      worksheet = workbook.getWorksheet(options.sheetName);
    } else if (options?.sheetIndex !== undefined) {
      worksheet = workbook.worksheets[options.sheetIndex];
    } else {
      worksheet = workbook.worksheets[0];
    }

    if (!worksheet) {
      await this.conn.run(`CREATE TABLE ${quoteIdent(tableName)} (empty_placeholder VARCHAR)`);
      return { tableName, rowCount: 0, columns: [] };
    }

    const skipRows = options?.skipRows ?? 0;
    const hasHeaders = options?.hasHeaders ?? true;
    const headerRowIdx = skipRows + 1; // 1-based
    const dataStartIdx = hasHeaders ? headerRowIdx + 1 : headerRowIdx;

    // Read headers
    const headerRow = worksheet.getRow(headerRowIdx);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      headers[colNumber - 1] = hasHeaders && val ? String(val).trim() : `column_${colNumber}`;
    });

    // Trim trailing empty headers
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }

    if (headers.length === 0) {
      await this.conn.run(`CREATE TABLE ${quoteIdent(tableName)} (empty_placeholder VARCHAR)`);
      return { tableName, rowCount: 0, columns: [] };
    }

    // Read data rows
    const rows: Record<string, unknown>[] = [];
    for (let r = dataStartIdx; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const isEmptyRow = !row.values || (Array.isArray(row.values) && row.values.every((v) => v === null || v === undefined));
      if (isEmptyRow) continue;

      const obj: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        const cell = row.getCell(c + 1);
        const val = cell.value;
        if (val instanceof Date) {
          obj[headers[c]] = val.toISOString();
        } else if (typeof val === "object" && val !== null && "result" in val) {
          // Formula cell — use result value
          obj[headers[c]] = (val as { result?: unknown }).result ?? null;
        } else {
          obj[headers[c]] = val ?? null;
        }
      }
      rows.push(obj);
    }

    return this.loadRows(rows, tableName);
  }

  async describeTable(tableName: string): Promise<TableInfo> {
    this.ensureOpen();

    const colRows = await this.query<{
      column_name: string;
      column_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type AS column_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = '${tableName.replace(/'/g, "''")}'
       ORDER BY ordinal_position`
    );

    const countResult = await this.query<{ cnt: number }>(
      `SELECT COUNT(*)::INTEGER AS cnt FROM ${quoteIdent(tableName)}`
    );
    const rowCount = countResult[0]?.cnt ?? 0;

    const columns: ColumnInfo[] = colRows.map((row) => ({
      name: row.column_name,
      duckdbType: row.column_type,
      inferredType: toInferredType(row.column_type),
      nullable: row.is_nullable === "YES",
    }));

    return { tableName, rowCount, columns };
  }

  async profileTable(tableName: string): Promise<TableProfile> {
    this.ensureOpen();

    const tableInfo = await this.describeTable(tableName);
    if (tableInfo.columns.length === 0 || tableInfo.rowCount === 0) {
      return {
        tableName,
        rowCount: tableInfo.rowCount,
        columns: tableInfo.columns.map((c) => ({
          name: c.name,
          duckdbType: c.duckdbType,
          inferredType: c.inferredType,
          distinctCount: 0,
          uniquenessRatio: 0,
          nullCount: 0,
          nullPercentage: 0,
          minValue: null,
          maxValue: null,
          avgLength: null,
          sampleValues: [],
        })),
      };
    }

    // Build a single query that profiles all columns at once (index-based aliases)
    const profileParts = tableInfo.columns.map((col, idx) => {
      const q = quoteIdent(col.name);
      return `
        COUNT(DISTINCT ${q}) AS dist_${idx},
        COUNT(*) FILTER (WHERE ${q} IS NULL) AS null_${idx},
        MIN(${q})::VARCHAR AS min_${idx},
        MAX(${q})::VARCHAR AS max_${idx},
        AVG(LENGTH(${q}::VARCHAR)) FILTER (WHERE ${q} IS NOT NULL) AS avglen_${idx}`;
    });

    const profileSql = `SELECT ${profileParts.join(",")} FROM ${quoteIdent(tableName)}`;
    const profileRows = await this.query(profileSql);
    const stats = profileRows[0] ?? {};

    // Fetch sample values per column (5 distinct non-null values each)
    const sampleMap = new Map<string, string[]>();
    for (const col of tableInfo.columns) {
      const sampleRows = await this.query<{ val: string }>(
        `SELECT DISTINCT ${quoteIdent(col.name)}::VARCHAR AS val
         FROM ${quoteIdent(tableName)}
         WHERE ${quoteIdent(col.name)} IS NOT NULL
         LIMIT 5`
      );
      sampleMap.set(col.name, sampleRows.map((r) => r.val));
    }

    const columns: ColumnProfile[] = tableInfo.columns.map((col, idx) => {
      const distinctCount = Number(stats[`dist_${idx}`] ?? 0);
      const nullCount = Number(stats[`null_${idx}`] ?? 0);
      const minVal = stats[`min_${idx}`];
      const maxVal = stats[`max_${idx}`];
      const avgLen = stats[`avglen_${idx}`];

      return {
        name: col.name,
        duckdbType: col.duckdbType,
        inferredType: col.inferredType,
        distinctCount,
        uniquenessRatio: tableInfo.rowCount > 0 ? distinctCount / tableInfo.rowCount : 0,
        nullCount,
        nullPercentage: tableInfo.rowCount > 0 ? (nullCount / tableInfo.rowCount) * 100 : 0,
        minValue: minVal != null ? String(minVal) : null,
        maxValue: maxVal != null ? String(maxVal) : null,
        avgLength: avgLen != null ? Number(avgLen) : null,
        sampleValues: sampleMap.get(col.name) ?? [],
      };
    });

    return { tableName, rowCount: tableInfo.rowCount, columns };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.closeSync();
    } catch {
      // Connection may already be closed
    }
    try {
      this.instance.closeSync();
    } catch {
      // Instance may already be closed
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("AnalyticsSession is closed");
    }
  }
}

// ─── Factory ────────────────────────────────────────

/**
 * Create an ephemeral DuckDB analytics session.
 * Session is in-memory only — no persistence, no disk footprint.
 * Caller MUST call session.close() when done (use try/finally).
 */
export async function createAnalyticsSession(): Promise<AnalyticsSession> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return new DuckDBAnalyticsSession(instance, conn);
}
