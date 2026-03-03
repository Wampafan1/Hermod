import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generateExcel } from "@/lib/report-runner";
import type { SheetTemplate } from "@/components/reports/univer-sheet";
import type { ColumnConfig } from "@/lib/column-config";
import type { BlueprintFormatting, CapturedCellStyle } from "@/lib/mjolnir";

/**
 * Helper: parse a generated Excel buffer and return the first worksheet.
 */
async function parseExcel(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
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

  it("treats rgba(0,0,0,0) as transparent — not black", async () => {
    // Univer may represent 'no fill' as rgba(0,0,0,0). This must NOT produce black.
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
          transparent_rgba: {
            bl: 1,
            bg: { rgb: "rgba(0, 0, 0, 0)" },
            cl: { rgb: "rgba(0, 0, 0, 0)" },
          } as never,
          transparent_rgba_data: {
            bg: { rgb: "rgba(0,0,0,0)" },
            cl: { rgb: "rgba(255,200,100,0)" },
          } as never,
          real_color_rgba: {
            bg: { rgb: "rgba(201, 147, 58, 1)" },
            cl: { rgb: "rgba(255, 255, 255, 0.9)" },
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              // Header row: transparent rgba should fall back to default header colors
              0: {
                0: { s: "transparent_rgba" },
              },
              // Data rows: transparent rgba should NOT produce black fill
              1: {
                0: { s: "transparent_rgba_data" },
                1: { s: "real_color_rgba" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Header with rgba(0,0,0,0) bg → should fall back to default light blue, NOT black
    const headerFill = ws.getCell(1, 1).fill as ExcelJS.FillPattern;
    expect(headerFill?.fgColor?.argb).toBe("FFD9E1F2"); // default header bg, not FF000000

    // Header font with rgba(0,0,0,0) cl → should fall back to default black text
    expect(headerFill?.fgColor?.argb).not.toBe("FF000000"); // NOT black fill

    // Data cell with rgba(0,0,0,0) bg → should NOT apply any fill (transparent)
    const dataFill = ws.getCell(2, 1).fill as ExcelJS.FillPattern;
    expect(dataFill?.fgColor?.argb).not.toBe("FF000000"); // Must NOT be black

    // Data cell with rgba(201,147,58,1) → should produce correct gold color
    const goldFill = ws.getCell(2, 2).fill as ExcelJS.FillPattern;
    expect(goldFill?.fgColor?.argb).toBe("FFC9933A");
  });

  it("resolves theme colors via th property", async () => {
    // Univer can store colors using theme color references (th property) instead of rgb
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
          theme_accent1_bg: {
            bg: { th: 4 },  // ACCENT1 = #4472C4
            cl: { th: 1 },  // LIGHT1 = #FFFFFF (white text)
            bl: 1,
          } as never,
          theme_only_font: {
            cl: { th: 0 },  // DARK1 = #000000
          } as never,
          theme_with_rgb: {
            // Both th and rgb — rgb should take precedence
            bg: { th: 4, rgb: "#FF0000" },
            bl: 1,
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              0: {
                0: { s: "theme_accent1_bg" },
                1: { s: "theme_only_font" },
              },
              1: {
                0: { s: "theme_accent1_bg" },
                1: { s: "theme_with_rgb" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Header col A: ACCENT1 bg (#4472C4) + LIGHT1 font (#FFFFFF)
    const headerFill = ws.getCell(1, 1).fill as ExcelJS.FillPattern;
    expect(headerFill?.fgColor?.argb).toBe("FF4472C4");
    expect(ws.getCell(1, 1).font?.color?.argb).toBe("FFFFFFFF");

    // Data col A: same ACCENT1 bg
    const dataFill = ws.getCell(2, 1).fill as ExcelJS.FillPattern;
    expect(dataFill?.fgColor?.argb).toBe("FF4472C4");

    // Data col B: has both th and rgb — rgb (#FF0000) should win
    const data2Fill = ws.getCell(2, 2).fill as ExcelJS.FillPattern;
    expect(data2Fill?.fgColor?.argb).toBe("FFFF0000");
  });

  it("handles 8-digit hex with alpha=00 as transparent", async () => {
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
          transparent_8hex: {
            bg: { rgb: "#00000000" },  // alpha=00, should be transparent
            bl: 1,
          } as never,
          opaque_8hex: {
            bg: { rgb: "#FFFF0000" },  // alpha=FF, red
          } as never,
        },
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {
              0: {
                0: { s: "transparent_8hex" },
                1: { s: "opaque_8hex" },
              },
              1: {
                0: { s: "transparent_8hex" },
                1: { s: "opaque_8hex" },
              },
            } as never,
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // Header with transparent 8-digit hex → should use default light blue, NOT black
    const headerFill = ws.getCell(1, 1).fill as ExcelJS.FillPattern;
    expect(headerFill?.fgColor?.argb).toBe("FFD9E1F2");

    // Header with opaque red 8-digit hex → should be red
    const redFill = ws.getCell(1, 2).fill as ExcelJS.FillPattern;
    expect(redFill?.fgColor?.argb).toBe("FFFF0000");

    // Data with transparent 8-digit hex → should NOT produce black fill
    const dataFill = ws.getCell(2, 1).fill as ExcelJS.FillPattern;
    expect(dataFill?.fgColor?.argb).not.toBe("FF000000");
  });

  it("applies column widths from template columnData (backwards compat)", async () => {
    // Template has explicit column widths but config widths are default (8.43)
    // → template widths should be used as fallback
    const defaultColConfig: ColumnConfig[] = [
      { id: "cfg_aaa", sourceColumn: "name", displayName: "Name", visible: true, width: 8.43 },
      { id: "cfg_bbb", sourceColumn: "amount", displayName: "Amount", visible: true, width: 8.43 },
      { id: "cfg_ccc", sourceColumn: "status", displayName: "Status", visible: true, width: 8.43 },
    ];
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_aaa: 0, cfg_bbb: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {},
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {} as never,
            columnData: {
              0: { w: 150 },  // 150 Univer px → 150/7.5 = 20 Excel chars
              1: { w: 225 },  // 225 Univer px → 225/7.5 = 30 Excel chars
              2: { w: 75 },   // 75 Univer px → 75/7.5 = 10 Excel chars
            },
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, defaultColConfig, template);
    const ws = await parseExcel(buffer);

    // Template columnData widths should be applied (pixel / 7.5)
    expect(ws.getColumn(1).width).toBe(20);
    expect(ws.getColumn(2).width).toBe(30);
    expect(ws.getColumn(3).width).toBe(10);
  });

  it("prefers explicit config widths over template columnData", async () => {
    // Config has explicit non-default widths → should override template widths
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_aaa: 0, cfg_bbb: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {},
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {} as never,
            columnData: {
              0: { w: 64 },  // Default Univer width
              1: { w: 64 },
              2: { w: 64 },
            },
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, template);
    const ws = await parseExcel(buffer);

    // colConfig has widths 12, 10, 10 (non-default) → should win over template defaults
    expect(ws.getColumn(1).width).toBe(12);
    expect(ws.getColumn(2).width).toBe(10);
    expect(ws.getColumn(3).width).toBe(10);
  });

  it("falls back to column config widths when template has no columnData", async () => {
    // colConfig has widths: 12, 10, 10
    const buffer = await generateExcel("Test", columns, rows, configIds, colConfig, null);
    const ws = await parseExcel(buffer);

    expect(ws.getColumn(1).width).toBe(12);
    expect(ws.getColumn(2).width).toBe(10);
    expect(ws.getColumn(3).width).toBe(10);
  });

  it("applies template column widths correctly after column reorder", async () => {
    // Template saved with order [Amount, Name, Status] (cfg_bbb=0, cfg_aaa=1, cfg_ccc=2)
    // Current order: [Name, Amount, Status] (cfg_aaa=0, cfg_bbb=1, cfg_ccc=2)
    // Config widths are default → template widths should be used
    const defaultColConfig: ColumnConfig[] = [
      { id: "cfg_aaa", sourceColumn: "name", displayName: "Name", visible: true, width: 8.43 },
      { id: "cfg_bbb", sourceColumn: "amount", displayName: "Amount", visible: true, width: 8.43 },
      { id: "cfg_ccc", sourceColumn: "status", displayName: "Status", visible: true, width: 8.43 },
    ];
    const template: SheetTemplate = {
      version: 2,
      startRow: 0,
      columnMap: { cfg_bbb: 0, cfg_aaa: 1, cfg_ccc: 2 },
      snapshot: {
        id: "test_wb",
        name: "Test",
        appVersion: "0.0.1",
        locale: "en-US" as never,
        styles: {},
        sheetOrder: ["s1"],
        sheets: {
          s1: {
            id: "s1",
            name: "Results",
            cellData: {} as never,
            columnData: {
              // At save time: col 0 = Amount (150px), col 1 = Name (225px), col 2 = Status (75px)
              0: { w: 150 },
              1: { w: 225 },
              2: { w: 75 },
            },
          } as never,
        },
        resources: [],
      },
    };

    const buffer = await generateExcel("Test", columns, rows, configIds, defaultColConfig, template);
    const ws = await parseExcel(buffer);

    // Current col 0 = Name (was at template col 1 = 225px → 225/7.5 = 30)
    expect(ws.getColumn(1).width).toBe(30);
    // Current col 1 = Amount (was at template col 0 = 150px → 150/7.5 = 20)
    expect(ws.getColumn(2).width).toBe(20);
    // Current col 2 = Status (was at template col 2 = 75px → 75/7.5 = 10)
    expect(ws.getColumn(3).width).toBe(10);
  });
});

// ─── Blueprint Formatting Tests ─────────────────────

describe("generateExcel with BlueprintFormatting", () => {
  const columns = ["SKU", "On Hand", "Available"];
  const rows = [
    { SKU: "ABC-001", "On Hand": 50, Available: 42 },
    { SKU: "DEF-002", "On Hand": 100, Available: 88 },
    { SKU: "GHI-003", "On Hand": 0, Available: 0 },
  ];

  function makeFmt(overrides?: Partial<BlueprintFormatting>): BlueprintFormatting {
    return {
      headerRowCount: 1,
      columnWidths: [15, 12, 12],
      headerRowHeights: [20],
      headerStyles: {
        "0:0": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4", alignment: { horizontal: "center" } },
        "0:1": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4", alignment: { horizontal: "center" } },
        "0:2": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4", alignment: { horizontal: "center" } },
      },
      headerValues: {},
      dataRowStyles: {
        0: { font: { name: "Calibri", size: 10 }, alignment: { horizontal: "left" } },
        1: { font: { name: "Calibri", size: 10 }, alignment: { horizontal: "right" }, numFmt: "#,##0" },
        2: { font: { name: "Calibri", size: 10 }, alignment: { horizontal: "right" }, numFmt: "#,##0" },
      },
      dataRowHeight: 16,
      merges: [],
      columns: ["SKU", "On Hand", "Available"],
      ...overrides,
    };
  }

  it("applies header styles from BlueprintFormatting", async () => {
    const fmt = makeFmt();
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // Header row 1: should have bold white text on blue background
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(1, c);
      expect(cell.font?.bold).toBe(true);
      expect(cell.font?.color?.argb).toBe("FFFFFFFF");
      const fill = cell.fill as ExcelJS.FillPattern;
      expect(fill?.fgColor?.argb).toBe("FF4472C4");
      expect(cell.alignment?.horizontal).toBe("center");
    }

    // Header values = actual column names
    expect(ws.getCell(1, 1).value).toBe("SKU");
    expect(ws.getCell(1, 2).value).toBe("On Hand");
    expect(ws.getCell(1, 3).value).toBe("Available");
  });

  it("applies data row template styles", async () => {
    const fmt = makeFmt();
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // Data starts at row 2
    for (let r = 2; r <= 4; r++) {
      // SKU column: left-aligned, Calibri 10
      expect(ws.getCell(r, 1).font?.name).toBe("Calibri");
      expect(ws.getCell(r, 1).font?.size).toBe(10);
      expect(ws.getCell(r, 1).alignment?.horizontal).toBe("left");

      // On Hand column: right-aligned, number format
      expect(ws.getCell(r, 2).alignment?.horizontal).toBe("right");
      expect(ws.getCell(r, 2).numFmt).toBe("#,##0");

      // Available column: right-aligned, number format
      expect(ws.getCell(r, 3).alignment?.horizontal).toBe("right");
      expect(ws.getCell(r, 3).numFmt).toBe("#,##0");
    }

    // Values should be correct
    expect(ws.getCell(2, 1).value).toBe("ABC-001");
    expect(ws.getCell(2, 2).value).toBe(50);
    expect(ws.getCell(4, 3).value).toBe(0);
  });

  it("applies column widths from BlueprintFormatting", async () => {
    const fmt = makeFmt();
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    expect(ws.getColumn(1).width).toBe(15);
    expect(ws.getColumn(2).width).toBe(12);
    expect(ws.getColumn(3).width).toBe(12);
  });

  it("applies row heights from BlueprintFormatting", async () => {
    const fmt = makeFmt({ dataRowHeight: 22 });
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // Header row height
    expect(ws.getRow(1).height).toBe(20);

    // Data row heights
    for (let r = 2; r <= 4; r++) {
      expect(ws.getRow(r).height).toBe(22);
    }
  });

  it("handles multi-row header area (group headers)", async () => {
    const fmt = makeFmt({
      headerRowCount: 2,
      headerRowHeights: [18, 20],
      headerStyles: {
        "0:0": { font: { bold: true, size: 14 }, fill: "FF333333" },
        "1:0": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4" },
        "1:1": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4" },
        "1:2": { font: { bold: true, size: 11, color: "FFFFFFFF" }, fill: "FF4472C4" },
      },
      headerValues: {
        "0:0": "Inventory Summary",
      },
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
    });

    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // Row 1 = group header with title
    expect(ws.getCell(1, 1).value).toBe("Inventory Summary");
    expect(ws.getCell(1, 1).font?.bold).toBe(true);
    expect(ws.getCell(1, 1).font?.size).toBe(14);

    // Row 2 = column headers
    expect(ws.getCell(2, 1).value).toBe("SKU");
    expect(ws.getCell(2, 2).value).toBe("On Hand");
    expect(ws.getCell(2, 3).value).toBe("Available");

    // Data starts at row 3
    expect(ws.getCell(3, 1).value).toBe("ABC-001");
  });

  it("applies freeze panes from BlueprintFormatting", async () => {
    const fmt = makeFmt({ freeze: { row: 2, col: 2 } });
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    const views = ws.views;
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe("frozen");
    // freeze stores 1-based; ExcelJS uses 0-based xSplit/ySplit
    expect(views[0].ySplit).toBe(1);
    expect(views[0].xSplit).toBe(1);
  });

  it("applies borders from BlueprintFormatting", async () => {
    const style: CapturedCellStyle = {
      font: { bold: true },
      border: {
        top: { style: "thin", color: "FF000000" },
        bottom: { style: "medium", color: "FF333333" },
        left: { style: "thin" },
        right: { style: "thin" },
      },
    };
    const fmt = makeFmt({
      headerStyles: { "0:0": style, "0:1": style, "0:2": style },
    });

    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    const cell = ws.getCell(1, 1);
    expect(cell.border?.top?.style).toBe("thin");
    expect(cell.border?.bottom?.style).toBe("medium");
    expect(cell.border?.bottom?.color?.argb).toBe("FF333333");
  });

  it("resolves theme colors in BlueprintFormatting", async () => {
    const fmt = makeFmt({
      headerStyles: {
        "0:0": { font: { bold: true, color: "THEME:1:0" }, fill: "THEME:4:0" },
        "0:1": { font: { bold: true } },
        "0:2": { font: { bold: true } },
      },
    });

    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // THEME:1 = LIGHT1 = #FFFFFF → FFFFFFFF
    expect(ws.getCell(1, 1).font?.color?.argb).toBe("FFFFFFFF");
    // THEME:4 = ACCENT1 = #4472C4 → FF4472C4
    const fill = ws.getCell(1, 1).fill as ExcelJS.FillPattern;
    expect(fill?.fgColor?.argb).toBe("FF4472C4");
  });

  it("sets auto-filter on the column header row", async () => {
    const fmt = makeFmt();
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    // ExcelJS may store autoFilter as string range or object
    expect(ws.autoFilter).toBeTruthy();
  });

  it("defaults freeze to below header area when not specified", async () => {
    const fmt = makeFmt({ freeze: undefined });
    const buffer = await generateExcel("Test", columns, rows, [], [], null, fmt);
    const ws = await parseExcel(buffer);

    const views = ws.views;
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe("frozen");
    expect(views[0].ySplit).toBe(1); // headerRowCount = 1
    expect(views[0].xSplit).toBe(0);
  });
});
