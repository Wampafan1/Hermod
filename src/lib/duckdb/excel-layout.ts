import ExcelJS from "exceljs";

export interface ExcelLayout {
  headerRow: number;
  dataStartRow: number;
}

interface RowStats {
  rowIndex: number;
  nonEmptyCount: number;
  firstCol: number;
  lastCol: number;
  labelLikeCount: number;
  dataLikeCount: number;
  metadataLikeCount: number;
  longTextCount: number;
  duplicateCount: number;
  values: string[];
}

const HEADER_SCAN_ROWS = 500;
const HEADER_SCAN_COLS = 300;
const DATA_LOOKAHEAD_ROWS = 25;

const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/,
];

const DATA_PATTERNS = [
  /^-?\d+(?:\.\d+)?$/,
  /^\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/,
  /^[A-Z0-9]{8,}$/,
  ...DATE_PATTERNS,
];

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function excelCellToValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return (value as { result?: unknown }).result ?? null;
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join("");
    }
    if ("text" in value) return (value as { text?: unknown }).text ?? null;
    if ("hyperlink" in value && "text" in value) {
      return (value as { text?: unknown }).text ?? null;
    }
  }
  return value;
}

function stringifyCellValue(value: unknown): string | null {
  if (isBlankValue(value)) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function isDataLike(value: string): boolean {
  return DATA_PATTERNS.some((pattern) => pattern.test(value));
}

function isLabelLike(value: string): boolean {
  if (value.length > 80) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (isDataLike(value)) return false;
  return true;
}

function isMetadataLike(value: string): boolean {
  return (
    /:\s*$/.test(value) ||
    /\bfrom:\b.*\bto\b/i.test(value) ||
    /^(printed by|generated|sort:|filter:)/i.test(value)
  );
}

function readRowStats(worksheet: ExcelJS.Worksheet): RowStats[] {
  const maxRows = Math.min(worksheet.rowCount, HEADER_SCAN_ROWS);
  let maxCols = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0, 1);
  for (let rowIndex = 1; rowIndex <= maxRows; rowIndex++) {
    maxCols = Math.max(maxCols, worksheet.getRow(rowIndex).cellCount);
  }
  maxCols = Math.min(maxCols, HEADER_SCAN_COLS);
  const rows: RowStats[] = [];

  for (let rowIndex = 1; rowIndex <= maxRows; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const values: string[] = [];
    let firstCol = 0;
    let lastCol = 0;

    for (let col = 1; col <= maxCols; col++) {
      const value = stringifyCellValue(excelCellToValue(row.getCell(col)));
      if (!value) continue;
      values.push(value);
      if (firstCol === 0) firstCol = col;
      lastCol = col;
    }

    const uniqueValues = new Set(values.map((value) => value.toLowerCase()));

    rows.push({
      rowIndex,
      nonEmptyCount: values.length,
      firstCol,
      lastCol,
      labelLikeCount: values.filter(isLabelLike).length,
      dataLikeCount: values.filter(isDataLike).length,
      metadataLikeCount: values.filter(isMetadataLike).length,
      longTextCount: values.filter((value) => value.length > 80).length,
      duplicateCount: values.length - uniqueValues.size,
      values,
    });
  }

  return rows;
}

function findFollowingRows(rows: RowStats[], rowIndex: number): RowStats[] {
  return rows
    .filter((row) => row.rowIndex > rowIndex && row.nonEmptyCount > 0)
    .slice(0, DATA_LOOKAHEAD_ROWS);
}

function findDataStartRow(rows: RowStats[], header: RowStats): number {
  const followingRows = findFollowingRows(rows, header.rowIndex);
  if (followingRows.length === 0) return header.rowIndex + 1;

  const minUsefulWidth =
    header.nonEmptyCount <= 1 ? 1 : Math.max(2, Math.floor(header.nonEmptyCount * 0.35));

  const dataRow = followingRows.find((row) => row.nonEmptyCount >= minUsefulWidth) ?? followingRows[0];
  return dataRow.rowIndex;
}

function scoreHeaderCandidate(rows: RowStats[], candidate: RowStats): number {
  if (candidate.nonEmptyCount === 0) return Number.NEGATIVE_INFINITY;

  const followingRows = findFollowingRows(rows, candidate.rowIndex);
  const precedingRows = rows
    .filter((row) => row.rowIndex < candidate.rowIndex && row.nonEmptyCount > 0)
    .slice(-8);
  const followingWidths = followingRows.slice(0, 8).map((row) => row.nonEmptyCount);
  const maxFollowingWidth = followingWidths.length > 0 ? Math.max(...followingWidths) : 0;
  const avgFollowingWidth =
    followingWidths.length > 0
      ? followingWidths.reduce((sum, width) => sum + width, 0) / followingWidths.length
      : 0;
  const maxPrecedingWidth =
    precedingRows.length > 0 ? Math.max(...precedingRows.map((row) => row.nonEmptyCount)) : 0;

  let score = 0;

  score += Math.min(35, candidate.nonEmptyCount * 2.5);

  if (candidate.nonEmptyCount > 1) {
    score += 12;
  } else {
    score -= 24;
  }

  const labelRatio = candidate.labelLikeCount / candidate.nonEmptyCount;
  const dataRatio = candidate.dataLikeCount / candidate.nonEmptyCount;
  score += labelRatio * 30;
  score -= dataRatio * 28;

  if (candidate.longTextCount > candidate.nonEmptyCount * 0.25) score -= 12;
  if (candidate.metadataLikeCount > 0 && candidate.nonEmptyCount <= 3) score -= 24;
  if (candidate.duplicateCount > Math.max(1, candidate.nonEmptyCount * 0.2)) score -= 8;

  if (maxFollowingWidth > 0) {
    const widthRatio = candidate.nonEmptyCount / maxFollowingWidth;
    if (widthRatio >= 0.45 && widthRatio <= 1.8) score += 22;
    if (widthRatio < 0.25) score -= 20;
    if (widthRatio > 3) score -= 14;
  }

  if (avgFollowingWidth >= Math.max(2, candidate.nonEmptyCount * 0.35)) score += 10;

  const followingDataRows = followingRows.slice(0, 5);
  if (followingDataRows.length > 0) {
    const followingDataLike = followingDataRows.reduce(
      (sum, row) => sum + row.dataLikeCount / Math.max(1, row.nonEmptyCount),
      0
    ) / followingDataRows.length;
    if (followingDataLike > dataRatio) score += 10;
  } else {
    score -= 10;
  }

  if (candidate.rowIndex === 1) score += 8;
  if (maxPrecedingWidth > 0 && candidate.nonEmptyCount >= maxPrecedingWidth * 2) score += 16;
  if (maxPrecedingWidth > 0 && candidate.nonEmptyCount <= maxPrecedingWidth && candidate.rowIndex > 1) {
    score -= 4;
  }

  if (candidate.firstCol > 0 && candidate.lastCol >= candidate.firstCol) {
    const span = candidate.lastCol - candidate.firstCol + 1;
    const density = candidate.nonEmptyCount / span;
    if (density >= 0.65) score += 6;
    if (density < 0.25) score -= 10;
  }

  return score;
}

export function detectExcelLayout(worksheet: ExcelJS.Worksheet): ExcelLayout {
  const rows = readRowStats(worksheet);
  const scored = rows
    .filter((row) => row.nonEmptyCount > 0)
    .map((row) => ({ row, score: scoreHeaderCandidate(rows, row) }))
    .sort((a, b) => b.score - a.score || a.row.rowIndex - b.row.rowIndex);

  const best = scored[0]?.score >= 25 ? scored[0].row : rows.find((row) => row.nonEmptyCount > 0);
  const headerRow = best?.rowIndex ?? 1;
  const dataStartRow = best ? findDataStartRow(rows, best) : headerRow + 1;

  return { headerRow, dataStartRow };
}
