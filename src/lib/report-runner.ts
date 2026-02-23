import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import { sendReportEmail, replaceTemplateVars, toEmailConfig } from "@/lib/email";
import ExcelJS from "exceljs";
import { format } from "date-fns";
import type { SheetTemplate } from "@/components/reports/univer-sheet";
import type { ColumnConfig } from "@/lib/column-config";
import { applyColumnConfig, generateColumnConfig, migrateConfigWidths } from "@/lib/column-config";

/** Univer ICellData shape (subset we use for export) */
interface UniverCellData {
  v?: string | number;
  s?: string | UniverStyleData;
  f?: string;
}

/** Univer IStyleData shape (subset we use for export) */
interface UniverStyleData {
  bl?: 0 | 1; // bold
  it?: 0 | 1; // italic
  fs?: number; // font size
  ff?: string; // font family
  cl?: { rgb: string }; // font color
  bg?: { rgb: string }; // background color
  ht?: number; // horizontal align: 1=left, 2=center, 3=right
  vt?: number; // vertical align: 1=top, 2=center, 3=bottom
  n?: { pattern: string }; // number format
  bd?: Record<string, { s: number; cl?: { rgb: string } }>; // borders
}

/**
 * Execute a report: query DB -> generate Excel -> send email -> log result.
 */
export async function runReport(
  reportId: string,
  scheduleId: string
): Promise<{ id: string; status: string }> {
  const runLog = await prisma.runLog.create({
    data: { reportId, status: "RUNNING" },
  });

  const startTime = Date.now();

  try {
    const report = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        dataSource: true,
        schedule: { include: { recipients: true, emailConnection: true } },
      },
    });

    const schedule = report.schedule;
    if (!schedule) throw new Error("Report has no schedule");

    if (!schedule.emailConnection) {
      throw new Error("No email connection configured for this schedule. Add one in the schedule settings.");
    }
    const emailConfig = toEmailConfig(schedule.emailConnection);

    const recipients = schedule.recipients.map((r) => r.email);
    if (recipients.length === 0) throw new Error("No recipients");

    // Execute query
    const connector = getConnector(report.dataSource as Parameters<typeof getConnector>[0]);
    let result;
    try {
      result = await connector.query(report.sqlQuery);
    } finally {
      await connector.disconnect();
    }

    const runTime = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    // Load column config (or generate default from query), migrate old pixel widths
    const rawConfig = (report.columnConfig as ColumnConfig[] | null) ?? generateColumnConfig(result.columns);
    const colConfig = migrateConfigWidths(rawConfig);

    // Apply column config mapping
    const { columns: mappedCols, rows: mappedRows, configIds } = applyColumnConfig(
      colConfig,
      result.columns,
      result.rows
    );

    // Generate Excel
    const template = (report.formatting as SheetTemplate | null) ?? null;
    const excelBuffer = await generateExcel(
      report.name,
      mappedCols,
      mappedRows,
      configIds,
      colConfig,
      template
    );

    // Template variables
    const now = new Date();
    const vars: Record<string, string> = {
      report_name: report.name,
      date: format(now, "yyyy-MM-dd"),
      day_of_week: format(now, "EEEE"),
      row_count: String(result.rows.length),
      run_time: runTime,
      connection_name: report.dataSource.name,
    };

    const subject = replaceTemplateVars(schedule.emailSubject, vars);
    const body = replaceTemplateVars(
      schedule.emailBody || `Attached: ${report.name}`,
      vars
    );
    const filename = `${report.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}_${format(now, "yyyy-MM-dd")}.xlsx`;

    await sendReportEmail({
      connection: emailConfig,
      to: recipients,
      subject,
      body,
      attachment: excelBuffer,
      filename,
    });

    await prisma.runLog.update({
      where: { id: runLog.id },
      data: {
        status: "SUCCESS",
        rowCount: result.rows.length,
        completedAt: new Date(),
      },
    });

    return { id: runLog.id, status: "SUCCESS" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.runLog.update({
      where: { id: runLog.id },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

/**
 * Generate an Excel workbook from mapped columns/rows with template formatting
 * applied by column config ID.
 */
export async function generateExcel(
  sheetName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  configIds: string[],
  colConfig: ColumnConfig[],
  template: SheetTemplate | null
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

  // Extract template data
  const tmplSheet = template?.snapshot?.sheets
    ? Object.values(template.snapshot.sheets)[0]
    : null;
  const tmplStyles = (template?.snapshot?.styles ?? {}) as Record<string, UniverStyleData>;
  const tmplCellData = (tmplSheet?.cellData ?? {}) as Record<number, Record<number, UniverCellData>>;
  const tmplColumnData = (tmplSheet?.columnData ?? {}) as Record<number, { w?: number }>;
  const tmplFreeze = tmplSheet?.freeze as { xSplit?: number; ySplit?: number } | undefined;
  const tmplMergeData = (tmplSheet?.mergeData ?? []) as Array<{
    startRow: number; startColumn: number; endRow: number; endColumn: number;
  }>;

  // Build position map: template saved position → current position
  const posMap = buildExcelPositionMap(template, configIds);

  // Build reverse map: current position → template saved position (for lookup)
  const reverseMap = new Map<number, number>();
  for (const [tmplPos, curPos] of posMap) {
    reverseMap.set(curPos, tmplPos);
  }

  const startRow = template?.startRow ?? 0;
  const headerExcelRow = startRow + 1; // 1-based
  const firstDataExcelRow = startRow + 2; // 1-based

  // Set column widths
  const visibleConfig = colConfig.filter((c) => c.visible);
  for (let i = 0; i < columns.length; i++) {
    const tmplIdx = reverseMap.get(i);
    const tmplCol = tmplIdx !== undefined ? tmplColumnData[tmplIdx] : undefined;
    const configWidth = visibleConfig[i]?.width;
    worksheet.getColumn(i + 1).width = tmplCol?.w ? tmplCol.w / 7 : configWidth ?? 8.43;
  }

  // Write preamble rows from template (rows 0..startRow-1 → Excel rows 1..startRow)
  if (startRow > 0) {
    for (let r = 0; r < startRow; r++) {
      const rowCells = tmplCellData[r];
      if (!rowCells) continue;
      for (const [colStr, tmplCell] of Object.entries(rowCells as Record<string, UniverCellData>)) {
        const colIdx = Number(colStr);
        const cell = worksheet.getCell(r + 1, colIdx + 1);
        if (tmplCell.v !== undefined) cell.value = tmplCell.v as ExcelJS.CellValue;
        if (tmplCell.f) cell.value = { formula: tmplCell.f } as ExcelJS.CellFormulaValue;
        const style = resolveStyle(tmplCell, tmplStyles);
        if (style) {
          applyStyleToCell(cell, style);
          if (style.n?.pattern) cell.numFmt = style.n.pattern;
        }
      }
    }

    // Preamble merge ranges (no column remapping)
    for (const merge of tmplMergeData) {
      if (merge.endRow >= startRow) continue;
      try {
        worksheet.mergeCells(
          merge.startRow + 1, merge.startColumn + 1,
          merge.endRow + 1, merge.endColumn + 1
        );
      } catch {
        // Skip invalid merges
      }
    }
  }

  // Write header row — merge template styles ON TOP of defaults
  for (let c = 0; c < columns.length; c++) {
    const cell = worksheet.getCell(headerExcelRow, c + 1);
    cell.value = columns[c];

    const tmplIdx = reverseMap.get(c);
    const tmplCell = tmplIdx !== undefined ? tmplCellData[startRow]?.[tmplIdx] : undefined;
    const style = resolveStyle(tmplCell, tmplStyles);

    // Always start with sensible defaults, then overlay template values
    cell.font = {
      bold: style?.bl !== undefined ? style.bl === 1 : true,
      italic: style?.it === 1 || false,
      size: style?.fs || 11,
      name: style?.ff || undefined,
      color: { argb: argbFromRgb(style?.cl?.rgb, "FF000000") },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argbFromRgb(style?.bg?.rgb, "FFD9E1F2") },
    };
    cell.alignment = {
      horizontal: style?.ht ? univerAlignToExcel(style.ht) : "left",
      vertical: style?.vt ? univerVertAlignToExcel(style.vt) : "middle",
    };
    if (style?.bd) {
      cell.border = univerBorderToExcel(style.bd);
    }
  }

  // Write data rows
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      worksheet.getCell(firstDataExcelRow + r, c + 1).value = rows[r][columns[c]] as ExcelJS.CellValue;
    }
  }

  // Apply template styles to data cells (mapped by ID)
  for (const [rowStr, rowCells] of Object.entries(tmplCellData)) {
    const rowIdx = Number(rowStr);
    if (rowIdx <= startRow) continue; // Skip preamble and header

    for (const [colStr, tmplCell] of Object.entries(rowCells as Record<string, UniverCellData>)) {
      const tmplColIdx = Number(colStr);
      const currentColIdx = posMap.get(tmplColIdx);
      if (currentColIdx === undefined) continue;

      const style = resolveStyle(tmplCell, tmplStyles);
      if (!style && !tmplCell.f) continue;

      for (let dataRow = firstDataExcelRow; dataRow < firstDataExcelRow + rows.length; dataRow++) {
        const cell = worksheet.getCell(dataRow, currentColIdx + 1);
        if (style) applyStyleToCell(cell, style);
        if (tmplCell.f) {
          const remappedFormula = remapFormulaColumns(tmplCell.f, posMap);
          cell.value = { formula: adjustFormulaRow(remappedFormula, rowIdx, dataRow - 1) } as ExcelJS.CellFormulaValue;
        }
        if (style?.n?.pattern) {
          cell.numFmt = style.n.pattern;
        }
      }
    }
  }

  // Apply formula columns from config
  for (let colIdx = 0; colIdx < visibleConfig.length; colIdx++) {
    const entry = visibleConfig[colIdx];
    if (!entry.formula) continue;
    for (let dataRow = firstDataExcelRow; dataRow < firstDataExcelRow + rows.length; dataRow++) {
      const cell = worksheet.getCell(dataRow, colIdx + 1);
      cell.value = { formula: adjustFormulaRow(entry.formula, 1, dataRow - 1) } as ExcelJS.CellFormulaValue;
    }
  }

  // Apply data merge ranges (with column remapping)
  for (const merge of tmplMergeData) {
    if (merge.startRow < startRow) continue; // Preamble merges already handled
    const startCol = posMap.get(merge.startColumn);
    const endCol = posMap.get(merge.endColumn);
    if (startCol === undefined || endCol === undefined) continue;
    try {
      worksheet.mergeCells(
        merge.startRow + 1, startCol + 1,
        merge.endRow + 1, endCol + 1
      );
    } catch {
      // Skip invalid merges
    }
  }

  // Apply freeze panes
  if (tmplFreeze) {
    const frozenRows = tmplFreeze.ySplit ?? 0;
    const frozenCols = tmplFreeze.xSplit ?? 0;
    if (frozenRows > 0 || frozenCols > 0) {
      worksheet.views = [{
        state: "frozen",
        xSplit: frozenCols,
        ySplit: frozenRows,
      }];
    }
  } else {
    worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: startRow + 1 }];
  }

  // Auto-filter on header row
  if (columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: headerExcelRow, column: 1 },
      to: { row: headerExcelRow, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Build position map for Excel export: template position → current position */
function buildExcelPositionMap(
  template: SheetTemplate | null,
  currentConfigIds: string[]
): Map<number, number> {
  const map = new Map<number, number>();

  if (!template?.columnMap) {
    // v1 or no map — positional identity
    for (let i = 0; i < currentConfigIds.length; i++) {
      map.set(i, i);
    }
    return map;
  }

  const savedPosToId = new Map<number, string>();
  for (const [id, pos] of Object.entries(template.columnMap)) {
    savedPosToId.set(pos, id);
  }

  const currentIdToPos = new Map<string, number>();
  for (let i = 0; i < currentConfigIds.length; i++) {
    currentIdToPos.set(currentConfigIds[i], i);
  }

  for (const [savedPos, id] of savedPosToId) {
    const currentPos = currentIdToPos.get(id);
    if (currentPos !== undefined) {
      map.set(savedPos, currentPos);
    }
  }

  return map;
}

/** Remap formula column references when columns have moved */
function remapFormulaColumns(formula: string, posMap: Map<number, number>): string {
  return formula.replace(/([A-Z]+)(\d+)/g, (match, colLetters: string, rowNum: string) => {
    let colIdx = 0;
    for (let i = 0; i < colLetters.length; i++) {
      colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 65);
    }
    const newIdx = posMap.get(colIdx);
    if (newIdx === undefined || newIdx === colIdx) return match;

    let newLetters = "";
    let idx = newIdx;
    do {
      newLetters = String.fromCharCode(65 + (idx % 26)) + newLetters;
      idx = Math.floor(idx / 26) - 1;
    } while (idx >= 0);

    return `${newLetters}${rowNum}`;
  });
}

function resolveStyle(
  cell: UniverCellData | undefined,
  styles: Record<string, UniverStyleData>
): UniverStyleData | null {
  if (!cell?.s) return null;
  if (typeof cell.s === "string") {
    return styles[cell.s] ?? null;
  }
  return cell.s;
}

function applyStyleToCell(cell: ExcelJS.Cell, style: UniverStyleData): void {
  const hasFont = style.bl !== undefined || style.it !== undefined || style.fs || style.ff || style.cl?.rgb;
  if (hasFont) {
    cell.font = {
      ...cell.font,
      bold: style.bl === 1 || undefined,
      italic: style.it === 1 || undefined,
      size: style.fs || undefined,
      name: style.ff || undefined,
      color: style.cl?.rgb ? { argb: argbFromRgb(style.cl.rgb) } : undefined,
    };
  }
  if (style.bg?.rgb && style.bg.rgb !== "transparent") {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argbFromRgb(style.bg.rgb) },
    };
  }
  if (style.ht) {
    cell.alignment = {
      ...cell.alignment,
      horizontal: univerAlignToExcel(style.ht),
    };
  }
  if (style.vt) {
    cell.alignment = {
      ...cell.alignment,
      vertical: univerVertAlignToExcel(style.vt),
    };
  }
  if (style.n?.pattern) {
    cell.numFmt = style.n.pattern;
  }
  if (style.bd) {
    cell.border = univerBorderToExcel(style.bd);
  }
}

function univerAlignToExcel(ht: number): "left" | "center" | "right" {
  switch (ht) {
    case 1: return "left";
    case 2: return "center";
    case 3: return "right";
    default: return "left";
  }
}

function univerVertAlignToExcel(vt: number): "top" | "middle" | "bottom" {
  switch (vt) {
    case 1: return "top";
    case 2: return "middle";
    case 3: return "bottom";
    default: return "middle";
  }
}

function univerBorderToExcel(
  bd: Record<string, { s: number; cl?: { rgb: string } }>
): Partial<ExcelJS.Borders> {
  const borderStyleMap: Record<number, ExcelJS.BorderStyle> = {
    1: "thin",
    2: "medium",
    3: "thick",
    4: "dotted",
    5: "dashed",
    6: "double",
  };
  const result: Partial<ExcelJS.Borders> = {};
  for (const [side, border] of Object.entries(bd)) {
    const excelSide = side === "t" ? "top" : side === "b" ? "bottom" : side === "l" ? "left" : "right";
    (result as Record<string, Partial<ExcelJS.Border>>)[excelSide] = {
      style: borderStyleMap[border.s] ?? "thin",
      color: border.cl ? { argb: argbFromRgb(border.cl.rgb) } : undefined,
    };
  }
  return result;
}

function argbFromRgb(rgb: string | null | undefined, fallback?: string): string {
  if (!rgb || rgb === "transparent") return fallback ?? "FF000000";

  // Handle rgb(r,g,b) / rgba(r,g,b,a) format
  const rgbMatch = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
    return `FF${r}${g}${b}`.toUpperCase();
  }

  const clean = rgb.replace("#", "").trim();

  // 3-digit hex shorthand → expand
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const expanded = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    return `FF${expanded.toUpperCase()}`;
  }

  // 8-digit hex (already includes alpha)
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    return clean.toUpperCase();
  }

  // Standard 6-digit hex
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `FF${clean.toUpperCase()}`;
  }

  // Unrecognized format — return fallback
  return fallback ?? "FF000000";
}

function adjustFormulaRow(formula: string, templateRow: number, targetRow: number): string {
  const offset = targetRow - templateRow;
  if (offset === 0) return formula;
  return formula.replace(/([A-Z]+)(\d+)/g, (_, col, row) => {
    const newRow = Number(row) + offset;
    return `${col}${newRow}`;
  });
}
