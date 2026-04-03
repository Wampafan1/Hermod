/**
 * CSV Schema Auto-Detection — Jötunheim realm
 *
 * Detects delimiter, headers, encoding, and column types
 * from the first 100 rows of a CSV file.
 */

import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import type { ColumnMapping, SchemaMapping } from "./types";

const DELIMITERS = [",", "\t", "|", ";"] as const;

interface CsvDetectionResult {
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: SchemaMapping;
}

function detectDelimiter(sample: string): string {
  let bestDelim = ",";
  let bestScore = -1;

  for (const delim of DELIMITERS) {
    try {
      const rows = parse(sample, {
        delimiter: delim,
        relax_column_count: true,
      }) as string[][];

      if (rows.length < 2) continue;

      // Score: most consistent column count across rows
      const counts = rows.map((r) => r.length);
      const mode = counts
        .sort(
          (a, b) =>
            counts.filter((v) => v === b).length -
            counts.filter((v) => v === a).length
        )[0];
      const consistency = counts.filter((c) => c === mode).length / counts.length;
      const score = consistency * mode; // prefer more columns + consistency

      if (score > bestScore) {
        bestScore = score;
        bestDelim = delim;
      }
    } catch {
      continue;
    }
  }

  return bestDelim;
}

function detectHeaders(firstRow: string[]): boolean {
  // Heuristic: headers are all strings, mostly unique, not numeric
  const uniqueRatio = new Set(firstRow).size / firstRow.length;
  const allStringLike = firstRow.every((v) => {
    const trimmed = v.trim();
    return trimmed.length > 0 && isNaN(Number(trimmed));
  });
  return allStringLike && uniqueRatio > 0.8;
}

type DataType = ColumnMapping["dataType"];

function inferColumnType(values: unknown[]): { type: DataType; nullable: boolean } {
  const nonNull = values.filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== ""
  );
  const nullable = nonNull.length < values.length;

  if (nonNull.length === 0) return { type: "STRING", nullable: true };

  const strings = nonNull.map((v) => String(v).trim());

  // Boolean check
  const boolValues = new Set(["true", "false", "yes", "no", "1", "0"]);
  if (strings.every((s) => boolValues.has(s.toLowerCase()))) {
    return { type: "BOOLEAN", nullable };
  }

  // Integer check
  if (strings.every((s) => /^-?\d+$/.test(s))) {
    return { type: "INTEGER", nullable };
  }

  // Float check
  if (strings.every((s) => /^-?\d+\.?\d*$/.test(s) && !isNaN(Number(s)))) {
    return { type: "FLOAT", nullable };
  }

  // Timestamp check
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/, // ISO dates
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // US dates
    /^\d{4}\/\d{2}\/\d{2}/, // Alternate ISO
  ];
  if (strings.every((s) => datePatterns.some((p) => p.test(s)) && !isNaN(Date.parse(s)))) {
    return { type: "TIMESTAMP", nullable };
  }

  return { type: "STRING", nullable };
}

export function detectCsvSchema(
  filePath: string,
  options?: { delimiter?: string; hasHeaders?: boolean; skipRows?: number }
): CsvDetectionResult {
  const rawContent = readFileSync(filePath, "utf-8");
  // Take first ~100 lines for detection
  const lines = rawContent.split("\n");
  const sampleContent = lines.slice(0, 102).join("\n");

  const delimiter = options?.delimiter ?? detectDelimiter(sampleContent);

  const allRows = parse(sampleContent, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];

  const skipRows = options?.skipRows ?? 0;
  const dataRows = allRows.slice(skipRows);

  if (dataRows.length === 0) {
    return {
      delimiter,
      hasHeaders: false,
      encoding: "utf-8",
      rowCount: 0,
      sampleRows: [],
      schema: { columns: [] },
    };
  }

  const hasHeaders = options?.hasHeaders ?? detectHeaders(dataRows[0]);
  const headers = hasHeaders
    ? dataRows[0].map((h, i) => h.trim() || `column_${i + 1}`)
    : dataRows[0].map((_, i) => `column_${i + 1}`);

  const valueRows = hasHeaders ? dataRows.slice(1) : dataRows;
  const sampleValues = valueRows.slice(0, 100);

  // Count total rows in file (approximate)
  const totalRows = lines.filter((l) => l.trim().length > 0).length - (hasHeaders ? 1 : 0) - skipRows;

  const columns: ColumnMapping[] = headers.map((name, colIdx) => {
    const colValues = sampleValues.map((row) => row[colIdx]);
    const { type, nullable } = inferColumnType(colValues);
    return {
      jsonPath: name,
      columnName: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      dataType: type,
      nullable,
    };
  });

  const sampleRows = sampleValues.slice(0, 5).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? null;
    });
    return obj;
  });

  return {
    delimiter,
    hasHeaders,
    encoding: "utf-8",
    rowCount: totalRows,
    sampleRows,
    schema: { columns },
  };
}
