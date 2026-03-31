import { BlueprintStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProvider, toConnectionLike } from "@/lib/providers";
import { sendReportEmail, toEmailConfig } from "@/lib/email";
import type { EmailConnectionConfig } from "@/lib/email";
import ExcelJS from "exceljs";
import { formatInTimeZone } from "date-fns-tz";
import type { SheetTemplate } from "@/components/reports/univer-sheet";
import type { ColumnConfig } from "@/lib/column-config";
import { applyColumnConfig, generateColumnConfig, migrateConfigWidths, UNIVER_PX_PER_EXCEL_WIDTH, DEFAULT_EXCEL_WIDTH } from "@/lib/column-config";
import {
  renderEmailTemplate,
  renderPlainText,
  buildSubject,
  formatFileSize,
  type HermodEmailModel,
} from "@/lib/email-templates";
import { executeBlueprint, validateInputSchema } from "@/lib/mjolnir";
import type { ForgeStep, BlueprintData, BlueprintFormatting, CapturedCellStyle, StepMetric } from "@/lib/mjolnir";

/** Univer ICellData shape (subset we use for export) */
interface UniverCellData {
  v?: string | number;
  s?: string | UniverStyleData;
  f?: string;
}

/** Univer IColorStyle shape (subset we use for export) */
interface UniverColorStyle {
  rgb?: string | null;
  th?: number; // ThemeColorType enum (0=DARK1, 1=LIGHT1, 2=DARK2, 3=LIGHT2, 4-9=ACCENT1-6)
}

/** Univer IStyleData shape (subset we use for export) */
interface UniverStyleData {
  bl?: 0 | 1; // bold
  it?: 0 | 1; // italic
  fs?: number; // font size
  ff?: string; // font family
  cl?: UniverColorStyle; // font color
  bg?: UniverColorStyle; // background color
  ht?: number; // horizontal align: 1=left, 2=center, 3=right
  vt?: number; // vertical align: 1=top, 2=center, 3=bottom
  n?: { pattern: string }; // number format
  bd?: Record<string, { s: number; cl?: UniverColorStyle }>; // borders
}

/** Office theme color palette (matches Univer's default "Office" theme) */
const THEME_COLORS: Record<number, string> = {
  0: "#000000", // DARK1
  1: "#FFFFFF", // LIGHT1
  2: "#44546A", // DARK2
  3: "#E7E6E6", // LIGHT2
  4: "#4472C4", // ACCENT1
  5: "#ED7D31", // ACCENT2
  6: "#A5A5A5", // ACCENT3
  7: "#70AD47", // ACCENT4
  8: "#5B9BD5", // ACCENT5
  9: "#70AD47", // ACCENT6
  10: "#0563C1", // HYPERLINK
  11: "#954F72", // FOLLOWED_HYPERLINK
};

/** Maximum rows a report can include. Rows beyond this are truncated with a warning. */
export const REPORT_ROW_LIMIT = 500_000;

// ─── Shared Pipeline ────────────────────────────────

/** Input for the shared report pipeline (query → transform → Excel). */
export interface PipelineInput {
  /** Report name (used as sheet name) */
  name: string;
  /** Raw SQL to execute */
  sqlQuery: string;
  /** Connection ID (resolved to Connection row internally) */
  connectionId: string;
  /** Saved column config JSON (or null for auto-generate) */
  columnConfig: unknown;
  /** Saved template JSON (Univer cosmetics) */
  formatting: unknown;
  /** Optional blueprint ID — if set, loads and executes the blueprint on query results */
  blueprintId?: string | null;
}

/** Output from the shared report pipeline. */
export interface PipelineResult {
  excelBuffer: Buffer;
  rowCount: number;
  columns: string[];
  runTimeMs: number;
  forgeWarnings: string[];
  forgeMetrics: StepMetric[];
}

/**
 * Shared report pipeline: query → column config → blueprint execution → Excel.
 *
 * Used by both `runReport()` (scheduled) and test-send (ad hoc).
 * If `blueprintId` is set, the blueprint is loaded, input schema is validated,
 * and the transformation pipeline is executed before Excel generation.
 */
export async function executeReportPipeline(input: PipelineInput): Promise<PipelineResult> {
  const startTime = Date.now();

  // 1. Resolve connection and execute query
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: input.connectionId },
  });
  const provider = getProvider(connection.type);
  if (!provider.query) {
    throw new Error(`Connection type "${connection.type}" does not support SQL queries`);
  }
  const connLike = toConnectionLike(connection);
  const conn = await provider.connect(connLike);
  let result;
  try {
    result = await provider.query(conn, input.sqlQuery);
  } finally {
    await conn.close();
  }

  // Enforce row limit — truncate with warning if exceeded
  let rowLimitWarning: string | null = null;
  if (result.rows.length > REPORT_ROW_LIMIT) {
    rowLimitWarning = `Query returned ${result.rows.length.toLocaleString()} rows — truncated to ${REPORT_ROW_LIMIT.toLocaleString()} row limit`;
    result.rows = result.rows.slice(0, REPORT_ROW_LIMIT);
  }

  let finalCols: string[];
  let finalRows: Record<string, unknown>[];
  let configIds: string[] = [];
  let colConfig: ColumnConfig[] = [];
  let template: SheetTemplate | null = null;
  let blueprintFormatting: BlueprintFormatting | null = null;
  const forgeWarnings: string[] = [];
  let forgeMetrics: StepMetric[] = [];
  let usedBlueprint = false;

  // Check for active blueprint first — it takes full control of column
  // transformation (rename, reorder, calculate, filter). Column config
  // is the manual approach; blueprints are the automated approach.
  // They must NOT both run or they fight each other.
  if (input.blueprintId) {
    const blueprint = await prisma.blueprint.findUnique({
      where: { id: input.blueprintId },
    });

    if (blueprint && blueprint.status !== BlueprintStatus.ARCHIVED) {
      const steps = blueprint.steps as unknown as ForgeStep[];
      const sourceSchema = blueprint.sourceSchema as BlueprintData["sourceSchema"];

      // Schema enforcement — validate raw query columns against blueprint expectation
      const schemaCheck = validateInputSchema(sourceSchema, result.columns);
      if (!schemaCheck.valid && !schemaCheck.skipped) {
        forgeWarnings.push(`Schema drift: ${schemaCheck.error}`);
      }

      // Execute blueprint on RAW query output (not column-config-mapped)
      const forgeResult = executeBlueprint(steps, {
        columns: result.columns,
        rows: result.rows,
      });

      finalCols = forgeResult.columns;
      finalRows = forgeResult.rows;
      forgeWarnings.push(...forgeResult.warnings);
      forgeMetrics = forgeResult.metrics;
      usedBlueprint = true;

      // Load captured AFTER formatting for pixel-perfect mirror
      blueprintFormatting = blueprint.afterFormatting as unknown as BlueprintFormatting | null;
    }
  }

  if (!usedBlueprint) {
    // No blueprint (or blueprint was ARCHIVED) — use column config mapping
    const rawConfig = (input.columnConfig as ColumnConfig[] | null) ?? generateColumnConfig(result.columns);
    colConfig = migrateConfigWidths(rawConfig);
    const mapped = applyColumnConfig(colConfig, result.columns, result.rows);
    finalCols = mapped.columns;
    finalRows = mapped.rows;
    configIds = mapped.configIds;
    template = (input.formatting as SheetTemplate | null) ?? null;
  }

  // Generate Excel — blueprint path uses captured AFTER formatting,
  // non-blueprint path uses Univer template.
  const excelBuffer = await generateExcel(
    input.name,
    finalCols!,
    finalRows!,
    configIds,
    colConfig,
    template,
    blueprintFormatting
  );

  const runTimeMs = Date.now() - startTime;

  return {
    excelBuffer,
    rowCount: result.rows.length,
    columns: finalCols!,
    runTimeMs,
    forgeWarnings: rowLimitWarning ? [rowLimitWarning, ...forgeWarnings] : forgeWarnings,
    forgeMetrics,
  };
}

/**
 * Execute a report: query DB -> generate Excel -> send email -> log result.
 */
export async function runReport(
  reportId: string,
  scheduleId: string
): Promise<{ id: string; status: string }> {
  // Idempotency guard: skip if this report already ran successfully in the last 5 minutes
  const recentRun = await prisma.runLog.findFirst({
    where: {
      reportId,
      status: "SUCCESS",
      startedAt: { gte: new Date(Date.now() - 5 * 60_000) },
    },
    select: { id: true },
  });
  if (recentRun) {
    console.log(`[Report] Skipping duplicate run for report ${reportId} — recent successful run exists`);
    return { id: recentRun.id, status: "skipped" };
  }

  const runLog = await prisma.runLog.create({
    data: { reportId, status: "RUNNING" },
  });

  const startTime = Date.now();

  let notifyConfig: EmailConnectionConfig | null = null;
  let reportName = "";
  let reportUserEmail = "";
  let scheduleTz = "America/Chicago";

  try {
    const report = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        connection: true,
        user: { select: { name: true, email: true } },
        schedule: { include: { recipients: true, emailConnection: true } },
      },
    });

    const schedule = report.schedule;
    if (!schedule) throw new Error("Report has no schedule");

    if (!schedule.emailConnection) {
      throw new Error("No email connection configured for this schedule. Add one in the schedule settings.");
    }
    const emailConfig = toEmailConfig(schedule.emailConnection);

    notifyConfig = emailConfig;
    reportName = report.name;
    reportUserEmail = report.user?.email || "";
    scheduleTz = schedule.timezone || "America/Chicago";

    const recipients = schedule.recipients.map((r) => r.email);
    if (recipients.length === 0) throw new Error("No recipients");

    // Execute shared pipeline (query → column config → blueprint → Excel)
    const pipeline = await executeReportPipeline({
      name: report.name,
      sqlQuery: report.sqlQuery,
      connectionId: report.connectionId,
      columnConfig: report.columnConfig,
      formatting: report.formatting,
      blueprintId: report.blueprintId,
    });

    const excelBuffer = pipeline.excelBuffer;
    const runTime = `${(pipeline.runTimeMs / 1000).toFixed(1)}s`;

    // Build email model and render template
    const now = new Date();
    const tz = schedule.timezone || "America/Chicago";
    const reportDate = formatInTimeZone(now, tz, "MMMM d, yyyy");
    const filename = `${report.name.replace(/[\/\\:*?"<>|]/g, "")}_${formatInTimeZone(now, tz, "yyyy-MM-dd")}.xlsx`;

    // Read nextRunAt (already advanced by worker scheduler before job runs)
    const updatedSchedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { nextRunAt: true },
    });
    const nextScheduleStr = updatedSchedule?.nextRunAt
      ? formatInTimeZone(updatedSchedule.nextRunAt, tz, "EEEE, MMMM d 'at' h:mm a")
      : "N/A";

    const emailModel: HermodEmailModel = {
      reportName: report.name,
      reportDate,
      filename,
      fileSize: formatFileSize(excelBuffer.length),
      nextSchedule: nextScheduleStr,
      recipientName: "Team",
      // Admin fields
      clientName: "Team",
      datasource: report.connection.name,
      executionDate: formatInTimeZone(now, tz, "yyyy-MM-dd HH:mm:ss"),
      duration: runTime,
      rowCount: pipeline.rowCount,
      sheetCount: 1,
      sqlPreview: report.sqlQuery,
      version: process.env.npm_package_version || "0.1.0",
      managedBy: report.user?.name || report.user?.email || "Hermod",
    };

    const subject = buildSubject(report.name, reportDate);
    const html = renderEmailTemplate("enduser", emailModel);
    const text = renderPlainText(emailModel);

    await sendReportEmail({
      connection: emailConfig,
      to: recipients,
      subject,
      text,
      html,
      attachment: excelBuffer,
      filename,
    });

    await prisma.runLog.update({
      where: { id: runLog.id },
      data: {
        status: "SUCCESS",
        rowCount: pipeline.rowCount,
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

    // Best-effort failure notification to report owner
    if (notifyConfig && reportUserEmail) {
      try {
        const { buildFailureNotificationEmail } = await import("./failure-notification");
        const { sendNotificationEmail } = await import("./email");
        const notification = buildFailureNotificationEmail({
          reportName,
          errorMessage: message,
          timestamp: formatInTimeZone(new Date(), scheduleTz, "yyyy-MM-dd HH:mm:ss"),
        });
        await sendNotificationEmail({
          connection: notifyConfig,
          to: [reportUserEmail],
          subject: notification.subject,
          body: notification.text,
        });
      } catch (notifyErr) {
        console.error("[Report] Failed to send failure notification:", notifyErr instanceof Error ? notifyErr.message : notifyErr);
      }
    }

    throw error;
  }
}

/**
 * Generate an Excel workbook from mapped columns/rows with template formatting
 * applied by column config ID.
 *
 * When `blueprintFmt` is provided, formatting is sourced from the captured AFTER
 * workbook styles (pixel-perfect mirror). Otherwise falls back to Univer template.
 */
export async function generateExcel(
  sheetName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  configIds: string[],
  colConfig: ColumnConfig[],
  template: SheetTemplate | null,
  blueprintFmt?: BlueprintFormatting | null
): Promise<Buffer> {
  // Route to blueprint formatting path if available
  if (blueprintFmt) {
    return generateExcelFromBlueprint(sheetName, columns, rows, blueprintFmt);
  }
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

  // Set column widths — config width is the primary source (synced from Univer on save).
  // Template width is used as fallback for older reports that haven't been re-saved.
  const visibleConfig = colConfig.filter((c) => c.visible);
  for (let i = 0; i < columns.length; i++) {
    const configWidth = visibleConfig[i]?.width;
    const hasExplicitConfig = configWidth !== undefined && Math.abs(configWidth - DEFAULT_EXCEL_WIDTH) > 0.01;

    if (hasExplicitConfig) {
      worksheet.getColumn(i + 1).width = configWidth;
    } else {
      // Fallback: read from template columnData (backwards compat with pre-sync reports)
      const tmplIdx = reverseMap.get(i);
      const tmplCol = tmplIdx !== undefined ? tmplColumnData[tmplIdx] : undefined;
      worksheet.getColumn(i + 1).width = tmplCol?.w
        ? Math.round((tmplCol.w / UNIVER_PX_PER_EXCEL_WIDTH) * 100) / 100
        : DEFAULT_EXCEL_WIDTH;
    }
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
    const headerFontColor = resolveColorRgb(style?.cl);
    const headerBgColor = resolveColorRgb(style?.bg);
    cell.font = {
      bold: style?.bl !== undefined ? style.bl === 1 : true,
      italic: style?.it === 1 || false,
      size: style?.fs || 11,
      name: style?.ff || undefined,
      color: { argb: argbFromRgb(headerFontColor, "FF000000") },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argbFromRgb(headerBgColor, "FFD9E1F2") },
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

/**
 * Generate an Excel workbook using captured BlueprintFormatting — pixel-perfect mirror
 * of the AFTER workbook. Applies header area styles, data row template, merges, widths,
 * heights, freeze panes, and number formats.
 */
async function generateExcelFromBlueprint(
  sheetName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  fmt: BlueprintFormatting
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

  const headerRowCount = fmt.headerRowCount; // e.g. 1 = just column headers, 2 = group row + headers
  const dataStartRow = headerRowCount + 1; // 1-based Excel row where data begins

  // Build column name → formatting index map (O(1) lookups instead of repeated indexOf)
  const colToFmtIdx = new Map<string, number>();
  for (let i = 0; i < fmt.columns.length; i++) {
    colToFmtIdx.set(fmt.columns[i], i);
  }

  // Build column position map: formatting position → current output position
  // This handles the case where blueprint transforms reorder columns differently
  const fmtColMap = new Map<number, number>();
  for (let i = 0; i < columns.length; i++) {
    const fmtIdx = colToFmtIdx.get(columns[i]);
    if (fmtIdx !== undefined) {
      fmtColMap.set(fmtIdx, i);
    }
  }

  // ─── Column Widths ────────────────────────────────
  for (let i = 0; i < columns.length; i++) {
    const fmtIdx = colToFmtIdx.get(columns[i]) ?? -1;
    const width = fmtIdx !== -1 && fmtIdx < fmt.columnWidths.length
      ? fmt.columnWidths[fmtIdx]
      : DEFAULT_EXCEL_WIDTH;
    worksheet.getColumn(i + 1).width = width;
  }

  // ─── Header Area Rows ─────────────────────────────
  for (let r = 0; r < headerRowCount; r++) {
    const excelRow = r + 1;
    const row = worksheet.getRow(excelRow);

    // Set row height
    if (r < fmt.headerRowHeights.length) {
      row.height = fmt.headerRowHeights[r];
    }

    // The last header row is the column name row — write actual column names
    const isColumnHeaderRow = r === headerRowCount - 1;

    for (let c = 0; c < columns.length; c++) {
      const cell = worksheet.getCell(excelRow, c + 1);

      // Find the formatting index for this column
      const fmtIdx = colToFmtIdx.get(columns[c]) ?? -1;
      const styleKey = `${r}:${fmtIdx !== -1 ? fmtIdx : c}`;

      if (isColumnHeaderRow) {
        // Write actual column name (post-blueprint-transform)
        cell.value = columns[c];
      } else {
        // Preamble row — write stored header values (group headers, titles, etc.)
        const valueKey = `${r}:${fmtIdx !== -1 ? fmtIdx : c}`;
        const storedValue = fmt.headerValues[valueKey];
        if (storedValue !== null && storedValue !== undefined) {
          cell.value = storedValue as ExcelJS.CellValue;
        }
      }

      // Apply captured cell style
      const capturedStyle = fmt.headerStyles[styleKey];
      if (capturedStyle) {
        applyCapturedStyle(cell, capturedStyle);
      }
    }
  }

  // ─── Data Rows ────────────────────────────────────
  for (let r = 0; r < rows.length; r++) {
    const excelRow = dataStartRow + r;
    const row = worksheet.getRow(excelRow);

    // Set data row height if captured
    if (fmt.dataRowHeight) {
      row.height = fmt.dataRowHeight;
    }

    for (let c = 0; c < columns.length; c++) {
      const cell = worksheet.getCell(excelRow, c + 1);
      cell.value = rows[r][columns[c]] as ExcelJS.CellValue;

      // Apply data row template style (keyed by formatting column index)
      const fmtIdx = colToFmtIdx.get(columns[c]) ?? -1;
      const templateStyle = fmtIdx !== -1 ? fmt.dataRowStyles[fmtIdx] : undefined;
      if (templateStyle) {
        applyCapturedStyle(cell, templateStyle);
      }
    }
  }

  // ─── Merged Cells ─────────────────────────────────
  for (const merge of fmt.merges) {
    // Remap merge columns from formatting positions to current positions
    const startCol = fmtColMap.get(merge.startCol);
    const endCol = fmtColMap.get(merge.endCol);
    if (startCol === undefined || endCol === undefined) continue;

    try {
      worksheet.mergeCells(
        merge.startRow + 1, startCol + 1,
        merge.endRow + 1, endCol + 1
      );
    } catch {
      // Skip invalid merges (e.g. overlapping)
    }
  }

  // ─── Freeze Panes ────────────────────────────────
  if (fmt.freeze) {
    worksheet.views = [{
      state: "frozen",
      xSplit: fmt.freeze.col - 1, // back to 0-based for ExcelJS
      ySplit: fmt.freeze.row - 1,
    }];
  } else {
    // Default: freeze below header area
    worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: headerRowCount }];
  }

  // ─── Auto Filter ──────────────────────────────────
  if (columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: headerRowCount, column: 1 },
      to: { row: headerRowCount, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Apply a CapturedCellStyle (from BlueprintFormatting) to an ExcelJS cell.
 */
function applyCapturedStyle(cell: ExcelJS.Cell, style: CapturedCellStyle): void {
  // Font
  if (style.font) {
    cell.font = {
      bold: style.font.bold || undefined,
      italic: style.font.italic || undefined,
      size: style.font.size || undefined,
      name: style.font.name || undefined,
      color: style.font.color ? { argb: resolveCapturedArgb(style.font.color) } : undefined,
      underline: style.font.underline || undefined,
      strike: style.font.strike || undefined,
    };
  }

  // Fill
  if (style.fill) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: resolveCapturedArgb(style.fill) },
    };
  }

  // Alignment
  if (style.alignment) {
    cell.alignment = {
      horizontal: style.alignment.horizontal as ExcelJS.Alignment["horizontal"],
      vertical: style.alignment.vertical as ExcelJS.Alignment["vertical"],
      wrapText: style.alignment.wrapText || undefined,
    };
  }

  // Borders
  if (style.border) {
    const borders: Partial<ExcelJS.Borders> = {};
    for (const [side, borderDef] of Object.entries(style.border)) {
      (borders as Record<string, Partial<ExcelJS.Border>>)[side] = {
        style: borderDef.style as ExcelJS.BorderStyle,
        color: borderDef.color ? { argb: resolveCapturedArgb(borderDef.color) } : undefined,
      };
    }
    cell.border = borders;
  }

  // Number format
  if (style.numFmt) {
    cell.numFmt = style.numFmt;
  }
}

/** Resolve a captured ARGB string (or THEME:n:tint) to an ExcelJS-compatible ARGB hex. */
function resolveCapturedArgb(argb: string): string {
  // Theme color reference: "THEME:4:0"
  if (argb.startsWith("THEME:")) {
    const parts = argb.split(":");
    const themeIdx = parseInt(parts[1], 10);
    const baseColor = THEME_COLORS[themeIdx];
    if (baseColor) {
      return argbFromRgb(baseColor);
    }
    return "FF000000"; // fallback
  }
  // Already an ARGB hex string (e.g. "FFD9E1F2")
  return argb;
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

/**
 * Extract a usable RGB string from a Univer IColorStyle, resolving theme colors if needed.
 * Returns null for transparent/empty colors so callers skip applying them.
 */
function resolveColorRgb(color: UniverColorStyle | undefined | null): string | null {
  if (!color) return null;

  // Prefer explicit rgb value
  if (color.rgb && color.rgb !== "transparent") {
    // Detect transparent rgba/8-digit-hex and return null (no fill)
    const rgbaMatch = color.rgb.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    if (rgbaMatch && parseFloat(rgbaMatch[1]) < 0.01) return null;

    // 8-digit hex with alpha=00 → transparent
    const clean = color.rgb.replace("#", "").trim();
    if (/^[0-9a-fA-F]{8}$/.test(clean) && clean.substring(0, 2).toUpperCase() === "00") return null;

    return color.rgb;
  }

  // Fall back to theme color resolution
  if (color.th !== undefined && color.th !== null) {
    return THEME_COLORS[color.th] ?? null;
  }
  return null;
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
  const fontColorRgb = resolveColorRgb(style.cl);
  const hasFont = style.bl !== undefined || style.it !== undefined || style.fs || style.ff || fontColorRgb;
  if (hasFont) {
    cell.font = {
      ...cell.font,
      bold: style.bl === 1 || undefined,
      italic: style.it === 1 || undefined,
      size: style.fs || undefined,
      name: style.ff || undefined,
      color: fontColorRgb ? { argb: argbFromRgb(fontColorRgb) } : undefined,
    };
  }
  const bgColorRgb = resolveColorRgb(style.bg);
  if (bgColorRgb) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argbFromRgb(bgColorRgb) },
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
  bd: Record<string, { s: number; cl?: UniverColorStyle }>
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
    const borderColorRgb = resolveColorRgb(border.cl);
    (result as Record<string, Partial<ExcelJS.Border>>)[excelSide] = {
      style: borderStyleMap[border.s] ?? "thin",
      color: borderColorRgb ? { argb: argbFromRgb(borderColorRgb) } : undefined,
    };
  }
  return result;
}

function argbFromRgb(rgb: string | null | undefined, fallback?: string): string {
  if (!rgb || rgb === "transparent") return fallback ?? "FF000000";

  // Handle rgb(r,g,b) / rgba(r,g,b,a) format
  const rgbMatch = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbMatch) {
    // If alpha channel is effectively 0, treat as transparent → use fallback
    const alpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if (alpha < 0.01) return fallback ?? "FF000000";
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

  // 8-digit hex (AARRGGBB) — if alpha is 00, treat as transparent
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    const alphaHex = clean.substring(0, 2).toUpperCase();
    if (alphaHex === "00") return fallback ?? "FF000000";
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
