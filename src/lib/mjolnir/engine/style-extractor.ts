/**
 * Mjolnir — Style extractor for AFTER workbooks.
 *
 * Reads an Excel buffer and captures ALL formatting: cell styles, fonts,
 * colors, fills, borders, alignments, merged cells, column widths, row
 * heights, and freeze panes.
 *
 * The captured `BlueprintFormatting` is stored in the blueprint and used
 * to produce pixel-perfect mirror output during Excel generation.
 */

import ExcelJS from "exceljs";
import type { BlueprintFormatting, CapturedCellStyle } from "../types";
import { DEFAULT_EXCEL_WIDTH } from "@/lib/column-config";

// ─── Helpers ────────────────────────────────────────

/**
 * Extract ARGB hex from an ExcelJS color object.
 * Returns null if transparent or empty.
 */
function extractColor(color: Partial<ExcelJS.Color> | undefined): string | null {
  if (!color) return null;
  if (color.argb) {
    // ExcelJS sometimes gives 6-char (no alpha) or 8-char ARGB
    const argb = color.argb.length === 6 ? `FF${color.argb}` : color.argb;
    // Check for transparent (alpha = 00)
    if (argb.substring(0, 2) === "00") return null;
    return argb;
  }
  if (color.theme !== undefined) {
    // Theme color — store as-is, will resolve during application
    return `THEME:${color.theme}:${(color as Record<string, unknown>).tint ?? 0}`;
  }
  return null;
}

/**
 * Capture a cell's style into a serializable CapturedCellStyle.
 */
function captureStyle(cell: ExcelJS.Cell): CapturedCellStyle | null {
  const style: CapturedCellStyle = {};
  let hasContent = false;

  // Font
  const font = cell.font;
  if (font && (font.bold || font.italic || font.size || font.name || font.color || font.underline || font.strike)) {
    style.font = {};
    if (font.bold) style.font.bold = true;
    if (font.italic) style.font.italic = true;
    if (font.size) style.font.size = font.size;
    if (font.name) style.font.name = font.name;
    const fontColor = extractColor(font.color);
    if (fontColor) style.font.color = fontColor;
    if (font.underline) style.font.underline = true;
    if (font.strike) style.font.strike = true;
    hasContent = true;
  }

  // Fill
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && (fill as ExcelJS.FillPattern).pattern === "solid") {
    const fgColor = extractColor((fill as ExcelJS.FillPattern).fgColor);
    if (fgColor) {
      style.fill = fgColor;
      hasContent = true;
    }
  }

  // Alignment
  const align = cell.alignment;
  if (align && (align.horizontal || align.vertical || align.wrapText)) {
    style.alignment = {};
    if (align.horizontal) style.alignment.horizontal = align.horizontal;
    if (align.vertical) style.alignment.vertical = align.vertical;
    if (align.wrapText) style.alignment.wrapText = true;
    hasContent = true;
  }

  // Borders
  const border = cell.border;
  if (border) {
    const sides: Record<string, { style: string; color?: string }> = {};
    let hasBorder = false;
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const b = border[side];
      if (b && b.style) {
        sides[side] = { style: b.style };
        const borderColor = extractColor(b.color);
        if (borderColor) sides[side].color = borderColor;
        hasBorder = true;
      }
    }
    if (hasBorder) {
      style.border = sides;
      hasContent = true;
    }
  }

  // Number format
  if (cell.numFmt && cell.numFmt !== "General") {
    style.numFmt = cell.numFmt;
    hasContent = true;
  }

  return hasContent ? style : null;
}

/**
 * Get the display value from an ExcelJS cell.
 */
function getCellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  // Rich text
  if (typeof v === "object" && "richText" in v) {
    return (v as ExcelJS.CellRichTextValue).richText
      .map((rt) => rt.text)
      .join("");
  }
  // Formula with result
  if (typeof v === "object" && "result" in v) {
    const result = (v as ExcelJS.CellFormulaValue).result;
    if (typeof result === "string" || typeof result === "number") return result;
    return null;
  }
  return String(v);
}

// ─── Main Entry Point ───────────────────────────────

/**
 * Extract all formatting from an Excel buffer.
 *
 * Captures:
 * - Header area: every cell's font, fill, alignment, borders, number format, value
 * - Data row template: first data row's styles (applied to all data rows)
 * - Column widths, row heights, merged cells, freeze panes
 *
 * @param buffer Raw .xlsx file buffer
 * @param headerRowIndex 1-based row index of the column header row
 * @param columns Column names from the parsed header row
 * @param columnIndices Optional 1-based Excel column positions (defaults to 1..N)
 */
export async function extractStyleTemplate(
  buffer: Buffer,
  headerRowIndex: number,
  columns: string[],
  columnIndices?: number[]
): Promise<BlueprintFormatting> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheets found in workbook");

  const colCount = columns.length;
  const headerRowCount = headerRowIndex; // rows 1..headerRowIndex are header area
  // Use actual column positions if provided, otherwise assume 1-based sequential
  const colPositions = columnIndices ?? Array.from({ length: colCount }, (_, i) => i + 1);

  // ─── Column Widths ────────────────────────────────
  const columnWidths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    const col = worksheet.getColumn(colPositions[i]);
    columnWidths.push(col.width ?? DEFAULT_EXCEL_WIDTH);
  }

  // ─── Header Area Styles + Values ──────────────────
  const headerStyles: Record<string, CapturedCellStyle> = {};
  const headerValues: Record<string, string | number | null> = {};
  const headerRowHeights: number[] = [];

  for (let r = 1; r <= headerRowIndex; r++) {
    const row = worksheet.getRow(r);
    headerRowHeights.push(row.height ?? 15);

    for (let i = 0; i < colCount; i++) {
      const cell = row.getCell(colPositions[i]);
      const key = `${r - 1}:${i}`; // 0-indexed output position

      const style = captureStyle(cell);
      if (style) headerStyles[key] = style;

      const value = getCellValue(cell);
      if (value !== null) headerValues[key] = value;
    }
  }

  // ─── Data Row Template Styles ─────────────────────
  const dataRowStyles: Record<number, CapturedCellStyle> = {};
  const dataRowIndex = headerRowIndex + 1;
  let dataRowHeight: number | undefined;

  if (dataRowIndex <= worksheet.rowCount) {
    const dataRow = worksheet.getRow(dataRowIndex);
    dataRowHeight = dataRow.height ?? undefined;

    for (let i = 0; i < colCount; i++) {
      const cell = dataRow.getCell(colPositions[i]);
      const style = captureStyle(cell);
      if (style) dataRowStyles[i] = style; // 0-indexed output position
    }
  }

  // ─── Merged Cells (header area only) ──────────────
  const merges: BlueprintFormatting["merges"] = [];
  // ExcelJS _merges is keyed by top-left cell ref, each value has .model { top, left, bottom, right }
  const mergeRanges = (worksheet as unknown as { _merges: Record<string, { model?: { top: number; left: number; bottom: number; right: number } }> })._merges;
  if (mergeRanges) {
    for (const mergeEntry of Object.values(mergeRanges)) {
      const m = mergeEntry?.model;
      if (!m) continue;

      const startRow = m.top - 1;    // 0-indexed
      const endRow = m.bottom - 1;   // 0-indexed

      // Remap Excel column positions to output-relative indices
      const outputStartCol = colPositions.findIndex((pos) => pos >= m.left);
      const outputEndCol = colPositions.reduce<number>(
        (found, pos, i) => (pos <= m.right ? i : found), -1
      );

      // Only capture merges in the header area with valid output column mapping
      if (startRow < headerRowIndex && outputStartCol !== -1 && outputEndCol !== -1) {
        merges.push({ startRow, startCol: outputStartCol, endRow, endCol: outputEndCol });
      }
    }
  }

  // ─── Freeze Panes ────────────────────────────────
  let freeze: BlueprintFormatting["freeze"] | undefined;
  const views = worksheet.views;
  if (views && views.length > 0) {
    const view = views[0];
    if (view.state === "frozen" && (view.xSplit || view.ySplit)) {
      freeze = {
        row: (view.ySplit ?? 0) + 1, // ExcelJS ySplit is 0-based, we store 1-based
        col: (view.xSplit ?? 0) + 1,
      };
    }
  }

  return {
    headerRowCount,
    columnWidths,
    headerRowHeights,
    headerStyles,
    headerValues,
    dataRowStyles,
    dataRowHeight,
    merges,
    freeze,
    columns,
  };
}

