import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generateExcel } from "@/lib/report-runner";
import type { SheetTemplate } from "@/components/reports/univer-sheet";
import type { ColumnConfig } from "@/lib/column-config";

/**
 * Helper: parse a generated Excel buffer and return the first worksheet.
 */
async function parseExcel(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

describe("generateExcel", () => {
  const columns = ["Name", "Amount", "Status"];
  const rows = [
    { Name: "Alice", Amount: 100, Status: "Active" },
    { Name: "Bob", Amount: 200, Status: "Inactive" },
    { Name: "Charlie", Amount: 300, Status: "Active" },
  ];
  const configIds = ["cfg_aaa", "cfg_bbb", "cfg_ccc"];
  const colConfig: ColumnConfig[] = [
    { id: "cfg_aaa", sourceColumn: "name", displayName: "Name", visible: true, width: 12 },
    { id: "cfg_bbb", sourceColumn: "amount", displayName: "Amount", visible: true, width: 10 },
    { id: "cfg_ccc", sourceColumn: "status", displayName: "Status", visible: true, width: 10 },
  ];

  it("applies default header formatting when template is null", async () => {
    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, null);
    const ws = await parseExcel(buffer);

    // Header is row 1 (startRow=0 default → headerExcelRow=1)
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(1, c);
      expect(cell.font?.bold).toBe(true);
      expect(cell.font?.size).toBe(11);
      // Fill should be light blue (#D9E1F2)
      const fill = cell.fill as ExcelJS.FillPattern;
      expect(fill?.type).toBe("pattern");
      expect(fill?.fgColor?.argb).toBe("FFD9E1F2");
    }

    // Data rows should have values
    expect(ws.getCell(2, 1).value).toBe("Alice");
    expect(ws.getCell(2, 2).value).toBe(100);
    expect(ws.getCell(3, 1).value).toBe("Bob");
  });

  it("applies template styles to headers and data rows", async () => {
    // Simulate a v2 template with custom header (gold bg) and data row formatting (bold amount)
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_aaa: 0, cfg_bbb: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {
          gold_header: {
            bl: 1,
            fs: 12,
            bg: { rgb: "#c9933a" },
            cl: { rgb: "#ffffff" },
            ht: 2,
          } as never,
          bold_data: {
            bl: 1,
            fs: 11,
            cl: { rgb: "#333333" },
          } as never,
          bg_data: {
            bg: { rgb: "#f0f0f0" },
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              // Header row (row 0)
              0: {
                0: { s: "gold_header" },
                1: { s: "gold_header" },
                2: { s: "gold_header" },
              },
              // First data row (row 1) — template for all data rows
              1: {
                0: { s: "bold_data" },
                1: { s: "bold_data" },
                2: { s: "bg_data" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Check header: should have gold bg (#C9933A) and white text (#FFFFFF)
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(1, c);
      expect(cell.font?.bold).toBe(true);
      expect(cell.font?.size).toBe(12);
      expect(cell.font?.color?.argb).toBe("FFFFFFFF");
      const fill = cell.fill as ExcelJS.FillPattern;
      expect(fill?.fgColor?.argb).toBe("FFC9933A");
    }

    // Check data rows: bold_data style on columns 0,1; bg_data on column 2
    // All 3 data rows should get the same styling (propagated from template row 1)
    for (let r = 2; r <= 4; r++) {
      // Columns 1-2 (Name, Amount): bold_data style
      expect(ws.getCell(r, 1).font?.bold).toBe(true);
      expect(ws.getCell(r, 1).font?.color?.argb).toBe("FF333333");

      // Column 3 (Status): bg_data style — light gray background
      const statusFill = ws.getCell(r, 3).fill as ExcelJS.FillPattern;
      expect(statusFill?.fgColor?.argb).toBe("FFF0F0F0");
    }
  });

  it("handles preamble rows (startRow > 0)", async () => {
    const template: SheetTemplate = {
      version: 2,
      startRow: 2,
      columnMap: { cfg_aaa: 0, cfg_bbb: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {
          title_style: {
            bl: 1,
            fs: 16,
            cl: { rgb: "#000000" },
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              // Preamble row 0: title
              0: {
                0: { v: "Monthly Report", s: "title_style" },
              },
              // Preamble row 1: empty
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Preamble row 1 should have the title
    expect(ws.getCell(1, 1).value).toBe("Monthly Report");
    expect(ws.getCell(1, 1).font?.bold).toBe(true);
    expect(ws.getCell(1, 1).font?.size).toBe(16);

    // Header row should be at row 3 (startRow=2, so Excel row = 2+1 = 3)
    expect(ws.getCell(3, 1).value).toBe("Name");
    expect(ws.getCell(3, 2).value).toBe("Amount");

    // Data starts at row 4
    expect(ws.getCell(4, 1).value).toBe("Alice");
  });

  it("handles column reordering via columnMap", async () => {
    // Template was saved when columns were in order [Amount, Name, Status]
    // but current order is [Name, Amount, Status]
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_bbb: 0, cfg_aaa: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {
          amount_style: {
            bl: 1,
            bg: { rgb: "#e6ffe6" },
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              // Header: Amount was at col 0 in template
              0: {
                0: { s: "amount_style" },
              },
              // Data row: Amount col 0 has bold style
              1: {
                0: { s: "amount_style" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Amount is now at current position 1 (col B), but template had it at 0 (col A)
    // The posMap should remap: template col 0 → current col 1
    // So the Amount header (col B = column 2) should have the green bg
    const amountHeaderFill = ws.getCell(1, 2).fill as ExcelJS.FillPattern;
    expect(amountHeaderFill?.fgColor?.argb).toBe("FFE6FFE6");

    // Data rows in Amount column should also have the style
    for (let r = 2; r <= 4; r++) {
      expect(ws.getCell(r, 2).font?.bold).toBe(true);
    }
  });

  it("handles formula columns", async () => {
    const formulaConfig: ColumnConfig[] = [
      ...colConfig,
      { id: "cfg_ddd", sourceColumn: null, displayName: "Total", visible: true, formula: "=B2*1.1", width: 10 },
    ];
    const extColumns = ["Name", "Amount", "Status", "Total"];
    const extConfigIds = ["cfg_aaa", "cfg_bbb", "cfg_ccc", "cfg_ddd"];
    const extRows = rows.map((r) => ({ ...r, Total: "" }));

    const buffer = await generateExcel("Test", extColumns, extRows, extConfigIds, formulaConfig, null);
    const ws = await parseExcel(buffer);

    // Formula column (D) should have formulas in data rows
    const cell2 = ws.getCell(2, 4);
    expect(cell2.value).toHaveProperty("formula");
    const cell3 = ws.getCell(3, 4);
    expect(cell3.value).toHaveProperty("formula");
  });

  it("handles edge-case color formats in argbFromRgb", async () => {
    // Template with various color formats that Univer might produce
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_aaa: 0, cfg_bbb: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {
          rgb_format: {
            bg: { rgb: "rgb(255, 200, 100)" },
          } as never,
          no_hash: {
            bg: { rgb: "C9933A" },
          } as never,
          null_color: {
            bl: 1,
            bg: { rgb: null },
            cl: { rgb: null },
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              1: {
                0: { s: "rgb_format" },
                1: { s: "no_hash" },
                2: { s: "null_color" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    // Should not throw
    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // rgb(255,200,100) → FFC864 → FFFFC864
    const cell1Fill = ws.getCell(2, 1).fill as ExcelJS.FillPattern;
    expect(cell1Fill?.fgColor?.argb).toBe("FFFFC864");

    // C9933A (no hash) → FFC9933A
    const cell2Fill = ws.getCell(2, 2).fill as ExcelJS.FillPattern;
    expect(cell2Fill?.fgColor?.argb).toBe("FFC9933A");

    // null color → should not crash, should not apply bg fill
    // But bold should still be applied
    expect(ws.getCell(2, 3).font?.bold).toBe(true);
  });
});
