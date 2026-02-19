import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import { sendReportEmail, replaceTemplateVars } from "@/lib/email";
import ExcelJS from "exceljs";
import { format } from "date-fns";

interface FormattingConfig {
  columns?: Record<
    string,
    {
      width?: number;
      numFmt?: string;
      bold?: boolean;
      fontColor?: string;
      bgColor?: string;
      align?: string;
    }
  >;
  headerStyle?: {
    bold?: boolean;
    bgColor?: string;
    fontColor?: string;
  };
  cellStyles?: Record<string, Record<string, unknown>>;
}

/**
 * Execute a report: query DB → generate Excel → send email → log result.
 */
export async function runReport(
  reportId: string,
  scheduleId: string
): Promise<{ id: string; status: string }> {
  // Create run log
  const runLog = await prisma.runLog.create({
    data: { reportId, status: "RUNNING" },
  });

  const startTime = Date.now();

  try {
    // Fetch report + data source + schedule + recipients
    const report = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        dataSource: true,
        schedule: { include: { recipients: true } },
      },
    });

    const schedule = report.schedule;
    if (!schedule) throw new Error("Report has no schedule");

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

    // Generate Excel
    const excelBuffer = await generateExcel(
      report.name,
      result.columns,
      result.rows,
      (report.formatting as FormattingConfig) ?? {}
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

    // Send email
    await sendReportEmail({
      to: recipients,
      subject,
      body,
      attachment: excelBuffer,
      filename,
    });

    // Update run log
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
    const message =
      error instanceof Error ? error.message : "Unknown error";
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

async function generateExcel(
  sheetName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  formatting: FormattingConfig
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31)); // Excel max 31 chars

  // Add columns
  worksheet.columns = columns.map((col, index) => {
    const colFmt = formatting.columns?.[String(index)];
    return {
      header: col,
      key: col,
      width: colFmt?.width ? colFmt.width / 7 : 15, // Convert px to Excel width units approx
    };
  });

  // Style header row
  const headerStyle = formatting.headerStyle;
  if (headerStyle) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = {
        bold: headerStyle.bold ?? true,
        color: { argb: argbFromHex(headerStyle.fontColor ?? "#ffffff") },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argbFromHex(headerStyle.bgColor ?? "#1e3a5f") },
      };
    });
  }

  // Add data rows
  for (const row of rows) {
    const values = columns.map((col) => row[col]);
    worksheet.addRow(values);
  }

  // Apply column formatting to data cells
  if (formatting.columns) {
    for (const [indexStr, colFmt] of Object.entries(formatting.columns)) {
      const colIndex = Number(indexStr) + 1; // Excel is 1-based
      const column = worksheet.getColumn(colIndex);
      column.eachCell((cell, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        if (colFmt.bold) cell.font = { ...cell.font, bold: true };
        if (colFmt.fontColor) {
          cell.font = {
            ...cell.font,
            color: { argb: argbFromHex(colFmt.fontColor) },
          };
        }
        if (colFmt.bgColor && colFmt.bgColor !== "transparent") {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: argbFromHex(colFmt.bgColor) },
          };
        }
        if (colFmt.numFmt) cell.numFmt = colFmt.numFmt;
        if (colFmt.align) {
          cell.alignment = {
            horizontal: colFmt.align as "left" | "center" | "right",
          };
        }
      });
    }
  }

  // Auto-filter on header row
  if (columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function argbFromHex(hex: string): string {
  const clean = hex.replace("#", "");
  return `FF${clean.toUpperCase()}`;
}
