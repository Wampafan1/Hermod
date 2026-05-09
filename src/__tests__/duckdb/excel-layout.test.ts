import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectExcelLayout } from "@/lib/duckdb/excel-layout";
import { createAnalyticsSession } from "@/lib/duckdb/engine";
import { analyzeFile } from "@/lib/duckdb/file-analyzer";

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Excel layout detection", () => {
  it("detects a wide header after report metadata rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Import Invoice Line Report");

    worksheet.getCell("B1").value = "Yusen Logistics (Americas) Inc.";
    worksheet.getCell("B2").value = "US Import Invoice Lines Report";
    for (let row = 3; row <= 74; row++) {
      worksheet.getCell(row, 2).value = `Filter ${row}: `;
    }

    worksheet.getRow(76).values = [
      null,
      null,
      null,
      "Entry Type",
      "Importer",
      "Import Date",
      "Entry Port",
      "Invoice Number",
    ];
    worksheet.getRow(77).values = [
      null,
      null,
      null,
      "01",
      "LOVE'S TRUCK SOLUTIONS, LLC",
      new Date("2024-11-25T00:00:00Z"),
      "2006",
      "4600062100",
    ];
    worksheet.getRow(78).values = [
      null,
      null,
      null,
      "01",
      "LOVE'S TRUCK SOLUTIONS, LLC",
      new Date("2024-12-17T00:00:00Z"),
      "2704",
      "RG 24-191",
    ];

    const layout = detectExcelLayout(worksheet);

    expect(layout).toEqual({ headerRow: 76, dataStartRow: 77 });
  });

  it("keeps simple row-one tables on row one", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");
    worksheet.getCell("A1").value = "ID";
    worksheet.getCell("B1").value = "Name";
    worksheet.getCell("C1").value = "Amount";
    worksheet.getCell("A2").value = 1;
    worksheet.getCell("B2").value = "Ada";
    worksheet.getCell("C2").value = 10.5;

    expect(detectExcelLayout(worksheet)).toEqual({ headerRow: 1, dataStartRow: 2 });
  });

  it("skips blank separators between the header and data", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");
    worksheet.getCell("A1").value = "Export generated 2026-05-09";
    worksheet.getCell("A3").value = "Invoice";
    worksheet.getCell("B3").value = "Amount";
    worksheet.getCell("C3").value = "Status";
    worksheet.getCell("A5").value = "INV-1";
    worksheet.getCell("B5").value = 25;
    worksheet.getCell("C5").value = "Open";

    expect(detectExcelLayout(worksheet)).toEqual({ headerRow: 3, dataStartRow: 5 });
  });

  it("uses the detected layout when profiling Excel files", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Import Invoice Line Report");
    worksheet.getCell("B1").value = "US Import Invoice Lines Report";
    for (let row = 2; row <= 74; row++) {
      worksheet.getCell(row, 2).value = `Filter ${row}: `;
    }
    worksheet.getRow(76).values = [null, null, null, "Entry Type", "Importer", "Invoice Number"];
    worksheet.getRow(77).values = [null, null, null, "01", "LOVE'S", "4600062100"];
    worksheet.getRow(78).values = [null, null, null, "01", "LOVE'S", "RG 24-191"];

    const result = await analyzeFile(
      await workbookBuffer(workbook),
      "import-invoice-lines.xlsx",
      { skipUCC: true }
    );

    expect(result.headerRow).toBe(76);
    expect(result.dataStartRow).toBe(77);
    expect(result.rowCount).toBe(2);
    expect(result.columns.map((column) => column.name)).toEqual([
      "Entry Type",
      "Importer",
      "Invoice Number",
    ]);
    expect(result.previewRows[0]).toMatchObject({
      "Entry Type": "01",
      Importer: "LOVE'S",
      "Invoice Number": "4600062100",
    });
  });

  it("loads the detected layout by default in the DuckDB Excel loader", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");
    worksheet.getCell("B1").value = "Report title";
    for (let row = 2; row <= 20; row++) {
      worksheet.getCell(row, 2).value = `Filter ${row}: `;
    }
    worksheet.getCell("C22").value = "Invoice";
    worksheet.getCell("D22").value = "Amount";
    worksheet.getCell("C23").value = "INV-1";
    worksheet.getCell("D23").value = 25;

    const session = await createAnalyticsSession();
    try {
      await session.loadExcel(await workbookBuffer(workbook), "staging");

      const rows = await session.query<Record<string, unknown>>("SELECT * FROM staging");

      expect(rows).toEqual([{ Invoice: "INV-1", Amount: "25" }]);
    } finally {
      await session.close();
    }
  });
});
