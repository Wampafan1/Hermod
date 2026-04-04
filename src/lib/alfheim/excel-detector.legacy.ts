/**
 * Excel Schema Auto-Detection — Vanaheim realm
 *
 * Detects sheet names, headers, and column types
 * from an uploaded .xlsx file using ExcelJS.
 */

import ExcelJS from "exceljs";
import type { ColumnMapping, SchemaMapping } from "./types";

interface ExcelDetectionResult {
  availableSheets: string[];
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: SchemaMapping;
}

type DataType = ColumnMapping["dataType"];

function inferCellType(values: unknown[]): { type: DataType; nullable: boolean } {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  const nullable = nonNull.length < values.length;

  if (nonNull.length === 0) return { type: "STRING", nullable: true };

  let hasDecimal = false;
  let allNumbers = true;
  let allDates = true;
  let allBooleans = true;

  for (const v of nonNull) {
    if (typeof v === "boolean") {
      allNumbers = false;
      allDates = false;
      continue;
    }
    allBooleans = false;

    if (v instanceof Date) {
      allNumbers = false;
      continue;
    }
    allDates = false;

    if (typeof v === "number") {
      if (!Number.isInteger(v)) hasDecimal = true;
      continue;
    }
    allNumbers = false;

    // String value — check patterns
    const s = String(v).trim();
    if (/^-?\d+\.?\d*$/.test(s) && !isNaN(Number(s))) {
      if (s.includes(".")) hasDecimal = true;
      continue;
    }
    allNumbers = false;

    if (!isNaN(Date.parse(s))) {
      continue;
    }
    allDates = false;
  }

  if (allBooleans) return { type: "BOOLEAN", nullable };
  if (allDates) return { type: "TIMESTAMP", nullable };
  if (allNumbers) return { type: hasDecimal ? "FLOAT" : "INTEGER", nullable };
  return { type: "STRING", nullable };
}

export async function getSheetNames(filePath: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets.map((ws) => ws.name);
}

export async function detectExcelSchema(
  filePath: string,
  options?: { sheetName?: string; headerRow?: number; dataStartRow?: number }
): Promise<ExcelDetectionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const availableSheets = workbook.worksheets.map((ws) => ws.name);
  const sheetName = options?.sheetName ?? availableSheets[0] ?? "Sheet1";
  const worksheet = workbook.getWorksheet(sheetName);

  if (!worksheet) {
    return {
      availableSheets,
      sheetName,
      headerRow: 1,
      dataStartRow: 2,
      rowCount: 0,
      sampleRows: [],
      schema: { columns: [] },
    };
  }

  const headerRow = options?.headerRow ?? 1;
  const dataStartRow = options?.dataStartRow ?? headerRow + 1;

  // Read header row
  const headerRowData = worksheet.getRow(headerRow);
  const headers: string[] = [];
  headerRowData.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const val = cell.value;
    headers[colNumber - 1] = val ? String(val).trim() : `column_${colNumber}`;
  });

  // Trim trailing empty headers
  while (headers.length > 0 && !headers[headers.length - 1]) {
    headers.pop();
  }

  if (headers.length === 0) {
    return {
      availableSheets,
      sheetName,
      headerRow,
      dataStartRow,
      rowCount: 0,
      sampleRows: [],
      schema: { columns: [] },
    };
  }

  // Read data rows (up to 100 for detection)
  const maxSampleRow = Math.min(dataStartRow + 100, worksheet.rowCount + 1);
  const dataRows: unknown[][] = [];

  for (let r = dataStartRow; r < maxSampleRow; r++) {
    const row = worksheet.getRow(r);
    if (row.values === undefined || (Array.isArray(row.values) && row.values.every((v) => v === null || v === undefined))) {
      continue;
    }
    const rowData: unknown[] = [];
    for (let c = 0; c < headers.length; c++) {
      const cell = row.getCell(c + 1);
      rowData[c] = cell.value instanceof Date ? cell.value : cell.value ?? null;
    }
    dataRows.push(rowData);
  }

  const totalRows = worksheet.rowCount - headerRow;

  const columns: ColumnMapping[] = headers.map((name, colIdx) => {
    const colValues = dataRows.map((row) => row[colIdx]);
    const { type, nullable } = inferCellType(colValues);
    return {
      jsonPath: name,
      columnName: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      dataType: type,
      nullable,
    };
  });

  const sampleRows = dataRows.slice(0, 5).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const val = row[i];
      obj[h] = val instanceof Date ? val.toISOString() : val ?? null;
    });
    return obj;
  });

  return {
    availableSheets,
    sheetName,
    headerRow,
    dataStartRow,
    rowCount: totalRows,
    sampleRows,
    schema: { columns },
  };
}
