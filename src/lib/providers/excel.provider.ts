/**
 * Excel File Provider — Vanaheim realm
 *
 * Reads .xlsx files as a data source using ExcelJS.
 */

import { access, constants } from "fs/promises";
import { resolve, join } from "path";
import ExcelJS from "exceljs";
import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection } from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";

interface ExcelConfig {
  filePath: string;
  originalFilename: string;
  sheetName: string;
  availableSheets: string[];
  headerRow: number;
  dataStartRow: number;
  pkColumns?: string[];
}

class ExcelConnection implements ProviderConnection {
  constructor(public config: ExcelConfig) {}
  async close() {
    // No persistent connection to close
  }
}

export class ExcelProvider implements ConnectionProvider {
  readonly type = "EXCEL_FILE";

  async connect(connection: ConnectionLike): Promise<ExcelConnection> {
    const config = connection.config as unknown as ExcelConfig;
    return new ExcelConnection(config);
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    const config = connection.config as unknown as ExcelConfig;
    try {
      validateFilePath(config.filePath);
      await access(config.filePath, constants.R_OK);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(config.filePath);
      return workbook.worksheets.length > 0;
    } catch {
      return false;
    }
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const excelConn = conn as ExcelConnection;
    const { filePath, sheetName, headerRow, dataStartRow, pkColumns } = excelConn.config;
    validateFilePath(filePath);
    const chunkSize = config.chunkSize ?? 10_000;
    const injectPk = pkColumns && pkColumns.length > 1;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in workbook`);
    }

    // Read headers
    const headerRowData = worksheet.getRow(headerRow);
    const headers: string[] = [];
    headerRowData.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = cell.value ? String(cell.value).trim() : `column_${colNumber}`;
    });

    // Trim trailing empty headers
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }

    let chunk: Record<string, unknown>[] = [];

    for (let r = dataStartRow; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const record: Record<string, unknown> = {};
      let hasValue = false;

      for (let c = 0; c < headers.length; c++) {
        const cell = row.getCell(c + 1);
        let val = cell.value;
        if (val instanceof Date) {
          val = val.toISOString();
        } else if (typeof val === "object" && val !== null && "result" in val) {
          // Formula cell — use the result
          val = (val as { result?: unknown }).result ?? null;
        }
        record[headers[c]] = val ?? null;
        if (val !== null && val !== undefined) hasValue = true;
      }

      if (!hasValue) continue; // Skip entirely empty rows

      if (injectPk) {
        record.__hermod_pk = pkColumns!.map((c) => String(record[c] ?? "")).join("_");
      }
      chunk.push(record);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }

    if (chunk.length > 0) {
      yield chunk;
    }
  }
}

const UPLOADS_DIR = resolve(join(process.cwd(), "uploads"));

function validateFilePath(filePath: string): void {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(UPLOADS_DIR)) {
    throw new Error("File path outside allowed directory");
  }
}
