import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { extractStyleTemplate } from "@/lib/mjolnir/engine/style-extractor";

/**
 * Helper: create an Excel buffer with specific formatting for testing extraction.
 */
async function createFormattedExcel(opts: {
  headerRowIndex?: number;
  columns?: string[];
  rows?: Record<string, unknown>[];
  headerStyle?: Partial<ExcelJS.Style>;
  dataStyle?: Partial<ExcelJS.Style>;
  columnWidths?: number[];
  headerRowHeight?: number;
  dataRowHeight?: number;
  groupHeader?: { text: string; mergeEnd: number };
  freeze?: { row: number; col: number };
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Sheet1");

  const columns = opts.columns ?? ["Name", "Value"];
  const headerRowIndex = opts.headerRowIndex ?? 1;

  // Set column widths
  if (opts.columnWidths) {
    for (let i = 0; i < opts.columnWidths.length; i++) {
      ws.getColumn(i + 1).width = opts.columnWidths[i];
    }
  }

  // Write group header (row above column headers)
  if (opts.groupHeader && headerRowIndex > 1) {
    const cell = ws.getCell(1, 1);
    cell.value = opts.groupHeader.text;
    cell.font = { bold: true, size: 14 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
    ws.mergeCells(1, 1, 1, opts.groupHeader.mergeEnd);
  }

  // Write header row
  const headerRow = ws.getRow(headerRowIndex);
  if (opts.headerRowHeight) headerRow.height = opts.headerRowHeight;

  for (let c = 0; c < columns.length; c++) {
    const cell = headerRow.getCell(c + 1);
    cell.value = columns[c];
    if (opts.headerStyle) {
      if (opts.headerStyle.font) cell.font = opts.headerStyle.font;
      if (opts.headerStyle.fill) cell.fill = opts.headerStyle.fill;
      if (opts.headerStyle.alignment) cell.alignment = opts.headerStyle.alignment;
      if (opts.headerStyle.border) cell.border = opts.headerStyle.border;
    }
  }

  // Write data rows
  const rows = opts.rows ?? [
    { Name: "Alice", Value: 100 },
    { Name: "Bob", Value: 200 },
  ];
  for (let r = 0; r < rows.length; r++) {
    const dataRow = ws.getRow(headerRowIndex + 1 + r);
    if (opts.dataRowHeight) dataRow.height = opts.dataRowHeight;

    for (let c = 0; c < columns.length; c++) {
      const cell = dataRow.getCell(c + 1);
      cell.value = rows[r][columns[c]] as ExcelJS.CellValue;
      if (opts.dataStyle) {
        if (opts.dataStyle.font) cell.font = opts.dataStyle.font;
        if (opts.dataStyle.fill) cell.fill = opts.dataStyle.fill;
        if (opts.dataStyle.alignment) cell.alignment = opts.dataStyle.alignment;
        if (opts.dataStyle.numFmt) cell.numFmt = opts.dataStyle.numFmt;
      }
    }
  }

  // Freeze panes
  if (opts.freeze) {
    ws.views = [{
      state: "frozen",
      xSplit: opts.freeze.col,
      ySplit: opts.freeze.row,
    }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("extractStyleTemplate", () => {
  it("extracts column widths", async () => {
    const buffer = await createFormattedExcel({
      columns: ["A", "B", "C"],
      columnWidths: [15, 20, 10],
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["A", "B", "C"]);
    expect(fmt.columnWidths).toEqual([15, 20, 10]);
  });

  it("extracts header font styles", async () => {
    const buffer = await createFormattedExcel({
      columns: ["Name", "Value"],
      headerStyle: {
        font: { bold: true, size: 12, name: "Calibri", color: { argb: "FFFFFFFF" } },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } },
      },
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["Name", "Value"]);

    // Header styles keyed by "0:0", "0:1" (0-indexed row:col)
    const s0 = fmt.headerStyles["0:0"];
    expect(s0).toBeDefined();
    expect(s0.font?.bold).toBe(true);
    expect(s0.font?.size).toBe(12);
    expect(s0.font?.name).toBe("Calibri");
    expect(s0.font?.color).toBe("FFFFFFFF");
    expect(s0.fill).toBe("FF4472C4");
  });

  it("extracts data row template styles", async () => {
    const buffer = await createFormattedExcel({
      columns: ["Name", "Value"],
      dataStyle: {
        font: { name: "Arial", size: 10 },
        alignment: { horizontal: "right" },
        numFmt: "#,##0.00",
      },
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["Name", "Value"]);

    // Data row styles keyed by column index (0-indexed)
    const d0 = fmt.dataRowStyles[0];
    expect(d0).toBeDefined();
    expect(d0.font?.name).toBe("Arial");
    expect(d0.font?.size).toBe(10);
    expect(d0.alignment?.horizontal).toBe("right");
    expect(d0.numFmt).toBe("#,##0.00");
  });

  it("extracts row heights", async () => {
    const buffer = await createFormattedExcel({
      columns: ["A"],
      headerRowHeight: 25,
      dataRowHeight: 18,
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["A"]);
    expect(fmt.headerRowHeights[0]).toBe(25);
    expect(fmt.dataRowHeight).toBe(18);
  });

  it("extracts freeze panes", async () => {
    const buffer = await createFormattedExcel({
      columns: ["A", "B"],
      freeze: { row: 1, col: 1 },
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["A", "B"]);
    expect(fmt.freeze).toBeDefined();
    expect(fmt.freeze?.row).toBe(2); // stored as 1-based (ySplit + 1)
    expect(fmt.freeze?.col).toBe(2); // stored as 1-based (xSplit + 1)
  });

  it("extracts border styles", async () => {
    const buffer = await createFormattedExcel({
      columns: ["A"],
      headerStyle: {
        border: {
          top: { style: "thin", color: { argb: "FF000000" } },
          bottom: { style: "medium", color: { argb: "FF333333" } },
        },
      },
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["A"]);
    const s = fmt.headerStyles["0:0"];
    expect(s.border).toBeDefined();
    expect(s.border?.top?.style).toBe("thin");
    expect(s.border?.top?.color).toBe("FF000000");
    expect(s.border?.bottom?.style).toBe("medium");
    expect(s.border?.bottom?.color).toBe("FF333333");
  });

  it("captures header values for preamble rows", async () => {
    const buffer = await createFormattedExcel({
      columns: ["Name", "Value"],
      headerRowIndex: 2,
      groupHeader: { text: "Summary Report", mergeEnd: 2 },
    });

    const fmt = await extractStyleTemplate(buffer, 2, ["Name", "Value"]);

    // Row 0 (preamble) should have the group header value
    expect(fmt.headerValues["0:0"]).toBe("Summary Report");
    expect(fmt.headerRowCount).toBe(2);

    // Row 1 should be column headers
    expect(fmt.headerValues["1:0"]).toBe("Name");
    expect(fmt.headerValues["1:1"]).toBe("Value");
  });

  it("captures merge ranges in header area", async () => {
    // Create workbook with explicit merge via ExcelJS
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Sheet1");
    ws.getCell(1, 1).value = "Group Title";
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.mergeCells("A1:C1");

    ws.getCell(2, 1).value = "A";
    ws.getCell(2, 2).value = "B";
    ws.getCell(2, 3).value = "C";
    ws.getCell(3, 1).value = "data1";
    ws.getCell(3, 2).value = "data2";
    ws.getCell(3, 3).value = "data3";

    // Write and read back to ensure merges are stored properly
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(raw);

    const fmt = await extractStyleTemplate(buffer, 2, ["A", "B", "C"]);

    // Should have at least one merge covering row 1 (the group header)
    expect(fmt.merges.length).toBeGreaterThan(0);
    const merge = fmt.merges[0];
    expect(merge.startRow).toBe(0); // 0-indexed
    expect(merge.startCol).toBe(0);
    expect(merge.endCol).toBe(2); // A through C (0-indexed)
  });

  it("stores columns array in formatting", async () => {
    const buffer = await createFormattedExcel({
      columns: ["SKU", "On Hand", "Available"],
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["SKU", "On Hand", "Available"]);
    expect(fmt.columns).toEqual(["SKU", "On Hand", "Available"]);
  });

  it("defaults column width to 8.43 when not set", async () => {
    // Create workbook without explicit column widths
    const buffer = await createFormattedExcel({
      columns: ["A", "B"],
    });

    const fmt = await extractStyleTemplate(buffer, 1, ["A", "B"]);
    // Default Excel column width is 8.43
    expect(fmt.columnWidths[0]).toBeCloseTo(8.43, 1);
    expect(fmt.columnWidths[1]).toBeCloseTo(8.43, 1);
  });

  it("ignores transparent fill colors", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Sheet1");
    // Cell with no fill (ExcelJS default) — should not capture
    ws.getCell(1, 1).value = "Header";
    ws.getCell(1, 1).font = { bold: true };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fmt = await extractStyleTemplate(buffer, 1, ["Header"]);

    // Should capture the font but not a fill
    const s = fmt.headerStyles["0:0"];
    if (s) {
      expect(s.font?.bold).toBe(true);
      expect(s.fill).toBeUndefined();
    }
  });
});
